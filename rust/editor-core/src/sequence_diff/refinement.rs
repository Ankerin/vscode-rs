/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Owning UTF-16 slices and the existing character-level display refinement pipeline.

use std::{collections::VecDeque, ops::Range};

use crate::Position;

use super::{
	MAX_DYNAMIC_DIFF_CELLS, OptimizationSequence, SequenceDiff, SequenceDiffError,
	dynamic_programming_diff, myers_diff, optimize_sequence_diffs,
};

/// A one-based document range, preserving the editor's UTF-16 columns.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TextRange {
	pub start: Position,
	pub end: Position,
}

/// Options for a single character refinement; raw edits precede display heuristics.
#[derive(Clone, Copy, Default)]
pub struct CharacterDiffOptions {
	pub extend_to_subwords: bool,
	pub include_raw_changes: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub struct CharacterDiffResult {
	pub mappings: Vec<(TextRange, TextRange)>,
	pub raw_changes: Vec<(TextRange, TextRange)>,
	pub hit_timeout: bool,
}

struct LineOffset {
	first_element: usize,
	source_start: usize,
	trimmed_start: usize,
}

/// Owns compact character elements and the line metadata used by every refinement stage.
/// Source lines are borrowed only during construction and are not retained.
pub struct CharacterSequence {
	elements: Vec<u16>,
	lines: Vec<LineOffset>,
	start_line_number: usize,
}

impl CharacterSequence {
	/// The input contains exactly the lines touched by `range`, including its final line.
	pub fn new(
		lines: &[&[u16]],
		range: TextRange,
		consider_whitespace_changes: bool,
	) -> Result<Self, SequenceDiffError> {
		if range.start.line_number == 0
			|| range.start.line_number > range.end.line_number
			|| lines.len() != range.end.line_number - range.start.line_number + 1
			|| range.start.column == 0
			|| range.end.column == 0
			|| range.start.column > lines[0].len() + 1
			|| range.end.column > lines[lines.len() - 1].len() + 1
			|| (lines.len() == 1 && range.start.column > range.end.column)
		{
			return Err(SequenceDiffError::InvalidRanges);
		}
		let capacity = lines
			.iter()
			.try_fold(lines.len() - 1, |total, line| total.checked_add(line.len()));
		let capacity = capacity
			.filter(|&length| length <= MAX_DYNAMIC_DIFF_CELLS)
			.ok_or(SequenceDiffError::TooLarge)?;
		let mut elements = Vec::new();
		elements
			.try_reserve_exact(capacity)
			.map_err(|_| SequenceDiffError::AllocationFailed)?;
		let mut offsets = Vec::new();
		offsets
			.try_reserve_exact(lines.len())
			.map_err(|_| SequenceDiffError::AllocationFailed)?;
		for (index, source) in lines.iter().enumerate() {
			let source_start = if index == 0 {
				range.start.column - 1
			} else {
				0
			};
			let mut line = &source[source_start..];
			let mut trimmed_start = 0;
			if !consider_whitespace_changes {
				trimmed_start = line.iter().take_while(|&&unit| is_whitespace(unit)).count();
				line = trim_end(&line[trimmed_start..]);
			}
			offsets.push(LineOffset {
				first_element: elements.len(),
				source_start,
				trimmed_start,
			});
			let length = if index + 1 == lines.len() {
				(range.end.column - 1)
					.saturating_sub(source_start + trimmed_start)
					.min(line.len())
			} else {
				line.len()
			};
			elements.extend_from_slice(&line[..length]);
			if index + 1 < lines.len() {
				elements.push(10);
			}
		}
		Ok(Self {
			elements,
			lines: offsets,
			start_line_number: range.start.line_number,
		})
	}

	fn line_index(&self, offset: usize) -> usize {
		self.lines
			.partition_point(|line| line.first_element <= offset)
			- 1
	}

