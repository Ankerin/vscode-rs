/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use js_sys::Function;
use vscode_editor_core::{
	CharacterDiffOptions, CharacterSequence, DetailedLineDiff, DocumentDiffOptions,
	LineEqualityScores, OptimizationSequence, Position, SequenceDiff, SequenceDiffError,
	SequenceDiffResult, TextRange, compute_document_diff, compute_moved_lines,
	dynamic_programming_diff, myers_diff, optimize_sequence_diffs, refine_character_diff,
	refine_line_diff,
};
use wasm_bindgen::prelude::*;

/// Versions sequence alignment independently of the text storage contract.
#[wasm_bindgen]
pub fn sequence_diff_abi_version() -> u32 {
	8
}

/// Returns document/move groups and character mappings after one shared-source diff computation.
/// Settings use whitespace, move, subword, and raw-change bits, in that order.
#[wasm_bindgen]
pub fn diff_document(
	original: &[u16],
	modified: &[u16],
	original_offsets: &[u32],
	modified_offsets: &[u32],
	equality_scores: &[f64],
	settings: u32,
	deadline: Option<f64>,
) -> Result<Option<Vec<u32>>, JsError> {
	if settings > 15 {
		return Err(SequenceDiffError::InvalidRanges.into());
	}
	let first = unpack_lines(original, original_offsets)?;
	let second = unpack_lines(modified, modified_offsets)?;
	let mut valid = true;
	let result = compute_document_diff(
		&first,
		&second,
		equality_scores,
		DocumentDiffOptions {
			consider_whitespace_changes: settings & 1 != 0,
			compute_moves: settings & 2 != 0,
			extend_to_subwords: settings & 4 != 0,
			include_raw_changes: settings & 8 != 0,
		},
		|| {
			valid = deadline.is_none_or(|deadline| js_sys::Date::now() < deadline) && valid;
			valid
		},
	);
	match result {
		Ok(result) => {
			let mut values = vec![
				u32::from(result.hit_timeout),
				result.changes.len() as u32,
				result.moves.len() as u32,
				result.raw_changes.len() as u32,
			];
			append_detailed_changes(&mut values, result.changes);
			for moved in result.moves {
				append_line_range(&mut values, &moved.ranges);
				values.push(moved.changes.len() as u32);
				append_detailed_changes(&mut values, moved.changes);
			}
			append_text_mappings(&mut values, result.raw_changes);
			Ok(Some(values))
		}
		Err(
			SequenceDiffError::TooLarge
			| SequenceDiffError::AllocationFailed
			| SequenceDiffError::UnrepresentablePath
			| SequenceDiffError::InvalidRanges,
		) => Ok(None),
		Err(error) => Err(error.into()),
	}
}

fn append_detailed_changes(values: &mut Vec<u32>, changes: Vec<DetailedLineDiff>) {
	for change in changes {
		append_line_range(values, &change.ranges);
		values.push(change.inner_changes.len() as u32);
		append_text_mappings(values, change.inner_changes);
	}
}

fn append_text_mappings(
	values: &mut Vec<u32>,
	mappings: impl IntoIterator<Item = (TextRange, TextRange)>,
) {
	for (original, modified) in mappings {
		for range in [original, modified] {
			values.extend([
				range.start.line_number as u32,
				range.start.column as u32,
				range.end.line_number as u32,
				range.end.column as u32,
			]);
		}
	}
}

fn append_line_range(values: &mut Vec<u32>, range: &SequenceDiff) {
	values.extend([
		range.original.start as u32,
		range.original.end as u32,
		range.modified.start as u32,
		range.modified.end as u32,
	]);
}

/// Detects moved blocks from validated line changes and shared trimmed line identities.
#[wasm_bindgen]
pub fn moved_lines(
	original: &[u16],
	modified: &[u16],
	original_offsets: &[u32],
	modified_offsets: &[u32],
	hashes: &[u32],
	changes: &[u32],
	deadline: Option<f64>,
) -> Result<Option<Vec<u32>>, JsError> {
	let first = unpack_lines(original, original_offsets)?;
	let second = unpack_lines(modified, modified_offsets)?;
	let (original_hashes, modified_hashes) = hashes
		.split_at_checked(first.len())
		.ok_or(SequenceDiffError::InvalidRanges)?;
	let changes = decode_ranges(changes)?;
	let mut valid = true;
	let result = compute_moved_lines(
		&changes,
		&first,
		&second,
		original_hashes,
		modified_hashes,
		|| {
			valid = deadline.is_none_or(|deadline| js_sys::Date::now() < deadline) && valid;
			valid
		},
	);
	match result {
		Ok(diffs) => Ok(Some(encode_result(SequenceDiffResult {
			diffs,
			hit_timeout: !valid,
		}))),
		Err(
			SequenceDiffError::TooLarge
			| SequenceDiffError::AllocationFailed
			| SequenceDiffError::UnrepresentablePath
			| SequenceDiffError::InvalidRanges,
		) => Ok(None),
		Err(error) => Err(error.into()),
	}
}

