/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use js_sys::Uint32Array;
use wasm_bindgen::prelude::*;

/// Identifies token metadata composition independently of storage and diff contracts.
#[wasm_bindgen]
pub fn tokens_abi_version() -> u32 {
	11
}

/// Selects a mutable source view without transferring every sparse record into native memory.
#[wasm_bindgen]
pub fn sparse_line_token_range(tokens: Uint32Array, count: f64, desired: f64) -> Option<Vec<f64>> {
	if !count.is_finite()
		|| count < 0.0
		|| count.fract() != 0.0
		|| count * 4.0 > f64::from(tokens.length())
		|| !tokens.length().is_multiple_of(4)
		|| tokens.length() > 4 * 1024 * 1024
		|| desired.is_nan()
	{
		return None;
	}
	let range = vscode_editor_core::find_sparse_line_tokens(count as usize, desired, |index| {
		let offset = index as u32 * 4;
		(offset < tokens.length()).then(|| tokens.get_index(offset))
	});
	Some(range.map_or_else(Vec::new, |(first, end)| {
		vec![(first * 4) as f64, (end * 4) as f64]
	}))
}

/// Copies edits back to the source view; -1 represents the editor's shared empty-line sentinel.
#[wasm_bindgen]
pub fn update_contiguous_tokens(
	tokens: &mut [u32],
	operation: u32,
	first: f64,
	second: f64,
) -> Result<Option<f64>, JsError> {
	if tokens.is_empty()
		|| tokens.len() > 4 * 1024 * 1024
		|| [first, second].iter().any(|value| {
			!value.is_finite()
				|| value.fract() != 0.0
				|| *value < 0.0
				|| *value > (1u64 << 40) as f64
		}) {
		return Ok(None);
	}
	let result = match operation {
		0 if second >= first => {
			vscode_editor_core::delete_contiguous_tokens(tokens, first as i64, second as i64)?
		}
		0 => return Ok(None),
		1 => vscode_editor_core::insert_contiguous_tokens(tokens, first as i64, second as i64)?,
		_ => {
			return Err(JsError::new(
				"The contiguous token operation does not match the editor contract",
			));
		}
	};
	Ok(Some(match result {
		vscode_editor_core::ContiguousTokensUpdate::EmptyLine => -1.0,
		vscode_editor_core::ContiguousTokensUpdate::Words(length) => length as f64,
	}))
}

/// Concatenates encoded token streams without changing either source view.
#[wasm_bindgen]
pub fn append_contiguous_tokens(
	first: &[u32],
	second: &[u32],
) -> Result<Option<Vec<u32>>, JsError> {
	Ok(vscode_editor_core::append_contiguous_tokens(first, second)?)
}

/// Updates aliased JavaScript records in place through the generated mutable-slice copyback.
#[wasm_bindgen]
pub fn update_sparse_tokens(
	tokens: &mut [u32],
	parameters: &[f64],
) -> Result<Option<Vec<f64>>, JsError> {
	if tokens.len() > 4 * 1024 * 1024
		|| parameters.iter().any(|value| {
			!value.is_finite() || value.fract() != 0.0 || value.abs() > (1u64 << 40) as f64
		}) {
		return Ok(None);
	}
	let result = match *parameters {
		[0.0, start_line, start_char, end_line, end_char] => {
			vscode_editor_core::remove_sparse_tokens(
				tokens,
				start_line as i64,
				start_char as i64,
				end_line as i64,
				end_char as i64,
			)?
		}
		[
			1.0,
			block_start,
			start_line,
			start_column,
			end_line,
			end_column,
			eol_count,
			first_line_length,
			last_line_length,
			first_char_code,
		] => {
			if start_line < 1.0
				|| end_line < start_line
				|| start_column < 1.0
				|| end_column < 1.0
				|| (start_line == end_line && end_column < start_column)
				|| eol_count < 0.0
				|| first_line_length < 0.0
				|| last_line_length < 0.0
			{
				return Ok(None);
			}
			vscode_editor_core::edit_sparse_tokens(
				tokens,
				&vscode_editor_core::SparseTokenEdit {
					block_start: block_start as i64,
					start_line: start_line as i64,
					start_column: start_column as i64,
					end_line: end_line as i64,
					end_column: end_column as i64,
					eol_count: eol_count as i64,
					first_line_length: first_line_length as i64,
					last_line_length: last_line_length as i64,
					first_char_code: first_char_code as i64,
				},
			)?
		}
		_ => {
			return Err(JsError::new(
				"The sparse token operation does not match the editor contract",
			));
		}
	};
	Ok(Some(vec![result.count as f64, result.start_line as f64]))
}

/// Returns independent split arrays in one bounded result packet.
#[wasm_bindgen]
pub fn split_sparse_tokens(
	tokens: &[u32],
	parameters: &[f64],
) -> Result<Option<Vec<u32>>, JsError> {
	let &[start_line, start_char, end_line, end_char] = parameters else {
		return Err(JsError::new(
			"The sparse token range does not match the editor contract",
		));
	};
	if parameters.iter().any(|value| {
		!value.is_finite() || value.fract() != 0.0 || value.abs() > (1u64 << 40) as f64
	}) {
		return Ok(None);
	}
	Ok(vscode_editor_core::split_sparse_tokens(
		tokens,
		start_line as i64,
		start_char as i64,
		end_line as i64,
		end_char as i64,
	)?)
}

#[wasm_bindgen]
pub fn merge_semantic_tokens(
	contiguous: &[u32],
	sparse: &[u32],
	text_length: u32,
) -> Result<Option<Vec<u32>>, JsError> {
	Ok(vscode_editor_core::merge_semantic_tokens(
		contiguous,
		sparse,
		text_length,
	)?)
}
