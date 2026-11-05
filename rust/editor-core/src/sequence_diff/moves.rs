/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! The existing moved-block matching, selection, extension, and filtering rules.

use std::{
	cmp::Reverse,
	collections::{HashMap, VecDeque},
	ops::Range,
};

use crate::Position;

use super::{
	CharacterSequence, SequenceDiff, SequenceDiffError, TextRange, myers_diff, refinement::trim,
};

const MAX_POSSIBLE_MOVES: usize = 262_144;

/// Detects moved blocks in zero-based half-open line coordinates, preserving input-order ties.
pub fn compute_moved_lines(
	changes: &[SequenceDiff],
	original: &[&[u16]],
	modified: &[&[u16]],
	original_hashes: &[u32],
	modified_hashes: &[u32],
	mut is_valid: impl FnMut() -> bool,
) -> Result<Vec<SequenceDiff>, SequenceDiffError> {
	if original_hashes.len() != original.len() || modified_hashes.len() != modified.len() {
		return Err(SequenceDiffError::InvalidRanges);
	}
	let (mut last1, mut last2) = (0, 0);
	for change in changes {
		if change.original.start > change.original.end
			|| change.modified.start > change.modified.end
			|| change.original.end > original.len()
			|| change.modified.end > modified.len()
			|| change.original.start < last1
			|| change.modified.start < last2
		{
			return Err(SequenceDiffError::InvalidRanges);
		}
		(last1, last2) = (change.original.end, change.modified.end);
	}
	let mut excluded = vec![false; changes.len()];
	let deletions: Vec<_> = changes
		.iter()
		.enumerate()
		.filter(|(_, change)| change.modified.is_empty() && change.original.len() >= 3)
		.map(|(index, change)| (index, Histogram::new(&original[change.original.clone()])))
		.collect();
	let mut insertions: Vec<_> = changes
		.iter()
		.enumerate()
		.filter(|(_, change)| change.original.is_empty() && change.modified.len() >= 3)
		.map(|(index, change)| (index, Histogram::new(&modified[change.modified.clone()])))
		.collect();
	let mut moves = Vec::new();
	for (deletion, histogram) in deletions {
		let mut best = None;
		let mut highest = -1.0;
		for (index, (_, insertion)) in insertions.iter().enumerate() {
			let similarity = histogram.similarity(insertion);
			if similarity > highest {
				highest = similarity;
				best = Some(index);
			}
		}
		if highest > 0.90
			&& let Some(index) = best
		{
			let (insertion, _) = insertions.remove(index);
			excluded[deletion] = true;
			excluded[insertion] = true;
			moves.push(SequenceDiff {
				original: changes[deletion].original.clone(),
				modified: changes[insertion].modified.clone(),
			});
		}
		if !is_valid() {
			break;
		}
	}
	if !is_valid() {
		return Ok(Vec::new());
	}
	let mut filtered: Vec<_> = changes
		.iter()
		.enumerate()
		.filter(|(index, _)| !excluded[*index])
		.map(|(_, change)| change.clone())
		.collect();
	moves.extend(unchanged_moves(
		&mut filtered,
		original,
		modified,
		original_hashes,
		modified_hashes,
		&mut is_valid,
	)?);
	moves.sort_by_key(|mapping| mapping.original.start);
	let mut joined: Vec<SequenceDiff> = Vec::with_capacity(moves.len());
	for current in moves {
		if let Some(last) = joined.last_mut()
			&& current.original.start >= last.original.end
			&& current.modified.start >= last.modified.end
			&& current.original.start - last.original.end + current.modified.start
				- last.modified.end
				<= 2
		{
			last.original.end = current.original.end;
			last.modified.end = current.modified.end;
		} else {
			joined.push(current);
		}
	}
	joined.retain(|mapping| {
		let lines = &original[mapping.original.clone()];
		let length = lines.iter().map(|line| trim(line).len()).sum::<usize>()
			+ lines.len().saturating_sub(1);
		length >= 15
			&& lines
				.iter()
				.filter(|line| trim(line).len() >= 2)
				.take(2)
				.count() >= 2
	});
	joined.retain(|mapping| {
		let first = changes
			.partition_point(|change| change.original.start < mapping.original.end)
			.checked_sub(1);
		let second = changes
			.partition_point(|change| change.modified.start < mapping.modified.end)
			.checked_sub(1);
		first.is_none() || first != second
	});
	Ok(joined)
}

struct Histogram {
	units: HashMap<u16, usize>,
	total: usize,
}

