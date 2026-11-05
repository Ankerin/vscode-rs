/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Line token queries borrow existing views; ordered insertions retain complete UTF-16 units.

use crate::contiguous_tokens_store::{MAX_WORDS, integer};
use js_sys::{Array, Uint16Array, Uint32Array};
use vscode_editor_core::{LineTokenInsertion, find_line_token_index, line_token_slice};
use wasm_bindgen::prelude::*;

/// Searches directly over the existing array instead of copying the entire line for each lookup.
#[wasm_bindgen]
pub fn line_token_index(tokens: Uint32Array, desired: f64) -> Option<u32> {
	if desired.is_nan() || !tokens.length().is_multiple_of(2) || tokens.length() > MAX_WORDS {
		return None;
	}
	Some(
		find_line_token_index(tokens.length() as usize / 2, desired, |index| {
			tokens.get_index(index as u32 * 2)
		}) as u32,
	)
}

/// Returns the same cached slice selection while retaining external source mutation.
#[wasm_bindgen]
pub fn line_token_slice_info(tokens: Uint32Array, start: f64, end: f64) -> Option<Vec<f64>> {
	if !integer(start)
		|| !integer(end)
		|| !tokens.length().is_multiple_of(2)
		|| tokens.length() > MAX_WORDS
	{
		return None;
	}
	let (first, count) = line_token_slice(tokens.length() as usize / 2, start, end, |index| {
		tokens.get_index(index as u32 * 2)
	});
	Some(vec![first as f64, count as f64])
}

/// Copies conversion back into the original input view, including metadata aliases.
#[wasm_bindgen]
pub fn convert_line_token_offsets(tokens: &mut [u32], length: f64) -> Result<bool, JsError> {
	if !integer(length) || tokens.len() > MAX_WORDS as usize || !tokens.len().is_multiple_of(2) {
		return Ok(false);
	}
	vscode_editor_core::convert_line_token_offsets(tokens, length as i64)?;
	Ok(true)
}

/// Retains the original equality result for a supported non-wrapping word slice.
#[wasm_bindgen]
pub fn line_tokens_equal(first: &[u32], second: &[u32], from: f64, count: f64) -> Option<bool> {
	if !integer(from)
		|| !integer(count)
		|| from < 0.0
		|| count < 0.0
		|| from > 0x3FFF_FFFF as f64
		|| count > 0x3FFF_FFFF as f64
		|| first.len() > MAX_WORDS as usize
		|| second.len() > MAX_WORDS as usize
	{
		return None;
	}
	Some(vscode_editor_core::line_tokens_equal(
		first,
		second,
		from as usize * 2,
		count as usize * 2,
	))
}

/// Returns intersecting lengths and original metadata for the existing TokenInfo adapter.
#[wasm_bindgen]
pub fn line_tokens_in_range(
	tokens: &[u32],
	start: f64,
	end: f64,
) -> Result<Option<Vec<f64>>, JsError> {
	if !integer(start) || !integer(end) || start > end || !tokens.len().is_multiple_of(2) {
		return Ok(None);
	}
	Ok(vscode_editor_core::line_tokens_in_range(
		tokens,
		start as i64,
		end as i64,
	)?)
}

/// Composes one line and its ordered insertions into independent text/token buffers.
#[wasm_bindgen]
pub fn insert_line_tokens(
	tokens: &[u32],
	text: &[u16],
	inserted_text: &[u16],
	parameters: &[f64],
) -> Result<Option<Array>, JsError> {
	if tokens.len() > MAX_WORDS as usize
		|| text.len() > MAX_WORDS as usize
		|| inserted_text.len() > MAX_WORDS as usize
	{
		return Ok(None);
	}
	let (parameters, tail) = parameters.as_chunks::<4>();
	if !tail.is_empty() {
		return Err(JsError::new(
			"The line token insertion packet does not match the editor contract",
		));
	}
	if parameters.len() > 262_144 {
		return Ok(None);
	}
	let mut insertions = Vec::new();
	if insertions.try_reserve_exact(parameters.len()).is_err() {
		return Ok(None);
	}
	for &[offset, start, length, metadata] in parameters {
		if ![offset, start, length, metadata]
			.iter()
			.all(|&value| integer(value))
			|| start < 0.0
			|| length < 0.0
			|| metadata < 0.0
			|| metadata > f64::from(u32::MAX)
			|| start + length > inserted_text.len() as f64
		{
			return Err(JsError::new(
				"The line token insertion packet does not match the editor contract",
			));
		}
		insertions.push(LineTokenInsertion {
			offset: offset as i64,
			text: &inserted_text[start as usize..(start + length) as usize],
			metadata: metadata as u32,
		});
	}
	let Some(result) = vscode_editor_core::insert_line_tokens(tokens, text, &insertions)? else {
		return Ok(None);
	};
	let output = Array::new();
	output.push(&Uint32Array::from(result.tokens.as_slice()));
	output.push(&Uint16Array::from(result.text.as_slice()));
	Ok(Some(output))
}
