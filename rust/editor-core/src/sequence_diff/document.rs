/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! The advanced document diff pipeline, sharing borrowed source lines across native stages.

use crate::Position;

use super::{
	CharacterDiffOptions, CharacterSequence, MAX_DYNAMIC_DIFF_CELLS, SequenceDiff,
	SequenceDiffError, TextRange, compute_moved_lines, refine_character_diff, refine_line_diff,
};

/// Options for the existing advanced line diff, including separate unweighted raw changes.
#[derive(Clone, Copy, Default)]
pub struct DocumentDiffOptions {
	pub consider_whitespace_changes: bool,
	pub compute_moves: bool,
	pub extend_to_subwords: bool,
	pub include_raw_changes: bool,
}

/// A half-open line mapping with the character mappings responsible for the change.
#[derive(Debug, PartialEq, Eq)]
pub struct DetailedLineDiff {
	pub ranges: SequenceDiff,
	pub inner_changes: Vec<(TextRange, TextRange)>,
}

/// A moved line block and the display changes within it.
#[derive(Debug, PartialEq, Eq)]
pub struct MovedBlockDiff {
	pub ranges: SequenceDiff,
	pub changes: Vec<DetailedLineDiff>,
}

/// Complete display, move, and raw results in the existing UTF-16 coordinate domains.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct DocumentDiffResult {
	pub changes: Vec<DetailedLineDiff>,
	pub moves: Vec<MovedBlockDiff>,
	pub raw_changes: Vec<(TextRange, TextRange)>,
	pub hit_timeout: bool,
}

/// Runs every advanced diff stage in one scope; no source or temporary state survives the call.
pub fn compute_document_diff(
	original: &[&[u16]],
	modified: &[&[u16]],
	equality_scores: &[f64],
	options: DocumentDiffOptions,
	mut is_valid: impl FnMut() -> bool,
) -> Result<DocumentDiffResult, SequenceDiffError> {
	for lines in [original, modified] {
		if lines.is_empty() {
			return Err(SequenceDiffError::InvalidRanges);
		}
		let length = lines
			.iter()
			.try_fold(lines.len() - 1, |total, line| total.checked_add(line.len()));
		if length.is_none_or(|length| length > MAX_DYNAMIC_DIFF_CELLS) {
			return Err(SequenceDiffError::TooLarge);
		}
	}
	if original.len() <= 1 && original == modified {
		return Ok(DocumentDiffResult::default());
	}
	if original == [&[][..]] || modified == [&[][..]] {
		let full_range = |lines: &[&[u16]]| TextRange {
			start: position(1, 1),
			end: position(lines.len(), lines[lines.len() - 1].len() + 1),
		};
		let mapping = (full_range(original), full_range(modified));
		return Ok(DocumentDiffResult {
			changes: vec![DetailedLineDiff {
				ranges: SequenceDiff {
					original: 0..original.len(),
					modified: 0..modified.len(),
				},
				inner_changes: vec![mapping],
			}],
			raw_changes: if options.include_raw_changes {
				vec![mapping]
			} else {
				vec![]
			},
			..DocumentDiffResult::default()
		});
	}
	let alignment = refine_line_diff(original, modified, equality_scores, &mut is_valid)?;
	let mut result = DocumentDiffResult {
		hit_timeout: alignment.result.hit_timeout,
		..DocumentDiffResult::default()
	};
	let mut mappings = Vec::new();
	let (mut first, mut second) = (0, 0);
	for diff in &alignment.result.diffs {
		if diff.original.start.checked_sub(first) != diff.modified.start.checked_sub(second) {
			return Err(SequenceDiffError::InvalidRanges);
		}
		scan_whitespace(
			original,
			modified,
			&SequenceDiff {
				original: first..diff.original.start,
				modified: second..diff.modified.start,
			},
			options,
			&mut result,
			&mut mappings,
			&mut is_valid,
		)?;
		(first, second) = (diff.original.end, diff.modified.end);
		let character = refine_lines(original, modified, diff, options, &mut is_valid)?;
		result.hit_timeout |= character.hit_timeout;
		result.raw_changes.extend(character.raw_changes);
		mappings.extend(character.mappings);
	}
	if original.len() - first != modified.len() - second {
		return Err(SequenceDiffError::InvalidRanges);
	}
	scan_whitespace(
		original,
		modified,
		&SequenceDiff {
			original: first..original.len(),
			modified: second..modified.len(),
		},
		options,
		&mut result,
		&mut mappings,
		&mut is_valid,
	)?;
	result.changes = group_mappings(mappings, original, modified);
	if options.compute_moves {
		let changes: Vec<_> = result
			.changes
			.iter()
			.map(|change| change.ranges.clone())
			.collect();
		let moves = compute_moved_lines(
			&changes,
			original,
			modified,
			&alignment.original_hashes,
			&alignment.modified_hashes,
			&mut is_valid,
		)?;
		for ranges in moves {
			let character = refine_lines(
				original,
				modified,
				&ranges,
				DocumentDiffOptions {
					include_raw_changes: false,
					..options
				},
				&mut is_valid,
			)?;
			// Move-only refinement does not change the document timeout flag in the existing pipeline.
			result.moves.push(MovedBlockDiff {
				ranges,
				changes: group_mappings(character.mappings, original, modified),
			});
		}
	}
	Ok(result)
}

