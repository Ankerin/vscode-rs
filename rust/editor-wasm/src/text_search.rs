/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Text-search control retains original regex results without decoding or copying source strings.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type SearchHost;
	#[wasm_bindgen(method, catch, js_name = textLength)]
	fn text_length(this: &SearchHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = previousStart)]
	fn previous_start(this: &SearchHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = previousLength)]
	fn previous_length(this: &SearchHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = add)]
	fn add(this: &SearchHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = equal)]
	fn equal(this: &SearchHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = exec)]
	fn exec(this: &SearchHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = matchStart)]
	fn match_start(this: &SearchHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = matchLength)]
	fn match_length(this: &SearchHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = nextCodePoint)]
	fn next_code_point(this: &SearchHost, length: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = aboveBmp)]
	fn above_bmp(this: &SearchHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = advance)]
	fn advance(this: &SearchHost, count: u32) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = setPreviousStart)]
	fn set_previous_start(this: &SearchHost, value: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = setPreviousLength)]
	fn set_previous_length(this: &SearchHost, value: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = hasWords)]
	fn has_words(this: &SearchHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = validMatch)]
	fn valid_match(
		this: &SearchHost,
		text_length: &JsValue,
		start: &JsValue,
		length: &JsValue,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = resetRegex)]
	fn reset_regex(this: &SearchHost) -> Result<(), JsValue>;
}

struct Host(SearchHost);

impl vscode_editor_core::TextSearchHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn null(&self) -> JsValue {
		JsValue::NULL
	}
	fn text_length(&self) -> Result<JsValue, JsValue> {
		self.0.text_length()
	}
	fn previous_start(&self) -> Result<JsValue, JsValue> {
		self.0.previous_start()
	}
	fn previous_length(&self) -> Result<JsValue, JsValue> {
		self.0.previous_length()
	}
	fn add(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(JsValue::from_f64(first + second));
		}
		self.0.add(first, second)
	}
	fn equal(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(first == second);
		}
		self.0.equal(first, second)
	}
	fn exec(&self) -> Result<JsValue, JsValue> {
		self.0.exec()
	}
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn match_start(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.match_start(value)
	}
	fn match_length(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.match_length(value)
	}
	fn next_code_point(&self, text_length: &JsValue) -> Result<JsValue, JsValue> {
		self.0.next_code_point(text_length)
	}
	fn above_bmp(&self, value: &JsValue) -> Result<bool, JsValue> {
		if let Some(value) = value.as_f64() {
			return Ok(value > 65535.0);
		}
		self.0.above_bmp(value)
	}
	fn advance(&self, count: u32) -> Result<(), JsValue> {
		self.0.advance(count)
	}
	fn set_previous_start(&self, value: &JsValue) -> Result<(), JsValue> {
		self.0.set_previous_start(value)
	}
	fn set_previous_length(&self, value: &JsValue) -> Result<(), JsValue> {
		self.0.set_previous_length(value)
	}
	fn has_words(&self) -> Result<bool, JsValue> {
		self.0.has_words()
	}
	fn valid_match(
		&self,
		text_length: &JsValue,
		start: &JsValue,
		length: &JsValue,
	) -> Result<bool, JsValue> {
		self.0.valid_match(text_length, start, length)
	}
	fn reset_regex(&self) -> Result<(), JsValue> {
		self.0.reset_regex()
	}
}

// Caught UTF-16/classifier capabilities preserve the original receiver and exception identity.
#[wasm_bindgen]
extern "C" {
	pub type WordHost;
	#[wasm_bindgen(method, catch, js_name = add)]
	fn word_add(this: &WordHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = subtract)]
	fn word_subtract(
		this: &WordHost,
		first: &JsValue,
		second: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = equal)]
	fn word_equal(this: &WordHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = positive)]
	fn word_positive(this: &WordHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = charCode)]
	fn char_code(this: &WordHost, index: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = classify)]
	fn classify(this: &WordHost, value: &JsValue) -> Result<JsValue, JsValue>;
}

struct BoundaryHost(WordHost);

impl vscode_editor_core::WordBoundaryHost for BoundaryHost {
	type Value = JsValue;
	type Error = JsValue;
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn add(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(JsValue::from_f64(first + second));
		}
		self.0.word_add(first, second)
	}
	fn subtract(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(JsValue::from_f64(first - second));
		}
		self.0.word_subtract(first, second)
	}
	fn equal(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(first == second);
		}
		self.0.word_equal(first, second)
	}
	fn positive(&self, value: &JsValue) -> Result<bool, JsValue> {
		if let Some(value) = value.as_f64() {
			return Ok(value > 0.0);
		}
		self.0.word_positive(value)
	}
	fn char_code(&self, index: &JsValue) -> Result<JsValue, JsValue> {
		self.0.char_code(index)
	}
	fn classify(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.classify(value)
	}
}

/// Validates word boundaries without copying text or changing classifier observation order.
#[wasm_bindgen]
pub fn is_valid_text_search_match(
	host: WordHost,
	text_length: JsValue,
	start: JsValue,
	length: JsValue,
) -> Result<bool, JsValue> {
	vscode_editor_core::is_valid_word_match(&BoundaryHost(host), &text_length, &start, &length)
}

/// Owns one search operation's result until the compatibility facade consumes it.
#[wasm_bindgen]
pub struct WasmTextSearchResult {
	value: Option<JsValue>,
}

#[wasm_bindgen]
impl WasmTextSearchResult {
	pub fn take(&mut self) -> JsValue {
		self.value.take().unwrap_or(JsValue::UNDEFINED)
	}
}

/// Versions the complete Searcher reset/next control separately from literal text storage search.
#[wasm_bindgen]
pub fn text_search_abi_version() -> u32 {
	2
}

/// Executes once; caught host failures preserve their identity and preceding state changes.
#[wasm_bindgen]
pub fn run_text_search(host: SearchHost, reset: bool) -> Result<WasmTextSearchResult, JsValue> {
	let host = Host(host);
	let value = if reset {
		vscode_editor_core::reset_text_search(&host)?;
		JsValue::UNDEFINED
	} else {
		vscode_editor_core::next_text_search_match(&host)?
	};
	Ok(WasmTextSearchResult { value: Some(value) })
}
