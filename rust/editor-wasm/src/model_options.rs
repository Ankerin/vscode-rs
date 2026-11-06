/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Scoped resolved-option control retains source/reference identities and exceptions.

use vscode_editor_core::ModelOptionsHost;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type OptionsHost;
	#[wasm_bindgen(method, catch, js_name = source)]
	fn source(this: &OptionsHost, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = get)]
	fn get(this: &OptionsHost, other: bool, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = set)]
	fn set(this: &OptionsHost, index: u32, value: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = integer)]
	fn integer(this: &OptionsHost, value: &JsValue, minimum: bool) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = bracketsEqual)]
	fn brackets_equal(
		this: &OptionsHost,
		first: &JsValue,
		second: &JsValue,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = createEvent)]
	fn create_event(this: &OptionsHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = eventField)]
	fn event_field(
		this: &OptionsHost,
		event: &JsValue,
		index: u32,
		changed: bool,
	) -> Result<(), JsValue>;
}

struct Host(OptionsHost);
impl ModelOptionsHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn boolean(&self, value: bool) -> JsValue {
		JsValue::from_bool(value)
	}
	fn undefined(&self) -> JsValue {
		JsValue::UNDEFINED
	}
	fn tab_size(&self) -> JsValue {
		JsValue::from_str("tabSize")
	}
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn is_tab_size(&self, value: &JsValue) -> bool {
		*value == JsValue::from_str("tabSize")
	}
	fn equal(&self, first: &JsValue, second: &JsValue) -> bool {
		first == second
	}
	fn integer(&self, value: &JsValue, minimum: bool) -> Result<JsValue, JsValue> {
		if let Some(value) = value.as_f64() {
			return Ok(JsValue::from_f64(vscode_editor_core::model_option_integer(
				value, minimum,
			)));
		}
		self.0.integer(value, minimum)
	}
	fn source(&self, index: u32) -> Result<JsValue, JsValue> {
		self.0.source(index)
	}
	fn get(&self, other: bool, index: u32) -> Result<JsValue, JsValue> {
		self.0.get(other, index)
	}
	fn set(&self, index: u32, value: &JsValue) -> Result<(), JsValue> {
		self.0.set(index, value)
	}
	fn brackets_equal(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		self.0.brackets_equal(first, second)
	}
	fn create_event(&self) -> Result<JsValue, JsValue> {
		self.0.create_event()
	}
	fn event_field(&self, event: &JsValue, index: u32, changed: bool) -> Result<(), JsValue> {
		self.0.event_field(event, index, changed)
	}
}

/// Identifies resolved model option control separately from model lifecycle.
#[wasm_bindgen]
pub fn model_options_abi_version() -> u32 {
	1
}

/// Runs construction, original indentation, equality, or change-event creation with scoped values.
#[wasm_bindgen]
pub fn run_model_options(host: OptionsHost, operation: u32) -> Result<JsValue, JsValue> {
	let host = Host(host);
	match operation {
		0 => vscode_editor_core::initialize_model_options(&host),
		1 => vscode_editor_core::original_model_indent_size(&host),
		2 => vscode_editor_core::model_options_equal(&host),
		3 => vscode_editor_core::model_options_change_event(&host),
		_ => Err(JsValue::from_str("Unsupported model options operation")),
	}
}