	fn translate_offset(&self, offset: usize, prefer_left: bool) -> Position {
		let index = self.line_index(offset);
		let line = &self.lines[index];
		let column_offset = offset - line.first_element;
		Position {
			line_number: self.start_line_number + index,
			column: 1
				+ line.source_start
				+ column_offset
				+ if column_offset == 0 && prefer_left {
					0
				} else {
					line.trimmed_start
				},
		}
	}

	fn translate_range(&self, range: &Range<usize>) -> TextRange {
		let start = self.translate_offset(range.start, false);
		let end = self.translate_offset(range.end, true);
		let before = (end.line_number, end.column) < (start.line_number, start.column);
		TextRange {
			start: if before { end } else { start },
			end,
		}
	}

	fn count_lines(&self, range: &Range<usize>) -> usize {
		self.line_index(range.end) - self.line_index(range.start)
	}

	fn full_lines(&self, range: &Range<usize>) -> Range<usize> {
		let start = self.lines[self.line_index(range.start)].first_element;
		let end_index = self
			.lines
			.partition_point(|line| line.first_element < range.end);
		let end = self
			.lines
			.get(end_index)
			.map_or(self.elements.len(), |line| line.first_element);
		start..end
	}

	fn find_word(&self, offset: usize, subword: bool) -> Option<Range<usize>> {
		if !self.elements.get(offset).is_some_and(|&unit| is_word(unit)) {
			return None;
		}
		let mut start = offset;
		while start > 0
			&& is_word(self.elements[start - 1])
			&& (!subword || !is_upper(self.elements[start]))
		{
			start -= 1;
		}
		let mut end = offset;
		while end < self.elements.len()
			&& is_word(self.elements[end])
			&& (!subword || !is_upper(self.elements[end]))
		{
			end += 1;
		}
		Some(start..end)
	}

