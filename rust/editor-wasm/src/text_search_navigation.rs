/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Scoped line navigation retains original model/searcher objects and overridable calls.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type NavigationHost;
	#[wasm_bindgen(method, catch, js_name = add)]
	fn add(this: &NavigationHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = subtract)]
	fn subtract(
		this: &NavigationHost,
		first: &JsValue,
		second: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = remainder)]
	fn remainder(
		this: &NavigationHost,
		first: &JsValue,
		second: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = atMost)]
	fn at_most(this: &NavigationHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = lineCount)]
	fn line_count(this: &NavigationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = startLine)]
	fn start_line(this: &NavigationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = line)]
	fn line(this: &NavigationHost, number: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = firstAtStart)]
	fn first_at_start(
		this: &NavigationHost,
		text: &JsValue,
		line: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = first)]
	fn first(this: &NavigationHost, text: &JsValue, line: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = prefixAtStart)]
	fn prefix_at_start(this: &NavigationHost, text: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = last)]
	fn last(this: &NavigationHost, text: &JsValue, line: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = resetFromColumn)]
	fn reset_from_column(this: &NavigationHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = resetStart)]
	fn reset_start(this: &NavigationHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = next)]
	fn next(this: &NavigationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = matchStart)]
	fn match_start(this: &NavigationHost, matched: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = matchLength)]
	fn match_length(this: &NavigationHost, matched: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = makeMatch)]
	fn make_match(
		this: &NavigationHost,
		start: &JsValue,
		end: &JsValue,
		matched: &JsValue,
	) -> Result<JsValue, JsValue>;
}

struct Host(NavigationHost);
impl vscode_editor_core::SearchNavigationHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn null(&self) -> JsValue {
		JsValue::NULL
	}
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
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
	fn remainder(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(JsValue::from_f64(first % second));
		}
		self.0.remainder(first, second)
	}
	fn at_most(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(first <= second);
		}
		self.0.at_most(first, second)
	}
	fn line_count(&self) -> Result<JsValue, JsValue> {
		self.0.line_count()
	}
	fn start_line(&self) -> Result<JsValue, JsValue> {
		self.0.start_line()
	}
	fn line(&self, number: &JsValue) -> Result<JsValue, JsValue> {
		self.0.line(number)
	}
	fn first_at_start(&self, text: &JsValue, line: &JsValue) -> Result<JsValue, JsValue> {
		self.0.first_at_start(text, line)
	}
	fn first(&self, text: &JsValue, line: &JsValue) -> Result<JsValue, JsValue> {
		self.0.first(text, line)
	}
	fn prefix_at_start(&self, text: &JsValue) -> Result<JsValue, JsValue> {
		self.0.prefix_at_start(text)
	}
	fn last(&self, text: &JsValue, line: &JsValue) -> Result<JsValue, JsValue> {
		self.0.last(text, line)
	}
	fn reset_from_column(&self) -> Result<(), JsValue> {
		self.0.reset_from_column()
	}
	fn reset_start(&self) -> Result<(), JsValue> {
		self.0.reset_start()
	}
	fn next(&self) -> Result<JsValue, JsValue> {
		self.0.next()
	}
	fn match_start(&self, matched: &JsValue) -> Result<JsValue, JsValue> {
		self.0.match_start(matched)
	}
	fn match_length(&self, matched: &JsValue) -> Result<JsValue, JsValue> {
		self.0.match_length(matched)
	}
	fn make_match(
		&self,
		start: &JsValue,
		end: &JsValue,
		matched: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0.make_match(start, end, matched)
	}
}

/// Returns the original match/factory result, releasing all temporary host references on exit.
#[wasm_bindgen]
pub fn run_text_search_navigation(
	host: NavigationHost,
	operation: u32,
) -> Result<JsValue, JsValue> {
	let host = Host(host);
	match operation {
		0 => vscode_editor_core::first_search_match_in_line(&host),
		1 => vscode_editor_core::last_search_match_in_line(&host),
		2 => vscode_editor_core::next_search_match_line_by_line(&host),
		3 => vscode_editor_core::previous_search_match_line_by_line(&host),
		_ => Err(JsValue::from_str(
			"Unsupported text search navigation operation",
		)),
	}
}
