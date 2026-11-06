/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Public model search uses caught original array, range, and search-provider capabilities.

use vscode_editor_core::ModelSearchHost;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type SearchHost;
	#[wasm_bindgen(method, catch, js_name = assertAlive)]
	fn assert_alive(this: &SearchHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = singleton)]
	fn singleton(this: &SearchHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = everyRange)]
	fn every_range(this: &SearchHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = validateRanges)]
	fn validate_ranges(this: &SearchHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = fullRange)]
	fn full_range(this: &SearchHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = sort)]
	fn sort(this: &SearchHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = unique)]
	fn unique(this: &SearchHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = isRegex)]
	fn is_regex(this: &SearchHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = noNewline)]
	fn no_newline(this: &SearchHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = parse)]
	fn parse(this: &SearchHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = empty)]
	fn empty(this: &SearchHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = mapMatches)]
	fn map_matches(
		this: &SearchHost,
		ranges: &JsValue,
		data: &JsValue,
		literal: bool,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = flatten)]
	fn flatten(this: &SearchHost, matches: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = validateStart)]
	fn validate_start(this: &SearchHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = coordinate)]
	fn coordinate(this: &SearchHost, value: &JsValue, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = subtract)]
	fn subtract(this: &SearchHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = intersects)]
	fn intersects(this: &SearchHost, first: &JsValue, second: &JsValue)
	-> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = plus)]
	fn plus(this: &SearchHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = push)]
	fn push(this: &SearchHost, array: &JsValue, value: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = lineCount)]
	fn line_count(this: &SearchHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = maxColumn)]
	fn max_column(this: &SearchHost, line: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = maxStartColumn)]
	fn max_start_column(this: &SearchHost, start: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = lineMatches)]
	fn line_matches(this: &SearchHost, range: &JsValue, data: &JsValue)
	-> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = navigate)]
	fn navigate(this: &SearchHost, start: &JsValue, previous: bool) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = hasMatches)]
	fn has_matches(this: &SearchHost, matches: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = firstMatch)]
	fn first_match(this: &SearchHost, matches: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = range)]
	fn range(
		this: &SearchHost,
		start_line: &JsValue,
		start_column: &JsValue,
		end_line: &JsValue,
		end_column: &JsValue,
	) -> Result<JsValue, JsValue>;
}

struct Host(SearchHost);
impl ModelSearchHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn null(&self) -> JsValue {
		JsValue::NULL
	}
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn is_null(&self, value: &JsValue) -> bool {
		value.is_null()
	}
	fn is_boolean(&self, value: &JsValue) -> bool {
		value.as_bool().is_some()
	}
	fn is_array(&self, value: &JsValue) -> bool {
		js_sys::Array::is_array(value)
	}
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn numeric(&self, value: &JsValue) -> Option<f64> {
		value.as_f64()
	}
	fn assert_alive(&self) -> Result<(), JsValue> {
		self.0.assert_alive()
	}
	fn singleton(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.singleton(value)
	}
	fn every_range(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.every_range(value)
	}
	fn validate_ranges(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.validate_ranges(value)
	}
	fn full_range(&self) -> Result<JsValue, JsValue> {
		self.0.full_range()
	}
	fn sort(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.sort(value)
	}
	fn unique(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.unique(value)
	}
	fn is_regex(&self) -> Result<JsValue, JsValue> {
		self.0.is_regex()
	}
	fn no_newline(&self) -> Result<bool, JsValue> {
		self.0.no_newline()
	}
	fn parse(&self) -> Result<JsValue, JsValue> {
		self.0.parse()
	}
	fn empty(&self) -> Result<JsValue, JsValue> {
		self.0.empty()
	}
	fn map_matches(
		&self,
		ranges: &JsValue,
		data: &JsValue,
		literal: bool,
	) -> Result<JsValue, JsValue> {
		self.0.map_matches(ranges, data, literal)
	}
	fn flatten(&self, matches: &JsValue) -> Result<JsValue, JsValue> {
		self.0.flatten(matches)
	}
	fn validate_start(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.validate_start(value)
	}
	fn coordinate(&self, value: &JsValue, index: u32) -> Result<JsValue, JsValue> {
		self.0.coordinate(value, index)
	}
	fn subtract(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		self.0.subtract(first, second)
	}
	fn intersects(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		self.0.intersects(first, second)
	}
	fn plus(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		self.0.plus(first, second)
	}
	fn push(&self, array: &JsValue, value: &JsValue) -> Result<(), JsValue> {
		self.0.push(array, value)
	}
	fn line_count(&self) -> Result<JsValue, JsValue> {
		self.0.line_count()
	}
	fn max_column(&self, line: &JsValue) -> Result<JsValue, JsValue> {
		self.0.max_column(line)
	}
	fn max_start_column(&self, start: &JsValue) -> Result<JsValue, JsValue> {
		self.0.max_start_column(start)
	}
	fn line_matches(&self, range: &JsValue, data: &JsValue) -> Result<JsValue, JsValue> {
		self.0.line_matches(range, data)
	}
	fn navigate(&self, start: &JsValue, previous: bool) -> Result<JsValue, JsValue> {
		self.0.navigate(start, previous)
	}
	fn has_matches(&self, matches: &JsValue) -> Result<bool, JsValue> {
		self.0.has_matches(matches)
	}
	fn first_match(&self, matches: &JsValue) -> Result<JsValue, JsValue> {
		self.0.first_match(matches)
	}
	fn range(&self, values: &[JsValue; 4]) -> Result<JsValue, JsValue> {
		self.0.range(&values[0], &values[1], &values[2], &values[3])
	}
}

/// Identifies public model scope handling independently of TextModelSearch kernels.
#[wasm_bindgen]
pub fn model_search_abi_version() -> u32 {
	1
}

/// Runs scope collection or navigation with original result identities and caught failures.
#[wasm_bindgen]
pub fn run_model_search(
	host: SearchHost,
	operation: u32,
	input: JsValue,
) -> Result<JsValue, JsValue> {
	let host = Host(host);
	match operation {
		0 => vscode_editor_core::find_model_matches(&host, input),
		1 => vscode_editor_core::navigate_model_match(&host, &input, false),
		2 => vscode_editor_core::navigate_model_match(&host, &input, true),
		_ => Err(JsValue::from_str("Unsupported model search operation")),
	}
}

/// Serves the existing stable ECMAScript array sort callback without retaining its inputs.
#[wasm_bindgen]
pub fn compare_model_search_ranges(
	host: SearchHost,
	first: JsValue,
	second: JsValue,
) -> Result<JsValue, JsValue> {
	vscode_editor_core::compare_model_search_ranges(&Host(host), &first, &second)
}

/// Serves the existing reduce callback, preserving original unique-array and range identities.
#[wasm_bindgen]
pub fn merge_model_search_ranges(
	host: SearchHost,
	unique: JsValue,
	previous: JsValue,
	current: JsValue,
) -> Result<JsValue, JsValue> {
	vscode_editor_core::merge_model_search_ranges(&Host(host), &unique, &previous, current)
}
