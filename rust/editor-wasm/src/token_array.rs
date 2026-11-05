/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Temporary token sequence transforms keep existing JavaScript text and provider objects.

use js_sys::{Array, JsString, Uint32Array};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	type TextToken;
	#[wasm_bindgen(method, getter, catch)]
	fn text(this: &TextToken) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, getter, catch)]
	fn metadata(this: &TextToken) -> Result<JsValue, JsValue>;
}

/// Returns original lengths or clamped substring endpoints with unchanged metadata words.
#[wasm_bindgen]
pub fn line_token_array(tokens: &[u32], text_length: f64, text: bool) -> Option<Vec<f64>> {
	if !text_length.is_finite()
		|| text_length < 0.0
		|| text_length > 4_194_304.0
		|| text_length.fract() != 0.0
	{
		return None;
	}
	vscode_editor_core::line_token_array(tokens, text_length as usize, text)
}

/// Computes floating-point sequence slices before constructing existing TokenInfo objects.
#[wasm_bindgen]
pub fn slice_token_array(lengths: &[f64], start: f64, end: f64) -> Option<Vec<f64>> {
	vscode_editor_core::slice_token_array(lengths, start, end)
}

/// Joins primitive host strings losslessly and constructs encoded boundaries in the independent core.
#[wasm_bindgen]
pub fn create_line_tokens(data: Array) -> Result<Option<Array>, JsValue> {
	if data.length() > 262_144 {
		return Ok(None);
	}
	let mut parameters = Vec::new();
	if parameters
		.try_reserve_exact(data.length() as usize)
		.is_err()
	{
		return Ok(None);
	}
	let texts = Array::new();
	for value in data.iter() {
		let token = value.unchecked_ref::<TextToken>();
		let text = token.text()?;
		let metadata = token.metadata()?;
		if !text.is_string() {
			return Ok(None);
		}
		let Some(metadata) = metadata.as_f64() else {
			return Ok(None);
		};
		parameters.push([
			f64::from(text.unchecked_ref::<JsString>().length()),
			metadata,
		]);
		texts.push(&text);
	}
	let Some(tokens) = vscode_editor_core::create_line_token_array(&parameters) else {
		return Ok(None);
	};
	let result = Array::new();
	result.push(&Uint32Array::from(tokens.as_slice()));
	result.push(&texts.join(""));
	Ok(Some(result))
}