impl Histogram {
	fn new(lines: &[&[u16]]) -> Self {
		let mut units = HashMap::new();
		let mut total = 0;
		for line in lines {
			for &unit in line.iter().chain(std::iter::once(&10)) {
				*units.entry(unit).or_insert(0) += 1;
				total += 1;
			}
		}
		Self { units, total }
	}

	fn similarity(&self, other: &Self) -> f64 {
		let difference = self
			.units
			.iter()
			.map(|(unit, &count)| count.abs_diff(other.units.get(unit).copied().unwrap_or(0)))
			.sum::<usize>()
			+ other
				.units
				.iter()
				.filter(|(unit, _)| !self.units.contains_key(unit))
				.map(|(_, &count)| count)
				.sum::<usize>();
		1.0 - difference as f64 / (self.total + other.total) as f64
	}
}

fn unchanged_moves(
	changes: &mut [SequenceDiff],
	original: &[&[u16]],
	modified: &[&[u16]],
	original_hashes: &[u32],
	modified_hashes: &[u32],
	mut is_valid: impl FnMut() -> bool,
) -> Result<Vec<SequenceDiff>, SequenceDiffError> {
	let mut triples = HashMap::<[u32; 3], Vec<usize>>::new();
	for change in changes.iter() {
		for offset in change.original.start..change.original.end.saturating_sub(2) {
			triples
				.entry([
					original_hashes[offset],
					original_hashes[offset + 1],
					original_hashes[offset + 2],
				])
				.or_default()
				.push(offset);
		}
	}
	changes.sort_by_key(|change| change.modified.start);
	let mut possible: Vec<SequenceDiff> = Vec::new();
	for change in changes.iter() {
		let mut last_mappings: Vec<usize> = Vec::new();
		for offset in change.modified.start..change.modified.end.saturating_sub(2) {
			// Preserve first-match order and recheck aliases after an earlier extension mutates them.
			let mut extensions = HashMap::<usize, VecDeque<usize>>::new();
			for &index in &last_mappings {
				if possible[index].modified.end == offset + 2 {
					extensions
						.entry(possible[index].original.end)
						.or_default()
						.push_back(index);
				}
			}
			let key = [
				modified_hashes[offset],
				modified_hashes[offset + 1],
				modified_hashes[offset + 2],
			];
			let mut next_mappings = Vec::new();
			for &first in triples.get(&key).into_iter().flatten() {
				let extension = extensions.get_mut(&(first + 2)).and_then(|indices| {
					while let Some(index) = indices.pop_front() {
						if possible[index].original.end == first + 2
							&& possible[index].modified.end == offset + 2
						{
							return Some(index);
						}
					}
					None
				});
				let index = if let Some(index) = extension {
					possible[index].original.end = first + 3;
					possible[index].modified.end = offset + 3;
					index
				} else {
					if possible.len() >= MAX_POSSIBLE_MOVES {
						return Err(SequenceDiffError::TooLarge);
					}
					possible
						.try_reserve(1)
						.map_err(|_| SequenceDiffError::AllocationFailed)?;
					possible.push(SequenceDiff {
						original: first..first + 3,
						modified: offset..offset + 3,
					});
					possible.len() - 1
				};
				next_mappings.push(index);
			}
			last_mappings = next_mappings;
		}
		if !is_valid() {
			return Ok(Vec::new());
		}
	}
	possible.sort_by_key(|mapping| Reverse(mapping.modified.len()));
	let mut original_set = RangeSet::default();
	let mut modified_set = RangeSet::default();
	let mut moves = Vec::new();
	for mapping in possible {
		let delta = mapping.modified.start as isize - mapping.original.start as isize;
		let first = modified_set.subtract(&mapping.modified);
		let second: Vec<_> = original_set
			.subtract(&mapping.original)
			.iter()
			.map(|range| shift(range, delta))
			.collect();
		for section in intersection(&first, &second) {
			if section.len() < 3 {
				continue;
			}
			let original_range = shift(&section, -delta);
			original_set.add(original_range.clone());
			modified_set.add(section.clone());
			moves.push(SequenceDiff {
				original: original_range,
				modified: section,
			});
		}
	}
	moves.sort_by_key(|mapping| mapping.original.start);
	for mapping in &mut moves {
		let find = |original: bool, offset, inclusive| {
			changes
				.partition_point(|change| {
					let start = if original {
						change.original.start
					} else {
						change.modified.start
					};
					start < offset || (inclusive && start == offset)
				})
				.checked_sub(1)
				.ok_or(SequenceDiffError::InvalidRanges)
		};
		let (first1, first2) = (
			find(true, mapping.original.start, true)?,
			find(false, mapping.modified.start, true)?,
		);
		let (last1, last2) = (
			find(true, mapping.original.end, false)?,
			find(false, mapping.modified.end, false)?,
		);
		let above = (mapping.original.start - changes[first1].original.start)
			.max(mapping.modified.start - changes[first2].modified.start);
		let below = changes[last1]
			.original
			.end
			.saturating_sub(mapping.original.end)
			.max(
				changes[last2]
					.modified
					.end
					.saturating_sub(mapping.modified.end),
			);
		let mut top = 0;
		while top < above {
			let Some(one) = mapping.original.start.checked_sub(top + 1) else {
				break;
			};
			let Some(two) = mapping.modified.start.checked_sub(top + 1) else {
				break;
			};
			if original_set.contains(one)
				|| modified_set.contains(two)
				|| !lines_similar(original[one], modified[two], &mut is_valid)?
			{
				break;
			}
			top += 1;
		}
		if top > 0 {
			original_set.add(mapping.original.start - top..mapping.original.start);
			modified_set.add(mapping.modified.start - top..mapping.modified.start);
		}
		let mut bottom = 0;
		while bottom < below {
			let one = mapping.original.end + bottom;
			let two = mapping.modified.end + bottom;
			if one >= original.len()
				|| two >= modified.len()
				|| original_set.contains(one)
				|| modified_set.contains(two)
				|| !lines_similar(original[one], modified[two], &mut is_valid)?
			{
				break;
			}
			bottom += 1;
		}
		if bottom > 0 {
			original_set.add(mapping.original.end..mapping.original.end + bottom);
			modified_set.add(mapping.modified.end..mapping.modified.end + bottom);
		}
		mapping.original = mapping.original.start - top..mapping.original.end + bottom;
		mapping.modified = mapping.modified.start - top..mapping.modified.end + bottom;
	}
	Ok(moves)
}

