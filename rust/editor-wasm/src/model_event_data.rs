/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Event data merging preserves original fields, array capabilities, and factory results.

use vscode_editor_core::ModelEventDataHost;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type EventDataHost;
	#[wasm_bindgen(method, catch, js_name = get)]
	fn get(this: &EventDataHost, event: &JsValue, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = empty)]
	fn empty(this: &EventDataHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = concatMethod)]
	fn concat_method(this: &EventDataHost, array: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = concat)]
	fn concat(this: &EventDataHost, method: &JsValue, input: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = mergeMethod)]
	fn merge_method(this: &EventDataHost, raw: bool) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = internalField)]
	fn internal_field(this: &EventDataHost, event: &JsValue, raw: bool)
	-> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = merge)]
	fn merge(
		this: &EventDataHost,
		method: &JsValue,
		first: &JsValue,
		second: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = internal)]
	fn internal(this: &EventDataHost, raw: &JsValue, content: &JsValue)
	-> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = length)]
	fn length(this: &EventDataHost, array: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = less)]
	fn less(this: &EventDataHost, index: f64, length: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = changeType)]
	fn change_type(this: &EventDataHost, event: &JsValue, index: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = raw)]
	fn raw(
		this: &EventDataHost,
		changes: &JsValue,
		version: &JsValue,
		undo: &JsValue,
		redo: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[allow(clippy::too_many_arguments)]
	#[wasm_bindgen(method, catch, js_name = content)]
	fn content(
		this: &EventDataHost,
		changes: &JsValue,
		eol: &JsValue,
		eol_change: &JsValue,
		version: &JsValue,
		undo: &JsValue,
		redo: &JsValue,
		flush: &JsValue,
		reasons: &JsValue,
		lengths: &JsValue,
	) -> Result<JsValue, JsValue>;
}

struct Host(EventDataHost);
impl ModelEventDataHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn same(&self, first: &JsValue, second: &JsValue) -> bool {
		first == second
	}
	fn get(&self, event: &JsValue, index: u32) -> Result<JsValue, JsValue> {
		self.0.get(event, index)
	}
	fn empty(&self) -> Result<JsValue, JsValue> {
		self.0.empty()
	}
	fn concat_method(&self, array: &JsValue) -> Result<JsValue, JsValue> {
		self.0.concat_method(array)
	}
	fn concat(&self, method: &JsValue, input: &JsValue) -> Result<JsValue, JsValue> {
		self.0.concat(method, input)
	}
	fn merge_method(&self, raw: bool) -> Result<JsValue, JsValue> {
		self.0.merge_method(raw)
	}
	fn internal_field(&self, event: &JsValue, raw: bool) -> Result<JsValue, JsValue> {
		self.0.internal_field(event, raw)
	}
	fn merge(
		&self,
		method: &JsValue,
		first: &JsValue,
		second: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0.merge(method, first, second)
	}
	fn internal(&self, raw: &JsValue, content: &JsValue) -> Result<JsValue, JsValue> {
		self.0.internal(raw, content)
	}
	fn length(&self, array: &JsValue) -> Result<JsValue, JsValue> {
		self.0.length(array)
	}
	fn less(&self, index: f64, length: &JsValue) -> Result<bool, JsValue> {
		if let Some(length) = length.as_f64() {
			return Ok(index < length);
		}
		self.0.less(index, length)
	}
	fn change_type(&self, event: &JsValue, index: f64) -> Result<JsValue, JsValue> {
		self.0.change_type(event, index)
	}
	fn raw(&self, values: &[JsValue; 4]) -> Result<JsValue, JsValue> {
		self.0.raw(&values[0], &values[1], &values[2], &values[3])
	}
	fn content(&self, values: &[JsValue; 9]) -> Result<JsValue, JsValue> {
		self.0.content(
			&values[0], &values[1], &values[2], &values[3], &values[4], &values[5], &values[6],
			&values[7], &values[8],
		)
	}
}

/// Identifies model raw/internal/content event data control separately from event batching.
#[wasm_bindgen]
pub fn model_event_data_abi_version() -> u32 {
	1
}

/// Runs complete event merging or raw event presence scanning through original capabilities.
#[wasm_bindgen]
pub fn run_model_event_data(
	host: EventDataHost,
	operation: u32,
	first: JsValue,
	second: JsValue,
) -> Result<JsValue, JsValue> {
	let host = Host(host);
	match operation {
		0 => vscode_editor_core::merge_raw_model_events(&host, &first, &second),
		1 => vscode_editor_core::merge_model_content_data(&host, &first, &second),
		2 => vscode_editor_core::merge_internal_model_events(&host, &first, &second),
		3 => vscode_editor_core::contains_raw_model_event(&host, &first, &second)
			.map(JsValue::from_bool),
		_ => Err(JsValue::from_str("Unsupported model event data operation")),
	}
}
