/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Shared Unicode iterator kernels borrow host strings without copying entire editor lines.

use js_sys::JsString;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	type Text;
	#[wasm_bindgen(method, catch, js_name = charCodeAt)]
	fn character(this: &Text, offset: u32) -> Result<f64, JsValue>;
}

/// Versions code-point and forward/backward grapheme stepping independently of cursor columns.
#[wasm_bindgen]
pub fn unicode_abi_version() -> u32 {
	2
}

fn supported(length: f64, offset: f64, previous: bool) -> bool {
	length >= 0.0
		&& length <= (4 * 1024 * 1024) as f64
		&& length.fract() == 0.0
		&& offset.fract() == 0.0
		&& if previous {
			offset > 0.0 && offset <= length
		} else {
			offset >= 0.0 && offset < length
		}
}

/// Reads one code point under the original cached-length and surrogate-pair rules.
#[wasm_bindgen]
pub fn unicode_code_point(
	text: JsString,
	length: f64,
	offset: f64,
	previous: bool,
) -> Result<Option<u32>, JsValue> {
	if text.length() > 4 * 1024 * 1024
		|| length > f64::from(text.length())
		|| !supported(length, offset, previous)
	{
		return Ok(None);
	}
	let (point, _) = vscode_editor_core::unicode_code_point(
		length as usize,
		offset as usize,
		previous,
		|index| {
			text.unchecked_ref::<Text>()
				.character(index as u32)
				.map(|value| value as u16)
		},
	)?;
	Ok(Some(point))
}

/// Computes a complete stateless grapheme step and returns only its resulting offset.
#[wasm_bindgen]
pub fn unicode_grapheme_offset(
	text: JsString,
	offset: f64,
	previous: bool,
) -> Result<Option<u32>, JsValue> {
	if !supported(f64::from(text.length()), offset, previous) {
		return Ok(None);
	}
	let after = vscode_editor_core::unicode_grapheme_offset(
		text.length() as usize,
		offset as usize,
		previous,
		|index| {
			text.unchecked_ref::<Text>()
				.character(index as u32)
				.map(|value| value as u16)
		},
	)?;
	Ok(Some(after as u32))
}

/// Returns a Backspace coordinate after scanning only the preceding code point or emoji component.
#[wasm_bindgen]
pub fn unicode_left_delete_offset(text: JsString, offset: f64) -> Result<Option<u32>, JsValue> {
	if !supported(f64::from(text.length()), offset, true) {
		return Ok(None);
	}
	let before = vscode_editor_core::unicode_left_delete_offset(
		text.length() as usize,
		offset as usize,
		|index| {
			text.unchecked_ref::<Text>()
				.character(index as u32)
				.map(|value| value as u16)
		},
	)?;
	Ok(Some(before as u32))
}