fn scan_whitespace(
	original: &[&[u16]],
	modified: &[&[u16]],
	unchanged: &SequenceDiff,
	options: DocumentDiffOptions,
	result: &mut DocumentDiffResult,
	mappings: &mut Vec<(TextRange, TextRange)>,
	mut is_valid: impl FnMut() -> bool,
) -> Result<(), SequenceDiffError> {
	if options.consider_whitespace_changes {
		let (first, second) = (unchanged.original.start, unchanged.modified.start);
		for offset in 0..unchanged.original.len() {
			if original[first + offset] != modified[second + offset] {
				let character = refine_lines(
					original,
					modified,
					&SequenceDiff {
						original: first + offset..first + offset + 1,
						modified: second + offset..second + offset + 1,
					},
					options,
					&mut is_valid,
				)?;
				result.hit_timeout |= character.hit_timeout;
				result.raw_changes.extend(character.raw_changes);
				mappings.extend(character.mappings);
			}
		}
	}
	Ok(())
}

fn refine_lines(
	original: &[&[u16]],
	modified: &[&[u16]],
	ranges: &SequenceDiff,
	options: DocumentDiffOptions,
	is_valid: impl FnMut() -> bool,
) -> Result<super::CharacterDiffResult, SequenceDiffError> {
	let (first_range, second_range) = text_ranges(ranges, original, modified)?;
	let first = CharacterSequence::new(
		&original[first_range.start.line_number - 1..first_range.end.line_number],
		first_range,
		options.consider_whitespace_changes,
	)?;
	let second = CharacterSequence::new(
		&modified[second_range.start.line_number - 1..second_range.end.line_number],
		second_range,
		options.consider_whitespace_changes,
	)?;
	refine_character_diff(
		&first,
		&second,
		CharacterDiffOptions {
			extend_to_subwords: options.extend_to_subwords,
			include_raw_changes: options.include_raw_changes,
		},
		is_valid,
	)
}

fn position(line_number: usize, column: usize) -> Position {
	Position {
		line_number,
		column,
	}
}

