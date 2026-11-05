/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Block edits retain the original array splices, slice boundaries, and token-buffer aliases.

use crate::contiguous_tokens_store::{
	MAX_LINES, MAX_WORDS, WasmContiguousTokensStore, integer, supported, view,
};
use js_sys::{Array, ArrayBuffer};
use wasm_bindgen::prelude::*;

/// Adjusts a contiguous block in one native scope without introducing a persistent native handle.
#[wasm_bindgen]
pub fn edit_contiguous_tokens_block(
	block_start: f64,
	mut lines: Array,
	empty: ArrayBuffer,
	parameters: &[f64],
) -> Result<Option<Array>, JsError> {
	let &[
		start_line,
		start_column,
		end_line,
		end_column,
		eol_count,
		first_length,
	] = parameters
	else {
		return Err(JsError::new(
			"The contiguous token block edit does not match the editor contract",
		));
	};
	if !integer(block_start)
		|| parameters.iter().any(|&value| !integer(value))
		|| start_line < 1.0
		|| start_column < 1.0
		|| end_line < start_line
		|| end_column < 1.0
		|| (start_line == end_line && end_column < start_column)
		|| eol_count < 0.0
		|| first_length < 0.0
		|| f64::from(lines.length()) + eol_count > MAX_LINES as f64
	{
		return Ok(None);
	}
	let mut block_start = block_start as i64;
	let first = start_line as i64 - block_start;
	let last = end_line as i64 - block_start;
	let start = start_column as i64 - 1;
	let end = end_column as i64 - 1;
	let eols = eol_count as u32;
	let first_length = first_length as i64;
	let sentinel: JsValue = empty.clone().into();
	let length = i64::from(lines.length());
	for index in [first, last] {
		if index >= 0 && index < length && !supported(&lines.get(index as u32), &sentinel) {
			return Ok(None);
		}
	}
	if first >= 0 && first < length && (first != last || eols != 0) {
		let value = lines.get(first as u32);
		if !value.is_null() && value != sentinel {
			let tokens = view(&value);
			if i64::from(tokens.get_index(tokens.length() - 2)) < start {
				return Ok(None);
			}
		}
	}
	if first < 0 && last >= 0 && last < length && eols != 0 {
		let value = lines.get(last as u32);
		if !value.is_null() && value != sentinel {
			let tokens = view(&value);
			if i64::from(tokens.get_index(tokens.length() - 2)) - end < start {
				return Ok(None);
			}
		}
	}
	if first >= 0 && first < length && last >= 0 && last < length && first != last {
		let first = lines.get(first as u32);
		let last = lines.get(last as u32);
		if !first.is_null()
			&& !last.is_null()
			&& first != sentinel
			&& last != sentinel
			&& view(&first).length() + view(&last).length() > MAX_WORDS
		{
			return Ok(None);
		}
	}
	// Reuse the syntax owner's alias-preserving kernels; this local value owns no line index.
	let editing = WasmContiguousTokensStore::new(empty);
	if first == last && first >= 0 && first < length && eols == 0 {
		lines.set(
			first as u32,
			editing.edit_line(&lines.get(first as u32), start, end, first_length)?,
		);
		return Ok(Some(result(block_start, lines)));
	}
	if start_line != end_line || start_column != end_column {
		if last < 0 {
			block_start -= last - first;
		} else if first < length {
			if first < 0 && last >= length {
				block_start = 0;
				lines = Array::new();
			} else if first == last {
				let first = first as u32;
				lines.set(first, editing.delete(&lines.get(first), start, end)?);
			} else if first >= 0 {
				let first = first as u32;
				lines.set(first, editing.delete_ending(&lines.get(first), start)?);
				if last < length {
					let last_tokens = editing.delete(&lines.get(last as u32), 0, end)?;
					lines.set(first, editing.append(&lines.get(first), &last_tokens)?);
					lines.splice_many(first + 1, last as u32 - first, &[]);
				} else {
					lines.set(first, editing.append(&lines.get(first), &JsValue::NULL)?);
					lines = lines.slice(0, first + 1);
				}
			} else {
				block_start += first;
				let last = last as u32;
				lines.set(last, editing.delete(&lines.get(last), 0, end)?);
				lines = lines.slice(last, lines.length());
			}
		}
	}
	if eols != 0 || first_length != 0 {
		let index = start_line as i64 - block_start;
		if index < 0 {
			block_start += i64::from(eols);
		} else if index < i64::from(lines.length()) {
			let index = index as u32;
			if eols == 0 {
				lines.set(
					index,
					editing.insert(&lines.get(index), start, first_length)?,
				);
			} else {
				lines.set(index, editing.delete_ending(&lines.get(index), start)?);
				lines.set(
					index,
					editing.insert(&lines.get(index), start, first_length)?,
				);
				// The original block inserts at the absolute line number; retain that observable rule.
				let insertion = (start_line as u64).min(u64::from(lines.length())) as u32;
				let inserted = Array::new_with_length(eols);
				inserted.fill(&JsValue::NULL, 0, eols);
				lines = crate::arrays::insert(&lines, insertion, &inserted);
			}
		}
	}
	Ok(Some(result(block_start, lines)))
}

fn result(start: i64, lines: Array) -> Array {
	let result = Array::new();
	result.push(&JsValue::from(start as f64));
	result.push(&lines);
	result
}
