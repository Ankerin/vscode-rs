/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use super::{SequenceDiff, SequenceDiffError};

/// Immutable sequence data needed by the editor's shift and join heuristics.
pub struct OptimizationSequence<'a, T = f64, S = u32> {
	pub elements: &'a [T],
	pub strong_elements: &'a [S],
	pub boundary_scores: &'a [f64],
}

/// Joins edits by shifting twice, then aligns insertions/deletions at scored boundaries.
pub fn optimize_sequence_diffs<T: PartialEq, S: PartialEq>(
	original: OptimizationSequence<'_, T, S>,
	modified: OptimizationSequence<'_, T, S>,
	diffs: &[SequenceDiff],
) -> Result<Vec<SequenceDiff>, SequenceDiffError> {
	for sequence in [&original, &modified] {
		if sequence.strong_elements.len() != sequence.elements.len()
			|| (!sequence.boundary_scores.is_empty()
				&& sequence.boundary_scores.len() != sequence.elements.len() + 1)
		{
			return Err(SequenceDiffError::InvalidScores);
		}
	}
	let (mut last1, mut last2) = (0, 0);
	for diff in diffs {
		if diff.original.start > diff.original.end
			|| diff.modified.start > diff.modified.end
			|| diff.original.end > original.elements.len()
			|| diff.modified.end > modified.elements.len()
			|| diff.original.start < last1
			|| diff.modified.start < last2
			|| diff.original.start - last1 != diff.modified.start - last2
		{
			return Err(SequenceDiffError::InvalidRanges);
		}
		(last1, last2) = (diff.original.end, diff.modified.end);
	}
	let mut result = join_by_shifting(&original, &modified, diffs);
	result = join_by_shifting(&original, &modified, &result);
	if !original.boundary_scores.is_empty() && !modified.boundary_scores.is_empty() {
		for index in 0..result.len() {
			let start1 = if index > 0 {
				result[index - 1].original.end + 1
			} else {
				0
			};
			let start2 = if index > 0 {
				result[index - 1].modified.end + 1
			} else {
				0
			};
			let end1 = if index + 1 < result.len() {
				result[index + 1]
					.original
					.start
					.checked_sub(1)
					.ok_or(SequenceDiffError::InvalidRanges)?
			} else {
				original.elements.len()
			};
			let end2 = if index + 1 < result.len() {
				result[index + 1]
					.modified
					.start
					.checked_sub(1)
					.ok_or(SequenceDiffError::InvalidRanges)?
			} else {
				modified.elements.len()
			};
			if start1 > end1 || start2 > end2 {
				return Err(SequenceDiffError::InvalidRanges);
			}
			let diff = &result[index];
			if diff.original.is_empty() {
				result[index] =
					shift_to_boundary(diff, &original, &modified, start1, end1, start2, end2);
			} else if diff.modified.is_empty() {
				let swapped = SequenceDiff {
					original: diff.modified.clone(),
					modified: diff.original.clone(),
				};
				let shifted =
					shift_to_boundary(&swapped, &modified, &original, start2, end2, start1, end1);
				result[index] = SequenceDiff {
					original: shifted.modified,
					modified: shifted.original,
				};
			}
		}
	}
	Ok(result)
}

fn shift(diff: &SequenceDiff, delta: isize) -> SequenceDiff {
	let offset = |value: usize| {
		value
			.checked_add_signed(delta)
			.expect("The shift stays inside validated sequence bounds")
	};
	SequenceDiff {
		original: offset(diff.original.start)..offset(diff.original.end),
		modified: offset(diff.modified.start)..offset(diff.modified.end),
	}
}

fn join_by_shifting<T: PartialEq, S: PartialEq>(
	original: &OptimizationSequence<'_, T, S>,
	modified: &OptimizationSequence<'_, T, S>,
	diffs: &[SequenceDiff],
) -> Vec<SequenceDiff> {
	let Some(first) = diffs.first() else {
		return Vec::new();
	};
	let mut left = vec![first.clone()];
	for diff in &diffs[1..] {
		let previous = left.last().expect("The first diff was retained");
		let mut current = diff.clone();
		if current.original.is_empty() || current.modified.is_empty() {
			let length = current.original.start - previous.original.end;
			let mut delta = 0;
			while delta < length
				&& original.elements[current.original.start - delta - 1]
					== original.elements[current.original.end - delta - 1]
				&& modified.elements[current.modified.start - delta - 1]
					== modified.elements[current.modified.end - delta - 1]
			{
				delta += 1;
			}
			if delta == length {
				let joined = SequenceDiff {
					original: previous.original.start..current.original.end - length,
					modified: previous.modified.start..current.modified.end - length,
				};
				*left.last_mut().expect("The first diff was retained") = joined;
				continue;
			}
			current = shift(&current, -(delta as isize));
		}
		left.push(current);
	}
	let mut right = Vec::with_capacity(left.len());
	for index in 0..left.len() - 1 {
		let mut current = left[index].clone();
		let next = &left[index + 1];
		if current.original.is_empty() || current.modified.is_empty() {
			let length = next.original.start - current.original.end;
			let mut delta = 0;
			while delta < length
				&& original.strong_elements[current.original.start + delta]
					== original.strong_elements[current.original.end + delta]
				&& modified.strong_elements[current.modified.start + delta]
					== modified.strong_elements[current.modified.end + delta]
			{
				delta += 1;
			}
			if delta == length {
				left[index + 1] = SequenceDiff {
					original: current.original.start + length..next.original.end,
					modified: current.modified.start + length..next.modified.end,
				};
				continue;
			}
			current = shift(&current, delta as isize);
		}
		right.push(current);
	}
	right.push(left.last().expect("At least one diff was retained").clone());
	right
}

