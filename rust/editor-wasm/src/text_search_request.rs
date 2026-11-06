/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Search-source scanning and capture copying borrow original strings and array-like values.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type SourceHost;
	#[wasm_bindgen(method, js_name = sourceTruthy)]
	fn source_truthy(this: &SourceHost) -> bool;
	#[wasm_bindgen(method, catch, js_name = length)]
	fn source_length(this: &SourceHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = below)]
	fn source_below(this: &SourceHost, index: f64, length: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = atEnd)]
	fn at_end(this: &SourceHost, index: f64, length: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = charCode)]
	fn char_code(this: &SourceHost, index: f64) -> Result<JsValue, JsValue>;

	pub type MatchHost;
	#[wasm_bindgen(method, js_name = captures)]
	fn captures(this: &MatchHost) -> bool;
	#[wasm_bindgen(method, catch, js_name = createValues)]
	fn create_values(this: &MatchHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = length)]
	fn match_length(this: &MatchHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = below)]
	fn match_below(this: &MatchHost, index: f64, length: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = read)]
	fn read(this: &MatchHost, index: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = write)]
	fn write(
		this: &MatchHost,
		values: &JsValue,
		index: f64,
		value: &JsValue,
	) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = make)]
	fn make(this: &MatchHost, values: &JsValue) -> Result<JsValue, JsValue>;
}

struct Source(SourceHost);
impl vscode_editor_core::RegexSourceHost for Source {
	type Value = JsValue;
	type Error = JsValue;
	fn source_truthy(&self) -> bool {
		self.0.source_truthy()
	}
	fn length(&self) -> Result<JsValue, JsValue> {
		self.0.source_length()
	}
	fn is_code(&self, value: &JsValue, code: f64) -> bool {
		value.as_f64() == Some(code)
	}
	fn below(&self, index: f64, length: &JsValue) -> Result<bool, JsValue> {
		if let Some(length) = length.as_f64() {
			return Ok(index < length);
		}
		self.0.source_below(index, length)
	}
	fn at_end(&self, index: f64, length: &JsValue) -> Result<bool, JsValue> {
		if let Some(length) = length.as_f64() {
			return Ok(index >= length);
		}
		self.0.at_end(index, length)
	}
	fn char_code(&self, index: f64) -> Result<JsValue, JsValue> {
		self.0.char_code(index)
	}
}

struct Match(MatchHost);
impl vscode_editor_core::FindMatchHost for Match {
	type Value = JsValue;
	type Error = JsValue;
	fn captures(&self) -> bool {
		self.0.captures()
	}
	fn create_values(&self) -> Result<JsValue, JsValue> {
		self.0.create_values()
	}
	fn length(&self) -> Result<JsValue, JsValue> {
		self.0.match_length()
	}
	fn below(&self, index: f64, length: &JsValue) -> Result<bool, JsValue> {
		if let Some(length) = length.as_f64() {
			return Ok(index < length);
		}
		self.0.match_below(index, length)
	}
	fn read(&self, index: f64) -> Result<JsValue, JsValue> {
		self.0.read(index)
	}
	fn write(&self, values: &JsValue, index: f64, value: &JsValue) -> Result<(), JsValue> {
		self.0.write(values, index, value)
	}
	fn make(&self, values: Option<&JsValue>) -> Result<JsValue, JsValue> {
		self.0.make(values.unwrap_or(&JsValue::NULL))
	}
}

/// Classifies the original multiline search syntax without copying source text.
#[wasm_bindgen]
pub fn is_text_search_multiline_source(host: SourceHost) -> Result<bool, JsValue> {
	vscode_editor_core::is_multiline_search_source(&Source(host))
}

/// Returns the original FindMatch factory result and retains raw capture-slot identities.
#[wasm_bindgen]
pub fn create_text_search_match(host: MatchHost) -> Result<JsValue, JsValue> {
	vscode_editor_core::create_search_find_match(&Match(host))
}