fn decode_ranges(ranges: &[u32]) -> Result<Vec<SequenceDiff>, SequenceDiffError> {
	let (ranges, remainder) = ranges.as_chunks::<4>();
	if !remainder.is_empty() {
		return Err(SequenceDiffError::InvalidRanges);
	}
	Ok(ranges
		.iter()
		.map(|range| SequenceDiff {
			original: range[0] as usize..range[1] as usize,
			modified: range[2] as usize..range[3] as usize,
		})
		.collect())
}

/// Returns timeout, line counts, trimmed identities, and optimized half-open line ranges.
#[wasm_bindgen]
pub fn diff_lines(
	original: &[u16],
	modified: &[u16],
	original_offsets: &[u32],
	modified_offsets: &[u32],
	equality_scores: &[f64],
	timeout: Option<Function>,
	deadline: Option<f64>,
) -> Result<Option<Vec<u32>>, JsValue> {
	let first = unpack_lines(original, original_offsets).map_err(JsError::from)?;
	let second = unpack_lines(modified, modified_offsets).map_err(JsError::from)?;
	let mut callback_error = None;
	let result = refine_line_diff(&first, &second, equality_scores, || {
		check_timeout(&timeout, deadline, &mut callback_error)
	});
	if let Some(error) = callback_error {
		return Err(error);
	}
	match result {
		Ok(result) => {
			let mut values = Vec::with_capacity(
				3 + result.original_hashes.len()
					+ result.modified_hashes.len()
					+ result.result.diffs.len() * 4,
			);
			values.extend([
				u32::from(result.result.hit_timeout),
				result.original_hashes.len() as u32,
				result.modified_hashes.len() as u32,
			]);
			values.extend(result.original_hashes);
			values.extend(result.modified_hashes);
			values.extend(encode_result(result.result).into_iter().skip(1));
			Ok(Some(values))
		}
		Err(
			SequenceDiffError::TooLarge
			| SequenceDiffError::AllocationFailed
			| SequenceDiffError::UnrepresentablePath
			| SequenceDiffError::InvalidRanges,
		) => Ok(None),
		Err(error) => Err(JsError::from(error).into()),
	}
}

/// Builds owning UTF-16 slices once and returns translated display and raw character mappings.
/// Settings contain two document ranges, whitespace handling, and the subword/raw option bits.
#[wasm_bindgen]
pub fn refine_diff(
	original: &[u16],
	modified: &[u16],
	original_offsets: &[u32],
	modified_offsets: &[u32],
	settings: &[u32],
	timeout: Option<Function>,
	deadline: Option<f64>,
) -> Result<Option<Vec<u32>>, JsValue> {
	if settings.len() != 10 || settings[8] > 1 || settings[9] > 3 {
		return Err(JsError::from(SequenceDiffError::InvalidRanges).into());
	}
	let text_range = |values: &[u32]| TextRange {
		start: Position {
			line_number: values[0] as usize,
			column: values[1] as usize,
		},
		end: Position {
			line_number: values[2] as usize,
			column: values[3] as usize,
		},
	};
	let original_lines = unpack_lines(original, original_offsets).map_err(JsError::from)?;
	let modified_lines = unpack_lines(modified, modified_offsets).map_err(JsError::from)?;
	let compute = || {
		let first = CharacterSequence::new(
			&original_lines,
			text_range(&settings[..4]),
			settings[8] == 1,
		)?;
		let second = CharacterSequence::new(
			&modified_lines,
			text_range(&settings[4..8]),
			settings[8] == 1,
		)?;
		Ok::<_, SequenceDiffError>((first, second))
	};
	let (first, second) = match compute() {
		Ok(sequences) => sequences,
		Err(SequenceDiffError::TooLarge | SequenceDiffError::AllocationFailed) => return Ok(None),
		Err(error) => return Err(JsError::from(error).into()),
	};
	let mut callback_error = None;
	let result = refine_character_diff(
		&first,
		&second,
		CharacterDiffOptions {
			extend_to_subwords: settings[9] & 1 != 0,
			include_raw_changes: settings[9] & 2 != 0,
		},
		|| check_timeout(&timeout, deadline, &mut callback_error),
	);
	if let Some(error) = callback_error {
		return Err(error);
	}
	match result {
		Ok(result) => {
			let mut values =
				Vec::with_capacity(3 + 8 * (result.mappings.len() + result.raw_changes.len()));
			values.extend([
				u32::from(result.hit_timeout),
				result.mappings.len() as u32,
				result.raw_changes.len() as u32,
			]);
			append_text_mappings(
				&mut values,
				result.mappings.into_iter().chain(result.raw_changes),
			);
			Ok(Some(values))
		}
		Err(
			SequenceDiffError::TooLarge
			| SequenceDiffError::AllocationFailed
			| SequenceDiffError::UnrepresentablePath
			| SequenceDiffError::InvalidRanges,
		) => Ok(None),
		Err(error) => Err(JsError::from(error).into()),
	}
}