fn shift_to_boundary<T, S: PartialEq>(
	diff: &SequenceDiff,
	original: &OptimizationSequence<'_, T, S>,
	modified: &OptimizationSequence<'_, T, S>,
	start1: usize,
	end1: usize,
	start2: usize,
	end2: usize,
) -> SequenceDiff {
	let mut before = 0;
	while before < 99
		&& diff.original.start > start1 + before
		&& diff.modified.start > start2 + before
		&& modified.strong_elements[diff.modified.start - before - 1]
			== modified.strong_elements[diff.modified.end - before - 1]
	{
		before += 1;
	}
	let mut after = 0;
	while after < 100
		&& diff.original.start + after < end1
		&& diff.modified.end + after < end2
		&& modified.strong_elements[diff.modified.start + after]
			== modified.strong_elements[diff.modified.end + after]
	{
		after += 1;
	}
	if before == 0 && after == 0 {
		return diff.clone();
	}
	let mut best_delta = 0;
	let mut best_score = -1.0;
	for delta in -(before as isize)..=after as isize {
		let offset1 = diff
			.original
			.start
			.checked_add_signed(delta)
			.expect("The candidate shift is bounded");
		let offset2 = diff
			.modified
			.start
			.checked_add_signed(delta)
			.expect("The candidate shift is bounded");
		let end2 = diff
			.modified
			.end
			.checked_add_signed(delta)
			.expect("The candidate shift is bounded");
		let score = original.boundary_scores[offset1]
			+ modified.boundary_scores[offset2]
			+ modified.boundary_scores[end2];
		if score > best_score {
			best_score = score;
			best_delta = delta;
		}
	}
	shift(diff, best_delta)
}

#[cfg(test)]
mod tests {
	use super::*;

	fn sequence<'a>(
		elements: &'a [f64],
		strong: &'a [u32],
		scores: &'a [f64],
	) -> OptimizationSequence<'a> {
		OptimizationSequence {
			elements,
			strong_elements: strong,
			boundary_scores: scores,
		}
	}

	#[test]
	fn joining_insertions_keeps_original_coordinates_and_combined_text_length() {
		let diffs = [
			SequenceDiff {
				original: 2..2,
				modified: 2..3,
			},
			SequenceDiff {
				original: 4..4,
				modified: 5..6,
			},
		];
		let result = optimize_sequence_diffs(
			sequence(&[1.0; 8], &[1; 8], &[]),
			sequence(&[1.0; 10], &[1; 10], &[]),
			&diffs,
		)
		.unwrap();
		assert_eq!(
			result,
			vec![SequenceDiff {
				original: 2..2,
				modified: 2..4
			}]
		);
	}

	#[test]
	fn boundary_shifts_preserve_score_preference_and_the_original_shift_limit() {
		let diffs = [SequenceDiff {
			original: 1..1,
			modified: 1..2,
		}];
		let result = optimize_sequence_diffs(
			sequence(&[1.0; 4], &[1; 4], &[0.0, 0.0, 0.0, 100.0, 0.0]),
			sequence(&[1.0; 5], &[1; 5], &[0.0; 6]),
			&diffs,
		)
		.unwrap();
		assert_eq!(
			result,
			vec![SequenceDiff {
				original: 3..3,
				modified: 3..4
			}]
		);
		let result = optimize_sequence_diffs(
			sequence(&[1.0; 512], &[1; 512], &[0.0; 513]),
			sequence(&[1.0; 513], &[1; 513], &[0.0; 514]),
			&[SequenceDiff {
				original: 100..100,
				modified: 100..101,
			}],
		)
		.unwrap();
		assert_eq!(
			result,
			vec![SequenceDiff {
				original: 1..1,
				modified: 1..2
			}]
		);
	}

	#[test]
	fn invalid_identity_lengths_and_inconsistent_diff_ranges_are_rejected() {
		assert_eq!(
			optimize_sequence_diffs(sequence(&[1.0], &[], &[]), sequence(&[1.0], &[0], &[]), &[]),
			Err(SequenceDiffError::InvalidScores)
		);
		assert_eq!(
			optimize_sequence_diffs(
				sequence(&[1.0; 4], &[0; 4], &[]),
				sequence(&[1.0; 4], &[0; 4], &[]),
				&[SequenceDiff {
					original: 1..2,
					modified: 2..3
				}]
			),
			Err(SequenceDiffError::InvalidRanges)
		);
	}
}