fn lines_similar(
	original: &[u16],
	modified: &[u16],
	is_valid: impl FnMut() -> bool,
) -> Result<bool, SequenceDiffError> {
	if trim(original) == trim(modified) {
		return Ok(true);
	}
	if original.len() > 300 && modified.len() > 300 {
		return Ok(false);
	}
	let sequence = |line: &[u16]| {
		CharacterSequence::new(
			&[line],
			TextRange {
				start: Position {
					line_number: 1,
					column: 1,
				},
				end: Position {
					line_number: 1,
					column: line.len().max(1),
				},
			},
			false,
		)
	};
	let (first, second) = (sequence(original)?, sequence(modified)?);
	let result = myers_diff(first.elements(), second.elements(), is_valid)?;
	let is_space = |unit: u16| unit == 9 || unit == 32;
	// Complement offsets are counted in the untrimmed original, including its tail.
	let mut common = 0;
	let mut start = 0;
	for diff in result.diffs {
		common += original[start..diff.original.start]
			.iter()
			.filter(|&&unit| !is_space(unit))
			.count();
		start = diff.original.end;
	}
	common += original[start..]
		.iter()
		.filter(|&&unit| !is_space(unit))
		.count();
	// Both denominator variants use the original line length in the reference.
	let longer = if original.len() > modified.len() {
		original
	} else {
		modified
	};
	let length = longer[..original.len()]
		.iter()
		.filter(|&&unit| !is_space(unit))
		.count();
	Ok(common as f64 / length as f64 > 0.6 && length > 10)
}

fn shift(range: &Range<usize>, delta: isize) -> Range<usize> {
	range
		.start
		.checked_add_signed(delta)
		.expect("The move translation is bounded")
		..range
			.end
			.checked_add_signed(delta)
			.expect("The move translation is bounded")
}

#[derive(Default)]
struct RangeSet {
	ranges: Vec<Range<usize>>,
}

impl RangeSet {
	fn contains(&self, offset: usize) -> bool {
		let index = self.ranges.partition_point(|range| range.start <= offset);
		index > 0 && offset < self.ranges[index - 1].end
	}

	fn add(&mut self, mut range: Range<usize>) {
		let start = self
			.ranges
			.partition_point(|current| current.end < range.start);
		let mut end = start;
		while end < self.ranges.len() && self.ranges[end].start <= range.end {
			range.start = range.start.min(self.ranges[end].start);
			range.end = range.end.max(self.ranges[end].end);
			end += 1;
		}
		self.ranges.splice(start..end, [range]);
	}