fn unpack_lines<'a>(
	units: &'a [u16],
	offsets: &[u32],
) -> Result<Vec<&'a [u16]>, SequenceDiffError> {
	if offsets.len() < 2 || offsets[0] != 0 || offsets[offsets.len() - 1] as usize != units.len() {
		return Err(SequenceDiffError::InvalidRanges);
	}
	offsets
		.windows(2)
		.map(|pair| {
			units
				.get(pair[0] as usize..pair[1] as usize)
				.ok_or(SequenceDiffError::InvalidRanges)
		})
		.collect()
}

/// Returns the timeout flag followed by original/modified half-open range tuples.
#[wasm_bindgen]
pub fn diff_dynamic(
	original: &[f64],
	modified: &[f64],
	original_exact: &[u32],
	modified_exact: &[u32],
	exact_scores: &[f64],
	timeout: Option<Function>,
	deadline: Option<f64>,
) -> Result<Vec<u32>, JsValue> {
	let weights =
		if original_exact.is_empty() && modified_exact.is_empty() && exact_scores.is_empty() {
			None
		} else {
			Some(LineEqualityScores {
				original: original_exact,
				modified: modified_exact,
				scores: exact_scores,
			})
		};
	let mut callback_error = None;
	let result = dynamic_programming_diff(original, modified, weights, || {
		check_timeout(&timeout, deadline, &mut callback_error)
	})
	.map_err(JsError::from)?;
	if let Some(error) = callback_error {
		return Err(error);
	}
	Ok(encode_result(result))
}

/// Returns no result when bounded native state is exhausted, allowing the existing fallback.
#[wasm_bindgen]
pub fn diff_myers(
	original: &[f64],
	modified: &[f64],
	timeout: Option<Function>,
	deadline: Option<f64>,
) -> Result<Option<Vec<u32>>, JsValue> {
	let mut callback_error = None;
	let result = myers_diff(original, modified, || {
		check_timeout(&timeout, deadline, &mut callback_error)
	});
	if let Some(error) = callback_error {
		return Err(error);
	}
	match result {
		Ok(result) => Ok(Some(encode_result(result))),
		Err(
			SequenceDiffError::TooLarge
			| SequenceDiffError::AllocationFailed
			| SequenceDiffError::UnrepresentablePath,
		) => Ok(None),
		Err(error) => Err(JsError::from(error).into()),
	}
}

fn check_timeout(
	timeout: &Option<Function>,
	deadline: Option<f64>,
	callback_error: &mut Option<JsValue>,
) -> bool {
	match timeout.as_ref().map(|check| check.call0(&JsValue::NULL)) {
		None => deadline.is_none_or(|deadline| js_sys::Date::now() < deadline),
		Some(Ok(value)) => value.as_bool().unwrap_or(false),
		Some(Err(error)) => {
			*callback_error = Some(error);
			false
		}
	}
}

fn encode_result(result: SequenceDiffResult) -> Vec<u32> {
	let mut ranges = Vec::with_capacity(1 + 4 * result.diffs.len());
	ranges.push(u32::from(result.hit_timeout));
	for diff in result.diffs {
		append_line_range(&mut ranges, &diff);
	}
	ranges
}

/// Applies join/shift heuristics using stable strong identities and boundary scores.
#[wasm_bindgen]
pub fn optimize_diff(
	original: &[f64],
	modified: &[f64],
	original_strong: &[u32],
	modified_strong: &[u32],
	original_scores: &[f64],
	modified_scores: &[f64],
	ranges: &[u32],
) -> Result<Option<Vec<u32>>, JsError> {
	let diffs = decode_ranges(ranges)?;
	let original = OptimizationSequence {
		elements: original,
		strong_elements: original_strong,
		boundary_scores: original_scores,
	};
	let modified = OptimizationSequence {
		elements: modified,
		strong_elements: modified_strong,
		boundary_scores: modified_scores,
	};
	match optimize_sequence_diffs(original, modified, &diffs) {
		Ok(diffs) => Ok(Some(encode_result(SequenceDiffResult {
			diffs,
			hit_timeout: false,
		}))),
		Err(SequenceDiffError::InvalidRanges | SequenceDiffError::InvalidScores) => Ok(None),
		Err(error) => Err(error.into()),
	}
}
