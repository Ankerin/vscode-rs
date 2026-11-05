/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use js_sys::Function;
use vscode_editor_core::{
	LineEqualityScores, SequenceDiffError, SequenceDiffResult, dynamic_programming_diff, myers_diff,
};
use wasm_bindgen::prelude::*;

/// Versions sequence alignment independently of the text storage contract.
#[wasm_bindgen]
pub fn sequence_diff_abi_version() -> u32 {
	3
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
		ranges.extend([
			diff.original.start as u32,
			diff.original.end as u32,
			diff.modified.start as u32,
			diff.modified.end as u32,
		]);
	}
	ranges
}
