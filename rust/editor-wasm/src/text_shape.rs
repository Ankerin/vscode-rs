/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! String shape queries retain UTF-16 line coordinates and borrow leading indentation.

use js_sys::{Array, JsString};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	type Text;
	#[wasm_bindgen(method, catch, js_name = charCodeAt)]
	fn character(this: &Text, offset: u32) -> Result<f64, JsValue>;
}

/// Versions line-ending and leading-whitespace queries independently of model storage.
#[wasm_bindgen]
pub fn text_shape_abi_version() -> u32 {
	1
}

/// Counts all original line breaks and line lengths from lossless UTF-16 units.
#[wasm_bindgen]
pub fn text_eol_count(units: &[u16]) -> Option<Vec<u32>> {
	if units.len() > 4 * 1024 * 1024 {
		return None;
	}
	Some(
		vscode_editor_core::count_eol(units)
			.map(|value| value as u32)
			.to_vec(),
	)
}

/// Returns only normalized ASCII whitespace and the original suffix's UTF-16 start.
#[wasm_bindgen]
pub fn text_normalize_indentation(
	text: JsString,
	indent_size: f64,
	insert_spaces: bool,
) -> Result<Option<Array>, JsValue> {
	if text.length() > 4 * 1024 * 1024 {
		return Ok(None);
	}
	let result = vscode_editor_core::normalize_indentation(
		text.length() as usize,
		indent_size,
		insert_spaces,
		|index| {
			text.unchecked_ref::<Text>()
				.character(index as u32)
				.map(|value| value as u16)
		},
	)?;
	Ok(result.map(|result| {
		Array::of2(
			&JsValue::from(result.prefix_length as u32),
			&JsValue::from_str(&result.whitespace),
		)
	}))
}