fn text_ranges(
	ranges: &SequenceDiff,
	original: &[&[u16]],
	modified: &[&[u16]],
) -> Result<(TextRange, TextRange), SequenceDiffError> {
	let to_range = |range: &std::ops::Range<usize>, lines: &[&[u16]], preceding: bool| TextRange {
		start: if preceding {
			position(range.start, lines[range.start - 1].len() + 1)
		} else {
			position(range.start + 1, 1)
		},
		end: position(range.end, lines[range.end - 1].len() + 1),
	};
	if ranges.original.end < original.len() && ranges.modified.end < modified.len() {
		let to_range = |range: &std::ops::Range<usize>| TextRange {
			start: position(range.start + 1, 1),
			end: position(range.end + 1, 1),
		};
		Ok((to_range(&ranges.original), to_range(&ranges.modified)))
	} else if !ranges.original.is_empty() && !ranges.modified.is_empty() {
		Ok((
			to_range(&ranges.original, original, false),
			to_range(&ranges.modified, modified, false),
		))
	} else if ranges.original.start > 0 && ranges.modified.start > 0 {
		Ok((
			to_range(&ranges.original, original, true),
			to_range(&ranges.modified, modified, true),
		))
	} else {
		Err(SequenceDiffError::InvalidRanges)
	}
}

