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

#[wasm_bindgen]
extern "C" {
	pub type RequestHost;
	#[wasm_bindgen(method, catch, js_name = searchString)]
	fn search_string(this: &RequestHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = isRegex)]
	fn is_regex(this: &RequestHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = multilineRegex)]
	fn multiline_regex(this: &RequestHost, source: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = newlineIndex)]
	fn newline_index(this: &RequestHost, source: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = nonnegative)]
	fn nonnegative(this: &RequestHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = createRegex)]
	fn create_regex(this: &RequestHost, multiline: bool) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = lowercase)]
	fn lowercase(this: &RequestHost, source: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = uppercase)]
	fn uppercase(this: &RequestHost, source: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = matchCase)]
	fn match_case(this: &RequestHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = wordSeparators)]
	fn word_separators(this: &RequestHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = wordMap)]
	fn word_map(this: &RequestHost, words: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = makeData)]
	fn make_data(
		this: &RequestHost,
		regex: &JsValue,
		words: &JsValue,
		simple: &JsValue,
	) -> Result<JsValue, JsValue>;
}

struct Request(RequestHost);
impl vscode_editor_core::SearchRequestHost for Request {
	type Value = JsValue;
	type Error = JsValue;
	fn null(&self) -> JsValue {
		JsValue::NULL
	}
	fn boolean(&self, value: bool) -> JsValue {
		JsValue::from_bool(value)
	}
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn empty(&self, value: &JsValue) -> bool {
		value == &JsValue::from_str("")
	}
	fn different(&self, first: &JsValue, second: &JsValue) -> bool {
		first != second
	}
	fn nonnegative(&self, value: &JsValue) -> Result<bool, JsValue> {
		if let Some(value) = value.as_f64() {
			return Ok(value >= 0.0);
		}
		self.0.nonnegative(value)
	}
	fn search_string(&self) -> Result<JsValue, JsValue> {
		self.0.search_string()
	}
	fn is_regex(&self) -> Result<JsValue, JsValue> {
		self.0.is_regex()
	}
	fn multiline_regex(&self, source: &JsValue) -> Result<bool, JsValue> {
		self.0.multiline_regex(source)
	}
	fn newline_index(&self, source: &JsValue) -> Result<JsValue, JsValue> {
		self.0.newline_index(source)
	}
	fn create_regex(&self, multiline: bool) -> Result<JsValue, JsValue> {
		self.0.create_regex(multiline)
	}
	fn lowercase(&self, source: &JsValue) -> Result<JsValue, JsValue> {
		self.0.lowercase(source)
	}
	fn uppercase(&self, source: &JsValue) -> Result<JsValue, JsValue> {
		self.0.uppercase(source)
	}
	fn match_case(&self) -> Result<JsValue, JsValue> {
		self.0.match_case()
	}
	fn word_separators(&self) -> Result<JsValue, JsValue> {
		self.0.word_separators()
	}
	fn word_map(&self, words: &JsValue) -> Result<JsValue, JsValue> {
		self.0.word_map(words)
	}
	fn make_data(
		&self,
		regex: &JsValue,
		words: &JsValue,
		simple: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0.make_data(regex, words, simple)
	}
}

/// Parses the original request and catches only compatibility regex-construction failures.
#[wasm_bindgen]
pub fn parse_text_search_request(host: RequestHost) -> Result<JsValue, JsValue> {
	vscode_editor_core::parse_text_search_request(&Request(host))
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
