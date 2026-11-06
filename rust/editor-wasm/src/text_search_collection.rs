/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Scoped range collection retains original line providers, result arrays, and factories.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type CollectionHost;
	#[wasm_bindgen(method, catch, js_name = add)]
	fn add(this: &CollectionHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = increment)]
	fn increment(this: &CollectionHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = equal)]
	fn equal(this: &CollectionHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = below)]
	fn below(this: &CollectionHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = atLeast)]
	fn at_least(this: &CollectionHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = createResult)]
	fn create_result(this: &CollectionHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = startLine)]
	fn start_line(this: &CollectionHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = endLine)]
	fn end_line(this: &CollectionHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = singleLine)]
	fn single_line(
		this: &CollectionHost,
		result: &JsValue,
		count: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = firstLine)]
	fn first_line(
		this: &CollectionHost,
		result: &JsValue,
		count: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = middleLine)]
	fn middle_line(
		this: &CollectionHost,
		line: &JsValue,
		result: &JsValue,
		count: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = lastLine)]
	fn last_line(
		this: &CollectionHost,
		result: &JsValue,
		count: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = prepareMultiline)]
	fn prepare_multiline(this: &CollectionHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = resetMultiline)]
	fn reset_multiline(this: &CollectionHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = nextMultiline)]
	fn next_multiline(this: &CollectionHost, context: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = writeMultiline)]
	fn write_multiline(
		this: &CollectionHost,
		context: &JsValue,
		result: &JsValue,
		index: f64,
		matched: &JsValue,
	) -> Result<(), JsValue>;
}

struct Host(CollectionHost);
impl vscode_editor_core::SearchCollectionHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn increment(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		if let Some(value) = value.as_f64() {
			return Ok(JsValue::from_f64(value + 1.0));
		}
		self.0.increment(value)
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
	fn below(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(first < second);
		}
		self.0.below(first, second)
	}
	fn at_least(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(first >= second);
		}
		self.0.at_least(first, second)
	}
	fn create_result(&self) -> Result<JsValue, JsValue> {
		self.0.create_result()
	}
	fn start_line(&self) -> Result<JsValue, JsValue> {
		self.0.start_line()
	}
	fn end_line(&self) -> Result<JsValue, JsValue> {
		self.0.end_line()
	}
	fn single_line(&self, result: &JsValue, count: &JsValue) -> Result<JsValue, JsValue> {
		self.0.single_line(result, count)
	}
	fn first_line(&self, result: &JsValue, count: &JsValue) -> Result<JsValue, JsValue> {
		self.0.first_line(result, count)
	}
	fn middle_line(
		&self,
		line: &JsValue,
		result: &JsValue,
		count: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0.middle_line(line, result, count)
	}
	fn last_line(&self, result: &JsValue, count: &JsValue) -> Result<JsValue, JsValue> {
		self.0.last_line(result, count)
	}
	fn prepare_multiline(&self) -> Result<JsValue, JsValue> {
		self.0.prepare_multiline()
	}
	fn reset_multiline(&self) -> Result<(), JsValue> {
		self.0.reset_multiline()
	}
	fn next_multiline(&self, context: &JsValue) -> Result<JsValue, JsValue> {
		self.0.next_multiline(context)
	}
	fn write_multiline(
		&self,
		context: &JsValue,
		result: &JsValue,
		index: f64,
		matched: &JsValue,
	) -> Result<(), JsValue> {
		self.0.write_multiline(context, result, index, matched)
	}
}

/// Returns the same result array and releases all scoped context and callback references on exit.
#[wasm_bindgen]
pub fn collect_text_search_range(
	host: CollectionHost,
	operation: u32,
	limit: JsValue,
) -> Result<JsValue, JsValue> {
	let host = Host(host);
	match operation {
		0 => vscode_editor_core::collect_search_line_ranges(&host, &limit),
		1 => vscode_editor_core::collect_search_multiline_range(&host, &limit),
		_ => Err(JsValue::from_str(
			"Unsupported text search collection operation",
		)),
	}
}
