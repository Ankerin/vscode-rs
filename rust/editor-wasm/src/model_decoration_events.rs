/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Decoration event batching uses original set, callback, and factory identities.

use vscode_editor_core::{ModelDecorationEventsHost, ModelDecorationEventsOperation};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type DecorationEventsHost;
	#[wasm_bindgen(method, catch, js_name = get)]
	fn get(this: &DecorationEventsHost, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = set)]
	fn set(this: &DecorationEventsHost, index: u32, value: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = increment)]
	fn increment(
		this: &DecorationEventsHost,
		value: &JsValue,
		increase: bool,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = hasListeners)]
	fn has_listeners(this: &DecorationEventsHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = tryFire)]
	fn try_fire(this: &DecorationEventsHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = deliver)]
	fn deliver(this: &DecorationEventsHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = clear)]
	fn clear(this: &DecorationEventsHost, set: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = createSet)]
	fn create_set(this: &DecorationEventsHost, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = add)]
	fn add(this: &DecorationEventsHost, index: u32, input: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = optionFlag)]
	fn option_flag(
		this: &DecorationEventsHost,
		input: &JsValue,
		index: u32,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = beforeMethod)]
	fn before_method(this: &DecorationEventsHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = fireEvent)]
	fn fire_event(this: &DecorationEventsHost, event: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = before)]
	fn before(
		this: &DecorationEventsHost,
		method: &JsValue,
		injected: &JsValue,
		heights: &JsValue,
		fonts: &JsValue,
	) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = event)]
	fn event(
		this: &DecorationEventsHost,
		mini: &JsValue,
		overview: &JsValue,
		glyph: &JsValue,
		line: &JsValue,
	) -> Result<JsValue, JsValue>;
}

struct Host(DecorationEventsHost);
impl ModelDecorationEventsHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn null(&self) -> JsValue {
		JsValue::NULL
	}
	fn undefined(&self) -> JsValue {
		JsValue::UNDEFINED
	}
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn boolean(&self, value: bool) -> JsValue {
		JsValue::from_bool(value)
	}
	fn numeric(&self, value: &JsValue) -> Option<f64> {
		value.as_f64()
	}
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn nullish(&self, value: &JsValue) -> bool {
		value.is_null() || value.is_undefined()
	}
	fn get(&self, index: u32) -> Result<JsValue, JsValue> {
		self.0.get(index)
	}
	fn set(&self, index: u32, value: &JsValue) -> Result<(), JsValue> {
		self.0.set(index, value)
	}
	fn increment(&self, value: &JsValue, increase: bool) -> Result<JsValue, JsValue> {
		self.0.increment(value, increase)
	}
	fn has_listeners(&self) -> Result<JsValue, JsValue> {
		self.0.has_listeners()
	}
	fn try_fire(&self) -> Result<(), JsValue> {
		self.0.try_fire()
	}
	fn deliver(&self) -> Result<(), JsValue> {
		self.0.deliver()
	}
	fn clear(&self, set: &JsValue) -> Result<(), JsValue> {
		self.0.clear(set)
	}
	fn create_set(&self, index: u32) -> Result<JsValue, JsValue> {
		self.0.create_set(index)
	}
	fn add(&self, index: u32, input: &JsValue) -> Result<(), JsValue> {
		self.0.add(index, input)
	}
	fn option_flag(&self, input: &JsValue, index: u32) -> Result<JsValue, JsValue> {
		self.0.option_flag(input, index)
	}
	fn before_method(&self) -> Result<JsValue, JsValue> {
		self.0.before_method()
	}
	fn fire_event(&self, event: &JsValue) -> Result<(), JsValue> {
		self.0.fire_event(event)
	}
	fn before(&self, method: &JsValue, sets: &[JsValue; 3]) -> Result<(), JsValue> {
		self.0.before(method, &sets[0], &sets[1], &sets[2])
	}
	fn event(&self, flags: &[JsValue; 4]) -> Result<JsValue, JsValue> {
		self.0.event(&flags[0], &flags[1], &flags[2], &flags[3])
	}
}

/// Identifies complete model decoration-event control independently of endpoint editing.
#[wasm_bindgen]
pub fn model_decoration_events_abi_version() -> u32 {
	1
}

/// Runs a decoration event transition with original fields, callback order, and result identities.
#[wasm_bindgen]
pub fn run_model_decoration_events(
	host: DecorationEventsHost,
	operation: u32,
	input: JsValue,
) -> Result<JsValue, JsValue> {
	use ModelDecorationEventsOperation as O;
	let operation = match operation {
		0 => O::HasListeners,
		1 => O::Begin,
		2 => O::End,
		3 => O::Injected,
		4 => O::Height,
		5 => O::Font,
		6 => O::Check,
		7 => O::Fire,
		8 => O::Try,
		9 => O::Deliver,
		_ => {
			return Err(JsValue::from_str(
				"Unsupported model decoration event operation",
			));
		}
	};
	vscode_editor_core::run_model_decoration_events(&Host(host), operation, &input)
}