fn group_mappings(
	mappings: Vec<(TextRange, TextRange)>,
	original: &[&[u16]],
	modified: &[&[u16]],
) -> Vec<DetailedLineDiff> {
	let mut result: Vec<DetailedLineDiff> = Vec::new();
	let mut previous: Option<SequenceDiff> = None;
	for (first, second) in mappings {
		let end_delta = usize::from(first.end.column == 1 && second.end.column == 1);
		let start_delta = usize::from(
			first.start.column > original[first.start.line_number - 1].len()
				&& second.start.column > modified[second.start.line_number - 1].len()
				&& first.start.line_number <= first.end.line_number - end_delta
				&& second.start.line_number <= second.end.line_number - end_delta,
		);
		let ranges = SequenceDiff {
			original: first.start.line_number - 1 + start_delta..first.end.line_number - end_delta,
			modified: second.start.line_number - 1 + start_delta
				..second.end.line_number - end_delta,
		};
		let touches = |first: &std::ops::Range<usize>, second: &std::ops::Range<usize>| {
			first.start <= second.end && second.start <= first.end
		};
		if previous.as_ref().is_some_and(|previous| {
			touches(&previous.original, &ranges.original)
				|| touches(&previous.modified, &ranges.modified)
		}) {
			let last = result.last_mut().expect("The previous mapping has a group");
			last.ranges.original.start = last.ranges.original.start.min(ranges.original.start);
			last.ranges.original.end = last.ranges.original.end.max(ranges.original.end);
			last.ranges.modified.start = last.ranges.modified.start.min(ranges.modified.start);
			last.ranges.modified.end = last.ranges.modified.end.max(ranges.modified.end);
			last.inner_changes.push((first, second));
		} else {
			result.push(DetailedLineDiff {
				ranges: ranges.clone(),
				inner_changes: vec![(first, second)],
			});
		}
		previous = Some(ranges);
	}
	result
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn line_ranges_translate_document_edges_without_invalid_columns() {
		let original: &[&[u16]] = &[&[97, 98], &[99], &[100]];
		let modified: &[&[u16]] = &[&[97, 98], &[99]];
		for (ranges, expected) in [
			(
				SequenceDiff {
					original: 0..1,
					modified: 0..0,
				},
				(
					TextRange {
						start: position(1, 1),
						end: position(2, 1),
					},
					TextRange {
						start: position(1, 1),
						end: position(1, 1),
					},
				),
			),
			(
				SequenceDiff {
					original: 2..3,
					modified: 2..2,
				},
				(
					TextRange {
						start: position(2, 2),
						end: position(3, 2),
					},
					TextRange {
						start: position(2, 2),
						end: position(2, 2),
					},
				),
			),
			(
				SequenceDiff {
					original: 1..3,
					modified: 1..2,
				},
				(
					TextRange {
						start: position(2, 1),
						end: position(3, 2),
					},
					TextRange {
						start: position(2, 1),
						end: position(2, 2),
					},
				),
			),
		] {
			assert_eq!(text_ranges(&ranges, original, modified).unwrap(), expected);
		}
	}

	#[test]
	fn empty_documents_keep_full_mappings_and_skip_alignment_deadlines() {
		let options = DocumentDiffOptions {
			include_raw_changes: true,
			..DocumentDiffOptions::default()
		};
		let result = compute_document_diff(&[&[]], &[&[0xD800], &[]], &[], options, || {
			panic!("Empty documents do not align")
		})
		.unwrap();
		let mapping = (
			TextRange {
				start: position(1, 1),
				end: position(1, 1),
			},
			TextRange {
				start: position(1, 1),
				end: position(2, 1),
			},
		);
		assert_eq!(
			result,
			DocumentDiffResult {
				changes: vec![DetailedLineDiff {
					ranges: SequenceDiff {
						original: 0..1,
						modified: 0..2
					},
					inner_changes: vec![mapping]
				}],
				raw_changes: vec![mapping],
				..DocumentDiffResult::default()
			}
		);
		assert_eq!(
			compute_document_diff(&[&[97]], &[&[97]], &[], options, || panic!(
				"Equal single lines do not align"
			))
			.unwrap(),
			DocumentDiffResult::default()
		);
	}

	#[test]
	fn moved_block_expiration_keeps_the_existing_document_timeout_flag() {
		let original: &[&[u16]] = &[
			&[97; 16], &[98; 16], &[99; 16], &[100; 16], &[101; 16], &[102; 16],
		];
		let modified: Vec<_> = original[3..]
			.iter()
			.chain(&original[..3])
			.copied()
			.collect();
		let options = DocumentDiffOptions {
			consider_whitespace_changes: true,
			include_raw_changes: true,
			..DocumentDiffOptions::default()
		};
		let mut checks = 0;
		let reference = compute_document_diff(original, &modified, &[1.0; 6], options, || {
			checks += 1;
			true
		})
		.unwrap();
		let budget = checks;
		checks = 0;
		let actual = compute_document_diff(
			original,
			&modified,
			&[1.0; 6],
			DocumentDiffOptions {
				compute_moves: true,
				..options
			},
			|| {
				checks += 1;
				checks <= budget
			},
		)
		.unwrap();
		assert_eq!(actual, reference);
	}

	#[test]
	fn seeded_document_display_and_raw_changes_reconstruct_lossless_text() {
		let mut seed = 43_u32;
		let mut random = |limit| {
			seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
			seed as usize % limit
		};
		let alphabet = [32, 65, 97, 98, 0xFEFF, 0x0085, 0xD800, 0xDC00];
		for _ in 0..256 {
			let mut create = || {
				(0..1 + random(8))
					.map(|_| {
						(0..random(16))
							.map(|_| alphabet[random(alphabet.len())])
							.collect::<Vec<_>>()
					})
					.collect::<Vec<_>>()
			};
			let original = create();
			let modified = create();
			let first: Vec<_> = original.iter().map(Vec::as_slice).collect();
			let second: Vec<_> = modified.iter().map(Vec::as_slice).collect();
			let result = compute_document_diff(
				&first,
				&second,
				&vec![1.0; second.len()],
				DocumentDiffOptions {
					consider_whitespace_changes: true,
					include_raw_changes: true,
					compute_moves: true,
					extend_to_subwords: true,
				},
				|| true,
			)
			.unwrap();
			let original_text = first.join(&10);
			let modified_text = second.join(&10);
			let offset = |lines: &[&[u16]], position: Position| {
				lines[..position.line_number - 1]
					.iter()
					.map(|line| line.len() + 1)
					.sum::<usize>() + position.column
					- 1
			};
			for mappings in [
				result.raw_changes,
				result
					.changes
					.into_iter()
					.flat_map(|change| change.inner_changes)
					.collect(),
			] {
				let mut text = Vec::new();
				let mut start = 0;
				for (original, modified) in mappings {
					text.extend_from_slice(&original_text[start..offset(&first, original.start)]);
					text.extend_from_slice(
						&modified_text
							[offset(&second, modified.start)..offset(&second, modified.end)],
					);
					start = offset(&first, original.end);
				}
				text.extend_from_slice(&original_text[start..]);
				assert_eq!(text, modified_text);
			}
		}
	}
}
