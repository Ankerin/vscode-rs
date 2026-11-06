/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Scoped model option updates and indentation retain original factories and callbacks.

use vscode_editor_core::ModelOptionsControllerHost;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type ControllerHost;
	#[wasm_bindgen(method, catch, js_name = assertAlive)]
	fn assert_alive(this: &ControllerHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = request)]
	fn request(this: &ControllerHost, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = current)]
	fn current(this: &ControllerHost, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = options)]
	fn options(this: &ControllerHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = resolveSource)]
	fn resolve_source(this: &ControllerHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = construct)]
	fn construct(
		this: &ControllerHost,
		tab: &JsValue,
		indent: &JsValue,
		insert: &JsValue,
		eol: &JsValue,
		trim: &JsValue,
		brackets: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = equal)]
	fn equal(this: &ControllerHost, options: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = changeEvent)]
	fn change_event(this: &ControllerHost, options: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = assign)]
	fn assign(this: &ControllerHost, options: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = notify)]
	fn notify(this: &ControllerHost, index: u32, event: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = guess)]
	fn guess(
		this: &ControllerHost,
		tab_size: &JsValue,
		insert_spaces: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = guessed)]
	fn guessed(this: &ControllerHost, guess: &JsValue, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = updateMethod)]
	fn update_method(this: &ControllerHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = update)]
	fn update(
		this: &ControllerHost,
		method: &JsValue,
		insert: &JsValue,
		tab: &JsValue,
		indent: &JsValue,
	) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = format)]
	fn format(this: &ControllerHost, tab: &JsValue, insert: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = normalize)]
	fn normalize(
		this: &ControllerHost,
		text: &JsValue,
		indent: &JsValue,
		insert: &JsValue,
	) -> Result<JsValue, JsValue>;
}

struct Host(ControllerHost);
impl ModelOptionsControllerHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn undefined(&self) -> JsValue {
		JsValue::UNDEFINED
	}
	fn tab_size(&self) -> JsValue {
		JsValue::from_str("tabSize")
	}
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn is_undefined(&self, value: &JsValue) -> bool {
		value.is_undefined()
	}
	fn construct(&self, values: &[JsValue; 6]) -> Result<JsValue, JsValue> {
		self.0.construct(
			&values[0], &values[1], &values[2], &values[3], &values[4], &values[5],
		)
	}
	fn assert_alive(&self) -> Result<(), JsValue> {
		self.0.assert_alive()
	}
	fn request(&self, index: u32) -> Result<JsValue, JsValue> {
		self.0.request(index)
	}
	fn current(&self, index: u32) -> Result<JsValue, JsValue> {
		self.0.current(index)
	}
	fn options(&self) -> Result<JsValue, JsValue> {
		self.0.options()
	}
	fn resolve_source(&self) -> Result<JsValue, JsValue> {
		self.0.resolve_source()
	}
	fn equal(&self, options: &JsValue) -> Result<bool, JsValue> {
		self.0.equal(options)
	}
	fn change_event(&self, options: &JsValue) -> Result<JsValue, JsValue> {
		self.0.change_event(options)
	}
	fn assign(&self, options: &JsValue) -> Result<(), JsValue> {
		self.0.assign(options)
	}
	fn notify(&self, index: u32, event: &JsValue) -> Result<(), JsValue> {
		self.0.notify(index, event)
	}
	fn guess(&self, tab_size: &JsValue, insert_spaces: &JsValue) -> Result<JsValue, JsValue> {
		self.0.guess(tab_size, insert_spaces)
	}
	fn guessed(&self, guess: &JsValue, index: u32) -> Result<JsValue, JsValue> {
		self.0.guessed(guess, index)
	}
	fn update_method(&self) -> Result<JsValue, JsValue> {
		self.0.update_method()
	}
	fn update(
		&self,
		method: &JsValue,
		insert: &JsValue,
		tab: &JsValue,
		indent: &JsValue,
	) -> Result<(), JsValue> {
		self.0.update(method, insert, tab, indent)
	}
	fn format(&self, tab: &JsValue, insert: &JsValue) -> Result<JsValue, JsValue> {
		self.0.format(tab, insert)
	}
	fn normalize(
		&self,
		text: &JsValue,
		indent: &JsValue,
		insert: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0.normalize(text, indent, insert)
	}
}

/// Identifies model option resolution/update control separately from resolved option records.
#[wasm_bindgen]
pub fn model_options_controller_abi_version() -> u32 {
	1
}

/// Runs complete model option or indentation orchestration through original capabilities.
#[wasm_bindgen]
pub fn run_model_options_controller(
	host: ControllerHost,
	operation: u32,
	first: JsValue,
	second: JsValue,
) -> Result<JsValue, JsValue> {
	let host = Host(host);
	match operation {
		0 => vscode_editor_core::resolve_model_options(&host),
		1 => vscode_editor_core::read_model_options(&host, false),
		2 => vscode_editor_core::read_model_options(&host, true),
		3 => vscode_editor_core::update_model_options(&host),
		4 => vscode_editor_core::detect_model_indentation(&host, &first, &second),
		5 => vscode_editor_core::normalize_model_indentation(&host, &first),
		_ => Err(JsValue::from_str(
			"Unsupported model option controller operation",
		)),
	}
}
