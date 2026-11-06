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

// Caught line capabilities retain live source/result observations across collection.
#[wasm_bindgen]
extern "C" {
	pub type LineHost;
	#[wasm_bindgen(method, catch, js_name = add)]
	fn line_add(this: &LineHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = negate)]
	fn negate(this: &LineHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = increment)]
	fn increment(this: &LineHost, value: &JsValue) -> Result<js_sys::Array, JsValue>;
	#[wasm_bindgen(method, catch, js_name = equal)]
	fn line_equal(this: &LineHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = atLeast)]
	fn at_least(this: &LineHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = wordSeparators)]
	fn word_separators(this: &LineHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, js_name = captureMatches)]
	fn capture_matches(this: &LineHost) -> bool;
	#[wasm_bindgen(method, catch, js_name = simpleSearch)]
	fn simple_search(this: &LineHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = searchLength)]
	fn search_length(this: &LineHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = textLength)]
	fn line_text_length(this: &LineHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = indexOf)]
	fn index_of(this: &LineHost, search: &JsValue, index: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = validMatch)]
	fn line_valid_match(
		this: &LineHost,
		words: &JsValue,
		text_length: &JsValue,
		start: &JsValue,
		length: &JsValue,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = writeLiteral)]
	fn write_literal(
		this: &LineHost,
		index: &JsValue,
		start: &JsValue,
		end: &JsValue,
	) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = createSearcher)]
	fn create_searcher(this: &LineHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = reset)]
	fn line_reset(this: &LineHost, searcher: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = next)]
	fn line_next(this: &LineHost, searcher: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = matchStart)]
	fn line_match_start(this: &LineHost, matched: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = matchLength)]
	fn line_match_length(this: &LineHost, matched: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = writeRegex)]
	fn write_regex(
		this: &LineHost,
		index: &JsValue,
		start: &JsValue,
		end: &JsValue,
		matched: &JsValue,
	) -> Result<(), JsValue>;
}

struct CollectionHost(LineHost);

impl vscode_editor_core::LineMatchHost for CollectionHost {
	type Value = JsValue;
	type Error = JsValue;
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn add(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(JsValue::from_f64(first + second));
		}
		self.0.line_add(first, second)
	}
	fn negate(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		if let Some(value) = value.as_f64() {
			return Ok(JsValue::from_f64(-value));
		}
		self.0.negate(value)
	}
	fn increment(&self, value: &JsValue) -> Result<(JsValue, JsValue), JsValue> {
		if let Some(value) = value.as_f64() {
			return Ok((JsValue::from_f64(value), JsValue::from_f64(value + 1.0)));
		}
		let pair = self.0.increment(value)?;
		Ok((pair.get(0), pair.get(1)))
	}
	fn equal(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(first == second);
		}
		self.0.line_equal(first, second)
	}
	fn at_least(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(first >= second);
		}
		self.0.at_least(first, second)
	}
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn word_separators(&self) -> Result<JsValue, JsValue> {
		self.0.word_separators()
	}
	fn capture_matches(&self) -> bool {
		self.0.capture_matches()
	}
	fn simple_search(&self) -> Result<JsValue, JsValue> {
		self.0.simple_search()
	}
	fn search_length(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.search_length(value)
	}
	fn text_length(&self) -> Result<JsValue, JsValue> {
		self.0.line_text_length()
	}
	fn index_of(&self, search: &JsValue, index: &JsValue) -> Result<JsValue, JsValue> {
		self.0.index_of(search, index)
	}
	fn valid_match(
		&self,
		words: &JsValue,
		text_length: &JsValue,
		start: &JsValue,
		length: &JsValue,
	) -> Result<bool, JsValue> {
		self.0.line_valid_match(words, text_length, start, length)
	}
	fn write_literal(
		&self,
		index: &JsValue,
		start: &JsValue,
		end: &JsValue,
	) -> Result<(), JsValue> {
		self.0.write_literal(index, start, end)
	}
	fn create_searcher(&self) -> Result<JsValue, JsValue> {
		self.0.create_searcher()
	}
	fn reset(&self, searcher: &JsValue) -> Result<(), JsValue> {
		self.0.line_reset(searcher)
	}
	fn next(&self, searcher: &JsValue) -> Result<JsValue, JsValue> {
		self.0.line_next(searcher)
	}
	fn match_start(&self, matched: &JsValue) -> Result<JsValue, JsValue> {
		self.0.line_match_start(matched)
	}
	fn match_length(&self, matched: &JsValue) -> Result<JsValue, JsValue> {
		self.0.line_match_length(matched)
	}
	fn write_regex(
		&self,
		index: &JsValue,
		start: &JsValue,
		end: &JsValue,
		matched: &JsValue,
	) -> Result<(), JsValue> {
		self.0.write_regex(index, start, end, matched)
	}
}

/// Collects literal or regex matches through the existing aliased result array and factories.
#[wasm_bindgen]
pub fn collect_text_search_matches(
	host: LineHost,
	count: JsValue,
	delta: JsValue,
	limit: JsValue,
) -> Result<JsValue, JsValue> {
	vscode_editor_core::collect_line_matches(&CollectionHost(host), count, &delta, &limit)
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
	6
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