	fn boundary_scores(&self) -> Vec<f64> {
		(0..=self.elements.len())
			.map(|offset| {
				let previous = category(offset.checked_sub(1).map(|index| self.elements[index]));
				let next = category(self.elements.get(offset).copied());
				if previous == Category::CarriageReturn && next == Category::LineFeed {
					0.0
				} else if previous == Category::LineFeed {
					150.0
				} else {
					let transition = if previous != next { 10.0 } else { 0.0 };
					let camel_case = if previous == Category::Lower && next == Category::Upper {
						1.0
					} else {
						0.0
					};
					transition + camel_case + category_score(previous) + category_score(next)
				}
			})
			.collect()
	}
}

/// Runs alignment, optional raw Myers edits, and all display refinements on the owning slices.
/// The timeout callback is invoked only at the existing alignment checkpoints.
pub fn refine_character_diff(
	original: &CharacterSequence,
	modified: &CharacterSequence,
	options: CharacterDiffOptions,
	mut is_valid: impl FnMut() -> bool,
) -> Result<CharacterDiffResult, SequenceDiffError> {
	let use_dynamic = original.elements.len() + modified.elements.len() < 500;
	let result = if use_dynamic {
		dynamic_programming_diff(&original.elements, &modified.elements, None, &mut is_valid)
	} else {
		myers_diff(&original.elements, &modified.elements, &mut is_valid)
	}?;
	let mut hit_timeout = result.hit_timeout;
	let mut raw_changes = Vec::new();
	if options.include_raw_changes {
		let raw_result = if use_dynamic && !hit_timeout {
			Some(myers_diff(
				&original.elements,
				&modified.elements,
				&mut is_valid,
			)?)
		} else {
			None
		};
		let raw = raw_result.as_ref().unwrap_or(&result);
		hit_timeout |= raw.hit_timeout;
		raw_changes = translate_diffs(original, modified, &raw.diffs);
	}
	let scores1 = original.boundary_scores();
	let scores2 = modified.boundary_scores();
	let mut diffs = optimize_sequence_diffs(
		OptimizationSequence {
			elements: &original.elements,
			strong_elements: &original.elements,
			boundary_scores: &scores1,
		},
		OptimizationSequence {
			elements: &modified.elements,
			strong_elements: &modified.elements,
			boundary_scores: &scores2,
		},
		&result.diffs,
	)?;
	// Scores are not needed by the remaining stages.
	drop((scores1, scores2));
	diffs = extend_words(original, modified, diffs, false)?;
	if options.extend_to_subwords {
		diffs = extend_words(original, modified, diffs, true)?;
	}
	diffs = remove_short_matches(diffs);
	diffs = remove_short_text(original, modified, diffs);
	Ok(CharacterDiffResult {
		mappings: translate_diffs(original, modified, &diffs),
		raw_changes,
		hit_timeout,
	})
}

fn translate_diffs(
	original: &CharacterSequence,
	modified: &CharacterSequence,
	diffs: &[SequenceDiff],
) -> Vec<(TextRange, TextRange)> {
	diffs
		.iter()
		.map(|diff| {
			(
				original.translate_range(&diff.original),
				modified.translate_range(&diff.modified),
			)
		})
		.collect()
}

fn join(first: &SequenceDiff, second: &SequenceDiff) -> SequenceDiff {
	SequenceDiff {
		original: first.original.start.min(second.original.start)
			..first.original.end.max(second.original.end),
		modified: first.modified.start.min(second.modified.start)
			..first.modified.end.max(second.modified.end),
	}
}

fn intersect(first: &SequenceDiff, second: &SequenceDiff) -> Option<SequenceDiff> {
	let original = first.original.start.max(second.original.start)
		..first.original.end.min(second.original.end);
	let modified = first.modified.start.max(second.modified.start)
		..first.modified.end.min(second.modified.end);
	(original.start <= original.end && modified.start <= modified.end)
		.then_some(SequenceDiff { original, modified })
}

fn intersects(first: &Range<usize>, second: &Range<usize>) -> bool {
	first.start.max(second.start) < first.end.min(second.end)
}

fn extend_words(
	original: &CharacterSequence,
	modified: &CharacterSequence,
	diffs: Vec<SequenceDiff>,
	subwords: bool,
) -> Result<Vec<SequenceDiff>, SequenceDiffError> {
	let mut equal = VecDeque::with_capacity(diffs.len() + 1);
	let (mut start1, mut start2) = (0, 0);
	for diff in &diffs {
		equal.push_back(SequenceDiff {
			original: start1..diff.original.start,
			modified: start2..diff.modified.start,
		});
		(start1, start2) = (diff.original.end, diff.modified.end);
	}
	equal.push_back(SequenceDiff {
		original: start1..original.elements.len(),
		modified: start2..original.elements.len() - start1 + start2,
	});
	let mut additional = Vec::new();
	let mut last_point = (0, 0);
	while let Some(next) = equal.pop_front() {
		if next.original.is_empty() {
			continue;
		}
		for point in [
			(next.original.start, next.modified.start),
			(next.original.end - 1, next.modified.end - 1),
		] {
			if point.0 < last_point.0 || point.1 < last_point.1 {
				continue;
			}
			let (Some(word1), Some(word2)) = (
				original.find_word(point.0, subwords),
				modified.find_word(point.1, subwords),
			) else {
				continue;
			};
			let mut word = SequenceDiff {
				original: word1,
				modified: word2,
			};
			let part = intersect(&word, &next).ok_or(SequenceDiffError::InvalidRanges)?;
			let mut equal_chars = part.original.len() + part.modified.len();
			while let Some(next) = equal.front() {
				if !intersects(&next.original, &word.original)
					&& !intersects(&next.modified, &word.modified)
				{
					break;
				}
				let extension = SequenceDiff {
					original: original
						.find_word(next.original.start, subwords)
						.ok_or(SequenceDiffError::InvalidRanges)?,
					modified: modified
						.find_word(next.modified.start, subwords)
						.ok_or(SequenceDiffError::InvalidRanges)?,
				};
				let part = intersect(&extension, next).ok_or(SequenceDiffError::InvalidRanges)?;
				equal_chars += part.original.len() + part.modified.len();
				word = join(&word, &extension);
				if word.original.end >= next.original.end {
					equal.pop_front();
				} else {
					break;
				}
			}
			let length = word.original.len() + word.modified.len();
			if (subwords && equal_chars < length)
				|| (equal_chars as f64) < length as f64 * 2.0 / 3.0
			{
				additional.push(word.clone());
			}
			last_point = (word.original.end, word.modified.end);
		}
	}
	let mut first = diffs.into_iter().peekable();
	let mut second = additional.into_iter().peekable();
	let mut result: Vec<SequenceDiff> = Vec::new();
	while first.peek().is_some() || second.peek().is_some() {
		let next = if first.peek().is_some_and(|diff| {
			second
				.peek()
				.is_none_or(|other| diff.original.start < other.original.start)
		}) {
			first.next().expect("The first input is nonempty")
		} else {
			second.next().expect("The second input is nonempty")
		};
		if let Some(last) = result.last_mut()
			&& last.original.end >= next.original.start
		{
			*last = join(last, &next);
		} else {
			result.push(next);
		}
	}
	Ok(result)
}

fn remove_short_matches(diffs: Vec<SequenceDiff>) -> Vec<SequenceDiff> {
	let mut result: Vec<SequenceDiff> = Vec::with_capacity(diffs.len());
	for diff in diffs {
		if let Some(last) = result.last_mut()
			&& (diff.original.start - last.original.end <= 2
				|| diff.modified.start - last.modified.end <= 2)
		{
			*last = join(last, &diff);
		} else {
			result.push(diff);
		}
	}
	result
}

fn remove_short_text(
	original: &CharacterSequence,
	modified: &CharacterSequence,
	mut diffs: Vec<SequenceDiff>,
) -> Vec<SequenceDiff> {
	for _ in 0..11 {
		let mut result: Vec<SequenceDiff> = Vec::with_capacity(diffs.len());
		let mut repeat = false;
		for diff in diffs {
			if let Some(last) = result.last_mut()
				&& should_join(original, modified, last, &diff)
			{
				*last = join(last, &diff);
				repeat = true;
			} else {
				result.push(diff);
			}
		}
		diffs = result;
		if !repeat {
			break;
		}
	}
	let mut result: Vec<SequenceDiff> = Vec::with_capacity(diffs.len());
	for (index, diff) in diffs.iter().enumerate() {
		let full = original.full_lines(&diff.original);
		let prefix = &original.elements[full.start..diff.original.start];
		let suffix = &original.elements[diff.original.end..full.end];
		let mark_changed = |text: &[u16]| {
			!text.is_empty()
				&& trim(text).len() <= 3
				&& diff.original.len() + diff.modified.len() > 100
		};
		let before = if mark_changed(prefix) {
			prefix.len()
		} else {
			0
		};
		let after = if mark_changed(suffix) {
			suffix.len()
		} else {
			0
		};
		let previous = index.checked_sub(1).map(|index| &diffs[index]);
		let next = diffs.get(index + 1);
		let current = SequenceDiff {
			original: diff
				.original
				.start
				.saturating_sub(before)
				.max(previous.map_or(0, |diff| diff.original.end))
				..(diff.original.end + after)
					.min(next.map_or(usize::MAX, |diff| diff.original.start)),
			modified: diff
				.modified
				.start
				.saturating_sub(before)
				.max(previous.map_or(0, |diff| diff.modified.end))
				..(diff.modified.end + after)
					.min(next.map_or(usize::MAX, |diff| diff.modified.start)),
		};
		if let Some(last) = result.last_mut()
			&& (current.original.start, current.modified.start)
				== (last.original.end, last.modified.end)
		{
			*last = join(last, &current);
		} else {
			result.push(current);
		}
	}
	result
}

fn should_join(
	original: &CharacterSequence,
	modified: &CharacterSequence,
	before: &SequenceDiff,
	after: &SequenceDiff,
) -> bool {
	let unchanged = before.original.end..after.original.start;
	if original.count_lines(&unchanged) > 5 || unchanged.len() > 500 {
		return false;
	}
	let text = trim(&original.elements[unchanged]);
	if text.len() > 20 || text.iter().any(|&unit| unit == 13 || unit == 10) {
		return false;
	}
	let weight = |sequence: &CharacterSequence, range: &Range<usize>| {
		(sequence.count_lines(range) * 40 + range.len()).min(130) as f64
	};
	let strength = |diff: &SequenceDiff| {
		(weight(original, &diff.original).powf(1.5) + weight(modified, &diff.modified).powf(1.5))
			.powf(1.5)
	};
	strength(before) + strength(after) > 130_f64.powf(1.5).powf(1.5) * 1.3
}

fn is_word(unit: u16) -> bool {
	matches!(unit, 48..=57 | 65..=90 | 97..=122)
}
fn is_upper(unit: u16) -> bool {
	matches!(unit, 65..=90)
}

/// ECMAScript WhiteSpace and LineTerminator; Rust's Unicode whitespace set differs.
pub(super) fn is_whitespace(unit: u16) -> bool {
	matches!(unit, 9..=13 | 32 | 160 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F | 0x3000 | 0xFEFF)
}

fn trim_end(units: &[u16]) -> &[u16] {
	let end = units.len()
		- units
			.iter()
			.rev()
			.take_while(|&&unit| is_whitespace(unit))
			.count();
	&units[..end]
}

pub(super) fn trim(units: &[u16]) -> &[u16] {
	let start = units
		.iter()
		.take_while(|&&unit| is_whitespace(unit))
		.count();
	trim_end(&units[start..])
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Category {
	Lower,
	Upper,
	Number,
	End,
	Other,
	Separator,
	Space,
	CarriageReturn,
	LineFeed,
}

fn category(unit: Option<u16>) -> Category {
	match unit {
		None => Category::End,
		Some(10) => Category::LineFeed,
		Some(13) => Category::CarriageReturn,
		Some(9 | 32) => Category::Space,
		Some(97..=122) => Category::Lower,
		Some(65..=90) => Category::Upper,
		Some(48..=57) => Category::Number,
		Some(44 | 59) => Category::Separator,
		_ => Category::Other,
	}
}

fn category_score(category: Category) -> f64 {
	match category {
		Category::Lower | Category::Upper | Category::Number => 0.0,
		Category::End | Category::CarriageReturn | Category::LineFeed => 10.0,
		Category::Other => 2.0,
		Category::Separator => 30.0,
		Category::Space => 3.0,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn position(line_number: usize, column: usize) -> Position {
		Position {
			line_number,
			column,
		}
	}

	fn sequence(units: &[u16]) -> CharacterSequence {
		CharacterSequence::new(
			&[units],
			TextRange {
				start: position(1, 1),
				end: position(1, units.len() + 1),
			},
			true,
		)
		.unwrap()
	}

	#[test]
	fn slices_preserve_ecmascript_trimming_empty_endpoints_and_unpaired_surrogates() {
		let first = [32, 9, 0xFEFF, 97, 0xD800, 32];
		let second = [0x2007, 0x0085, 0xDC00, 0x2028];
		let range = TextRange {
			start: position(4, 2),
			end: position(5, 5),
		};
		let slice = CharacterSequence::new(&[&first, &second], range, false).unwrap();
		assert_eq!(
			(
				slice.elements.as_slice(),
				slice.translate_range(&(0..3)),
				slice.translate_range(&(3..3))
			),
			(
				[97, 0xD800, 10, 0x0085, 0xDC00].as_slice(),
				TextRange {
					start: position(4, 4),
					end: position(5, 1)
				},
				TextRange {
					start: position(5, 1),
					end: position(5, 1)
				},
			)
		);
		let empty = CharacterSequence::new(
			&[&[9, 32]],
			TextRange {
				start: position(1, 1),
				end: position(1, 2),
			},
			false,
		)
		.unwrap();
		assert_eq!(
			empty.translate_range(&(0..0)),
			TextRange {
				start: position(1, 1),
				end: position(1, 1)
			}
		);
		assert!(matches!(
			CharacterSequence::new(&[], range, true),
			Err(SequenceDiffError::InvalidRanges)
		));
	}

	#[test]
	fn word_expansion_preserves_raw_edits_and_existing_uppercase_subword_boundaries() {
		let first: Vec<_> = "abcXdef".encode_utf16().collect();
		let second: Vec<_> = "abcYYYYYYdef".encode_utf16().collect();
		let original = sequence(&first);
		let modified = sequence(&second);
		let result = refine_character_diff(
			&original,
			&modified,
			CharacterDiffOptions {
				include_raw_changes: true,
				extend_to_subwords: false,
			},
			|| true,
		)
		.unwrap();
		let full = TextRange {
			start: position(1, 1),
			end: position(1, 8),
		};
		let raw = TextRange {
			start: position(1, 4),
			end: position(1, 5),
		};
		assert_eq!(
			(
				result.mappings,
				result.raw_changes,
				original.find_word(3, true),
				original.find_word(4, true)
			),
			(
				vec![(
					full,
					TextRange {
						start: position(1, 1),
						end: position(1, 13)
					}
				)],
				vec![(
					raw,
					TextRange {
						start: position(1, 4),
						end: position(1, 10)
					}
				)],
				Some(3..3),
				Some(3..7)
			)
		);
	}

	#[test]
	fn boundary_scores_and_timeout_checkpoints_match_character_alignment() {
		let slice = sequence(&[97, 65, 13, 10, 32, 44]);
		assert_eq!(
			slice.boundary_scores(),
			vec![20.0, 11.0, 20.0, 0.0, 150.0, 43.0, 50.0]
		);
		let original = sequence(&[97; 4]);
		let modified = sequence(&[98; 3]);
		let mut checks = 0;
		let result = refine_character_diff(
			&original,
			&modified,
			CharacterDiffOptions {
				include_raw_changes: true,
				extend_to_subwords: true,
			},
			|| {
				checks += 1;
				checks < 5
			},
		)
		.unwrap();
		assert_eq!(
			(checks, result.hit_timeout, result.raw_changes),
			(
				5,
				true,
				vec![(
					TextRange {
						start: position(1, 1),
						end: position(1, 5)
					},
					TextRange {
						start: position(1, 1),
						end: position(1, 4)
					}
				)]
			)
		);
	}

	#[test]
	fn seeded_display_and_raw_mappings_reconstruct_lossless_utf16_text() {
		let mut seed = 41_u32;
		let mut random = |limit| {
			seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
			seed as usize % limit
		};
		let alphabet = [32, 44, 65, 66, 97, 98, 0xD800, 0xDC00];
		for _ in 0..512 {
			let first: Vec<_> = (0..random(64))
				.map(|_| alphabet[random(alphabet.len())])
				.collect();
			let second: Vec<_> = (0..random(64))
				.map(|_| alphabet[random(alphabet.len())])
				.collect();
			let result = refine_character_diff(
				&sequence(&first),
				&sequence(&second),
				CharacterDiffOptions {
					include_raw_changes: true,
					extend_to_subwords: true,
				},
				|| true,
			)
			.unwrap();
			for mappings in [result.mappings, result.raw_changes] {
				let mut updated = Vec::new();
				let mut offset = 0;
				for (original, modified) in mappings {
					updated.extend_from_slice(&first[offset..original.start.column - 1]);
					updated.extend_from_slice(
						&second[modified.start.column - 1..modified.end.column - 1],
					);
					offset = original.end.column - 1;
				}
				updated.extend_from_slice(&first[offset..]);
				assert_eq!(updated, second);
			}
		}
	}
}