	fn subtract(&self, range: &Range<usize>) -> Vec<Range<usize>> {
		let mut result = Vec::new();
		let mut start = range.start;
		for current in &self.ranges {
			if current.end <= start {
				continue;
			}
			if current.start >= range.end {
				break;
			}
			if start < current.start {
				result.push(start..current.start);
			}
			start = start.max(current.end).min(range.end);
		}
		if start < range.end {
			result.push(start..range.end);
		}
		result
	}
}

fn intersection(first: &[Range<usize>], second: &[Range<usize>]) -> Vec<Range<usize>> {
	let mut result = Vec::new();
	let (mut one, mut two) = (0, 0);
	while one < first.len() && two < second.len() {
		let start = first[one].start.max(second[two].start);
		let end = first[one].end.min(second[two].end);
		if start < end {
			result.push(start..end);
		}
		if first[one].end < second[two].end {
			one += 1;
		} else {
			two += 1;
		}
	}
	result
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn range_sets_preserve_half_open_subtraction_and_intersection() {
		let mut set = RangeSet::default();
		for range in [8..10, 2..4, 4..6, 12..14, 9..13] {
			set.add(range);
		}
		assert_eq!(
			(
				set.ranges.clone(),
				set.subtract(&(0..16)),
				set.subtract(&(3..9)),
				intersection(&[0..4, 6..10], &[2..8, 9..12]),
				[1, 2, 5, 6, 8, 13, 14].map(|offset| set.contains(offset))
			),
			(
				vec![2..6, 8..14],
				vec![0..2, 6..8, 14..16],
				std::iter::once(6..8).collect::<Vec<_>>(),
				vec![2..4, 6..8, 9..10],
				[false, true, true, false, true, true, false]
			)
		);
	}

	#[test]
	fn histogram_counts_utf16_units_and_one_newline_per_line() {
		let first = Histogram::new(&[&[0xD800, 0xDC00], &[]]);
		let second = Histogram::new(&[&[0xD800, 0xDFFF], &[]]);
		assert_eq!(
			(
				first.total,
				first.units[&10],
				first.similarity(&second),
				first.similarity(&first)
			),
			(4, 2, 0.75, 1.0)
		);
	}

	#[test]
	fn line_similarity_keeps_tail_exclusion_trim_and_length_quirks() {
		let units = |text: &str| text.encode_utf16().collect::<Vec<_>>();
		for (first, second, expected) in [
			("abcdefghijX", "abcdefghijY", true),
			("abcdefghiX", "abcdefghiY", false),
			("abcdefghijX", "zyxwvutsrqY", false),
			("\u{FEFF}abc\u{2007}", "abc", true),
			("", "different", false),
		] {
			assert_eq!(
				lines_similar(&units(first), &units(second), || true).unwrap(),
				expected
			);
		}
		assert!(!lines_similar(&[97; 301], &[98; 301], || true).unwrap());
		assert!(
			lines_similar(&[0xD800], &[0xD800], || panic!(
				"Equal trimmed lines do not align"
			))
			.unwrap()
		);
	}

	#[test]
	fn moved_blocks_keep_simple_matches_filtering_and_expiration() {
		let text = [
			"alpha line one",
			"alpha line two",
			"alpha line three",
			"beta line one",
			"beta line two",
			"beta line three",
		];
		let units: Vec<Vec<u16>> = text
			.iter()
			.map(|line| line.encode_utf16().collect())
			.collect();
		let first: Vec<_> = units.iter().map(Vec::as_slice).collect();
		let second: Vec<_> = first[3..].iter().chain(&first[..3]).copied().collect();
		let changes = [
			SequenceDiff {
				original: 0..3,
				modified: 0..0,
			},
			SequenceDiff {
				original: 6..6,
				modified: 3..6,
			},
		];
		let compute = |valid| {
			compute_moved_lines(
				&changes,
				&first,
				&second,
				&[0, 1, 2, 3, 4, 5],
				&[3, 4, 5, 0, 1, 2],
				|| valid,
			)
			.unwrap()
		};
		assert_eq!(
			(compute(true), compute(false)),
			(
				vec![SequenceDiff {
					original: 0..3,
					modified: 3..6
				}],
				vec![]
			)
		);
		let short: &[&[u16]] = &[&[97], &[98], &[99], &[100], &[101], &[102]];
		assert!(
			compute_moved_lines(&changes, short, short, &[0; 6], &[0; 6], || true)
				.unwrap()
				.is_empty()
		);
		assert!(matches!(
			compute_moved_lines(&changes, &first, &second, &[], &[0; 6], || true),
			Err(SequenceDiffError::InvalidRanges)
		));
	}
}
