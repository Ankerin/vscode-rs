/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Fast bracket token streams retain ECMAScript matches, original caches, and scoped length results.

use crate::bracket_trees::WasmBracketTreeResult;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type FastHost;
	#[wasm_bindgen(method, catch)]
	fn add(this: &FastHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch)]
	fn subtract(this: &FastHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = afterBreak)]
	fn after_break(this: &FastHost, index: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = equal)]
	fn equal(this: &FastHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = cache)]
	fn cache(this: &FastHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = populate)]
	fn populate(this: &FastHost, cache: &JsValue, line: f64, column: f64) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = hasRegexp)]
	fn has_regexp(this: &FastHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = resetRegexp)]
	fn reset_regexp(this: &FastHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = nextMatch)]
	fn next_match(this: &FastHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = matchIsNull)]
	fn match_is_null(this: &FastHost, matched: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = matchIndex)]
	fn match_index(this: &FastHost, matched: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = matchValue)]
	fn match_value(this: &FastHost, matched: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = lineBreak)]
	fn line_break(this: &FastHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = shortCache)]
	fn short_cache(this: &FastHost, cache: &JsValue, column: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = cachedToken)]
	fn cached_token(this: &FastHost, cache: &JsValue, column: &JsValue)
	-> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = textToken)]
	fn text_token(this: &FastHost, line: f64, column: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = pushToken)]
	fn push_token(this: &FastHost, token: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = pushBracket)]
	fn push_bracket(this: &FastHost, value: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = valueLength)]
	fn value_length(this: &FastHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = textLength)]
	fn text_length(this: &FastHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = length)]
	fn length(this: &FastHost, line: f64, column: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = pushText)]
	fn push_text(this: &FastHost, length: &JsValue) -> Result<(), JsValue>;
}

struct Host(FastHost);

impl vscode_editor_core::FastBracketTokenizerHost for Host {
	type Value = JsValue;
	type Error = JsValue;

	fn zero(&self) -> JsValue {
		JsValue::from_f64(0.0)
	}
	fn add(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			Ok(JsValue::from_f64(first + second))
		} else {
			self.0.add(first, second)
		}
	}
	fn subtract(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			Ok(JsValue::from_f64(first - second))
		} else {
			self.0.subtract(first, second)
		}
	}
	fn after_break(&self, index: &JsValue) -> Result<JsValue, JsValue> {
		if let Some(index) = index.as_f64() {
			Ok(JsValue::from_f64(index + 1.0))
		} else {
			self.0.after_break(index)
		}
	}
	fn equal(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		self.0.equal(first, second)
	}
	fn cache(&self) -> Result<JsValue, JsValue> {
		self.0.cache()
	}
	fn populate(&self, cache: &JsValue, line: f64, column: f64) -> Result<(), JsValue> {
		self.0.populate(cache, line, column)
	}
	fn has_regexp(&self) -> Result<bool, JsValue> {
		self.0.has_regexp()
	}
	fn reset_regexp(&self) -> Result<(), JsValue> {
		self.0.reset_regexp()
	}
	fn next_match(&self) -> Result<JsValue, JsValue> {
		self.0.next_match()
	}
	fn match_is_null(&self, matched: &JsValue) -> Result<bool, JsValue> {
		self.0.match_is_null(matched)
	}
	fn match_index(&self, matched: &JsValue) -> Result<JsValue, JsValue> {
		self.0.match_index(matched)
	}
	fn match_value(&self, matched: &JsValue) -> Result<JsValue, JsValue> {
		self.0.match_value(matched)
	}
	fn line_break(&self, value: &JsValue) -> Result<bool, JsValue> {
		self.0.line_break(value)
	}
	fn short_cache(&self, cache: &JsValue, column: &JsValue) -> Result<bool, JsValue> {
		self.0.short_cache(cache, column)
	}
	fn cached_token(&self, cache: &JsValue, column: &JsValue) -> Result<JsValue, JsValue> {
		self.0.cached_token(cache, column)
	}
	fn text_token(&self, line: f64, column: &JsValue) -> Result<JsValue, JsValue> {
		self.0.text_token(line, column)
	}
	fn push_token(&self, token: &JsValue) -> Result<(), JsValue> {
		self.0.push_token(token)
	}
	fn push_bracket(&self, value: &JsValue) -> Result<(), JsValue> {
		self.0.push_bracket(value)
	}
	fn value_length(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.value_length(value)
	}
	fn text_length(&self) -> Result<JsValue, JsValue> {
		self.0.text_length()
	}
	fn length(&self, line: f64, column: &JsValue) -> Result<JsValue, JsValue> {
		self.0.length(line, column)
	}
	fn push_text(&self, length: &JsValue) -> Result<(), JsValue> {
		self.0.push_text(length)
	}
}

/// Versions initial bracket stream construction independently of semantic line scanning.
#[wasm_bindgen]
pub fn fast_bracket_tokenizer_abi_version() -> u32 {
	1
}

/// Populates the existing token array and returns its original packed document length.
#[wasm_bindgen]
pub fn build_fast_bracket_tokens(host: FastHost) -> Result<WasmBracketTreeResult, JsValue> {
	Ok(WasmBracketTreeResult::new(
		vscode_editor_core::build_fast_bracket_tokens(&Host(host))?,
	))
}
