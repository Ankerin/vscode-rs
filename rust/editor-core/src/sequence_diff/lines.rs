/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Lossless line identities and the existing line-level alignment/refinement pipeline.

use std::collections::HashMap;

use super::{
	LineEqualityScores, MAX_DYNAMIC_DIFF_CELLS, OptimizationSequence, SequenceDiff,
	SequenceDiffError, SequenceDiffResult, dynamic_programming_diff, myers_diff,
	optimize_sequence_diffs,
	refinement::{is_whitespace, trim},
};

#[derive(Debug, PartialEq, Eq)]
pub struct LineDiffResult {
	pub result: SequenceDiffResult,
	pub original_hashes: Vec<u32>,
	pub modified_hashes: Vec<u32>,
}

/// Builds exact/trimmed line identities, aligns lines, shifts edits, and joins short matches.
/// The exact equality weights come from the existing JavaScript logarithm implementation.
pub fn refine_line_diff<'a>(
	original: &[&'a [u16]],
	modified: &[&'a [u16]],
	equality_scores: &[f64],
	mut is_valid: impl FnMut() -> bool,
) -> Result<LineDiffResult, SequenceDiffError> {
	if original.len().saturating_add(modified.len()) > MAX_DYNAMIC_DIFF_CELLS {
		return Err(SequenceDiffError::TooLarge);
	}
	let mut identities = HashMap::new();
	let original_hashes: Vec<_> = original
		.iter()
		.map(|line| identity(&mut identities, trim(line)))
		.collect();
	let modified_hashes: Vec<_> = modified
		.iter()
		.map(|line| identity(&mut identities, trim(line)))
		.collect();
	drop(identities);
	let result = if original.len() + modified.len() < 1700 {
		let mut exact = HashMap::new();
		let original_exact: Vec<_> = original
			.iter()
			.map(|line| identity(&mut exact, line))
			.collect();
		let modified_exact: Vec<_> = modified
			.iter()
			.map(|line| identity(&mut exact, line))
			.collect();
		dynamic_programming_diff(
			&original_hashes,
			&modified_hashes,
			Some(LineEqualityScores {
				original: &original_exact,
				modified: &modified_exact,
				scores: equality_scores,
			}),
			&mut is_valid,
		)?
	} else {
		myers_diff(&original_hashes, &modified_hashes, &mut is_valid)?
	};
	let original_scores = boundary_scores(original);
	let modified_scores = boundary_scores(modified);
	let diffs = optimize_sequence_diffs(
		OptimizationSequence {
			elements: &original_hashes,
			strong_elements: original,
			boundary_scores: &original_scores,
		},
		OptimizationSequence {
			elements: &modified_hashes,
			strong_elements: modified,
			boundary_scores: &modified_scores,
		},
		&result.diffs,
	)?;
	let diffs = remove_short_matching_lines(original, diffs);
	Ok(LineDiffResult {
		result: SequenceDiffResult {
			diffs,
			hit_timeout: result.hit_timeout,
		},
		original_hashes,
		modified_hashes,
	})
}

fn identity<'a>(identities: &mut HashMap<&'a [u16], u32>, line: &'a [u16]) -> u32 {
	let next = identities.len() as u32;
	*identities.entry(line).or_insert(next)
}

fn boundary_scores(lines: &[&[u16]]) -> Vec<f64> {
	let indentation = |line: &[u16]| {
		line.iter()
			.take_while(|&&unit| unit == 9 || unit == 32)
			.count()
	};
	(0..=lines.len())
		.map(|offset| {
			let before = offset
				.checked_sub(1)
				.map_or(0, |index| indentation(lines[index]));
			let after = lines.get(offset).map_or(0, |line| indentation(line));
			1000.0 - (before + after) as f64
		})
		.collect()
}

fn remove_short_matching_lines(
	original: &[&[u16]],
	mut diffs: Vec<SequenceDiff>,
) -> Vec<SequenceDiff> {
	for _ in 0..11 {
		let mut result: Vec<SequenceDiff> = Vec::with_capacity(diffs.len());
		let mut repeat = false;
		for current in diffs {
			if let Some(previous) = result.last_mut() {
				let unchanged_units = original[previous.original.end..current.original.start]
					.iter()
					.flat_map(|line| line.iter())
					.filter(|&&unit| !is_whitespace(unit))
					.take(5)
					.count();
				if unchanged_units <= 4
					&& (previous.original.len() + previous.modified.len() > 5
						|| current.original.len() + current.modified.len() > 5)
				{
					previous.original.end = current.original.end;
					previous.modified.end = current.modified.end;
					repeat = true;
					continue;
				}
			}
			result.push(current);
		}
		diffs = result;
		if !repeat {
			break;
		}
	}
	diffs
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn identities_share_ecmascript_trimmed_text_and_keep_surrogates_distinct() {
		let original: &[&[u16]] = &[&[32, 97, 0xFEFF], &[97], &[0xD800], &[0xDC00]];
		let modified: &[&[u16]] = &[&[97], &[0x0085], &[0xD800], &[0xDC00]];
		let result = refine_line_diff(original, modified, &[1.0; 4], || true).unwrap();
		assert_eq!(
			(result.original_hashes, result.modified_hashes),
			(vec![0, 0, 1, 2], vec![0, 3, 1, 2])
		);
		assert!(matches!(
			refine_line_diff(original, modified, &[], || true),
			Err(SequenceDiffError::InvalidScores)
		));
	}

	#[test]
	fn short_line_joins_preserve_non_whitespace_counts_and_negative_boundary_scores() {
		let diffs = vec![
			SequenceDiff {
				original: 0..3,
				modified: 0..3,
			},
			SequenceDiff {
				original: 4..5,
				modified: 4..6,
			},
		];
		let original: &[&[u16]] = &[&[97], &[98], &[99], &[0xFEFF, 0x2007, 32, 98], &[100]];
		assert_eq!(
			remove_short_matching_lines(original, diffs.clone()),
			vec![SequenceDiff {
				original: 0..5,
				modified: 0..6
			}]
		);
		let original: &[&[u16]] = &[&[97], &[98], &[99], &[0x0085; 5], &[100]];
		assert_eq!(remove_short_matching_lines(original, diffs.clone()), diffs);
		assert_eq!(
			boundary_scores(&[&[32; 1001], &[97]]),
			vec![-1.0, -1.0, 1000.0]
		);
	}
}
