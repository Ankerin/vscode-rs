/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Borrowed UTF-16 search offsets retain live arrays, model providers, and range identities.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type ScanHost;
	#[wasm_bindgen(method, catch, js_name = textLength)]
	fn text_length(this: &ScanHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = below)]
	fn below(this: &ScanHost, index: f64, length: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = charCode)]
	fn char_code(this: &ScanHost, index: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = write)]
	fn write(this: &ScanHost, index: f64, offset: f64) -> Result<(), JsValue>;

	pub type QueryHost;
	#[wasm_bindgen(method, catch, js_name = length)]
	fn length(this: &QueryHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = subtractOne)]
	fn subtract_one(this: &QueryHost, value: &JsValue) -> Result<f64, JsValue>;
	#[wasm_bindgen(method, catch, js_name = offset)]
	fn offset(this: &QueryHost, index: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = atMost)]
	fn at_most(this: &QueryHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = atLeast)]
	fn at_least(this: &QueryHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;

	pub type RangeHost;
	#[wasm_bindgen(method, catch, js_name = add)]
	fn add(this: &RangeHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = subtract)]
	fn subtract(this: &RangeHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, js_name = hasCounter)]
	fn has_counter(this: &RangeHost) -> bool;
	#[wasm_bindgen(method, catch, js_name = countBefore)]
	fn count_before(this: &RangeHost, index: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = matchLength)]
	fn match_length(this: &RangeHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = position)]
	fn position(this: &RangeHost, offset: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = range)]
	fn range(this: &RangeHost, start: &JsValue, end: &JsValue) -> Result<JsValue, JsValue>;
}

struct Scan(ScanHost);
impl vscode_editor_core::LineFeedScanHost for Scan {
	type Value = JsValue;
	type Error = JsValue;
	fn text_length(&self) -> Result<JsValue, JsValue> {
		self.0.text_length()
	}
	fn below(&self, index: f64, length: &JsValue) -> Result<bool, JsValue> {
		if let Some(length) = length.as_f64() {
			return Ok(index < length);
		}
		self.0.below(index, length)
	}
	fn char_code(&self, index: f64) -> Result<JsValue, JsValue> {
		self.0.char_code(index)
	}
	fn is_line_feed(&self, value: &JsValue) -> bool {
		value.as_f64() == Some(10.0)
	}
	fn write(&self, index: f64, offset: f64) -> Result<(), JsValue> {
		self.0.write(index, offset)
	}
}

struct Query(QueryHost);
impl vscode_editor_core::LineFeedQueryHost for Query {
	type Value = JsValue;
	type Error = JsValue;
	fn last_index(&self) -> Result<f64, JsValue> {
		let length = self.0.length()?;
		if let Some(length) = length.as_f64() {
			return Ok(length - 1.0);
		}
		self.0.subtract_one(&length)
	}
	fn offset(&self, index: f64) -> Result<JsValue, JsValue> {
		self.0.offset(index)
	}
	fn at_most(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(first <= second);
		}
		self.0.at_most(first, second)
	}
	fn at_least(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(first >= second);
		}
		self.0.at_least(first, second)
	}
}

struct MatchRange(RangeHost);
impl vscode_editor_core::MultilineMatchHost for MatchRange {
	type Value = JsValue;
	type Error = JsValue;
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn add(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(JsValue::from_f64(first + second));
		}
		self.0.add(first, second)
	}
	fn subtract(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(JsValue::from_f64(first - second));
		}
		self.0.subtract(first, second)
	}
	fn has_counter(&self) -> bool {
		self.0.has_counter()
	}
	fn count_before(&self, index: &JsValue) -> Result<JsValue, JsValue> {
		self.0.count_before(index)
	}
	fn match_length(&self) -> Result<JsValue, JsValue> {
		self.0.match_length()
	}
	fn position(&self, offset: &JsValue) -> Result<JsValue, JsValue> {
		self.0.position(offset)
	}
	fn range(&self, start: &JsValue, end: &JsValue) -> Result<JsValue, JsValue> {
		self.0.range(start, end)
	}
}

/// Scans once into the original facade; caught failures preserve preceding writes.
#[wasm_bindgen]
pub fn scan_text_search_line_feeds(host: ScanHost) -> Result<(), JsValue> {
	vscode_editor_core::scan_search_line_feeds(&Scan(host))
}

/// Queries only required array elements with original relational coercions.
#[wasm_bindgen]
pub fn count_text_search_line_feeds(host: QueryHost, target: JsValue) -> Result<f64, JsValue> {
	vscode_editor_core::search_line_feeds_before(&Query(host), &target)
}

/// Resolves original model positions and returns the original Range factory result.
#[wasm_bindgen]
pub fn text_search_multiline_range(
	host: RangeHost,
	delta: JsValue,
	index: JsValue,
) -> Result<JsValue, JsValue> {
	vscode_editor_core::multiline_match_range(&MatchRange(host), &delta, &index)
}
