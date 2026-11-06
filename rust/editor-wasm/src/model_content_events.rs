/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Scoped content-event batching preserves original event identities and caught callback failures.

use vscode_editor_core::{ModelContentEventsHost, ModelContentEventsOperation};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type ContentEventsHost;
	#[wasm_bindgen(method, catch, js_name = get)]
	fn get(this: &ContentEventsHost, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = set)]
	fn set(this: &ContentEventsHost, index: u32, value: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = increment)]
	fn increment(
		this: &ContentEventsHost,
		value: &JsValue,
		increase: bool,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = aboveZero)]
	fn above_zero(this: &ContentEventsHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = hasListeners)]
	fn has_listeners(this: &ContentEventsHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = assignSelection)]
	fn assign_selection(
		this: &ContentEventsHost,
		event: &JsValue,
		selection: &JsValue,
	) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = merge)]
	fn merge(
		this: &ContentEventsHost,
		previous: &JsValue,
		current: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = fire)]
	fn fire(this: &ContentEventsHost, event: &JsValue) -> Result<(), JsValue>;
}

struct Host(ContentEventsHost);
impl ModelContentEventsHost for Host {
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
	fn numeric(&self, value: &JsValue) -> Option<f64> {
		value.as_f64()
	}
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn is_null(&self, value: &JsValue) -> bool {
		value.is_null()
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
	fn above_zero(&self, value: &JsValue) -> Result<bool, JsValue> {
		self.0.above_zero(value)
	}
	fn has_listeners(&self) -> Result<JsValue, JsValue> {
		self.0.has_listeners()
	}
	fn assign_selection(&self, event: &JsValue, selection: &JsValue) -> Result<(), JsValue> {
		self.0.assign_selection(event, selection)
	}
	fn merge(&self, previous: &JsValue, current: &JsValue) -> Result<JsValue, JsValue> {
		self.0.merge(previous, current)
	}
	fn fire(&self, event: &JsValue) -> Result<(), JsValue> {
		self.0.fire(event)
	}
}

/// Identifies complete deferred model content-event control independently of generic events.
#[wasm_bindgen]
pub fn model_content_events_abi_version() -> u32 {
	1
}

/// Runs a content-event transition with borrowed fields, events, and selections.
#[wasm_bindgen]
pub fn run_model_content_events(
	host: ContentEventsHost,
	operation: u32,
	input: JsValue,
) -> Result<JsValue, JsValue> {
	use ModelContentEventsOperation as O;
	let operation = match operation {
		0 => O::HasListeners,
		1 => O::Begin,
		2 => O::End,
		3 => O::Fire,
		_ => {
			return Err(JsValue::from_str(
				"Unsupported model content event operation",
			));
		}
	};
	vscode_editor_core::run_model_content_events(&Host(host), operation, &input)
}
