/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Scoped model lifecycle control propagates original events, receivers, and exceptions.

use vscode_editor_core::{
	ModelComparison, ModelLifecycleAction, ModelLifecycleField, ModelLifecycleHost,
	ModelLifecycleOperation,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type LifecycleHost;
	#[wasm_bindgen(method, catch, js_name = get)]
	fn get(this: &LifecycleHost, field: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = set)]
	fn set(this: &LifecycleHost, field: u32, value: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = action)]
	fn action(this: &LifecycleHost, action: u32, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = listener)]
	fn listener(this: &LifecycleHost, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = add)]
	fn add(this: &LifecycleHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = increment)]
	fn increment(this: &LifecycleHost, value: &JsValue, increase: bool)
	-> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = compare)]
	fn compare(
		this: &LifecycleHost,
		operation: u32,
		first: &JsValue,
		second: &JsValue,
	) -> Result<bool, JsValue>;
}

struct Host(LifecycleHost);
impl ModelLifecycleHost for Host {
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
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn get(&self, field: ModelLifecycleField) -> Result<JsValue, JsValue> {
		self.0.get(field as u32)
	}
	fn set(&self, field: ModelLifecycleField, value: &JsValue) -> Result<(), JsValue> {
		self.0.set(field as u32, value)
	}
	fn action(&self, action: ModelLifecycleAction, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.action(action as u32, value)
	}
	fn listener(&self, index: u32) -> Result<JsValue, JsValue> {
		self.0.listener(index)
	}
	fn add(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(JsValue::from_f64(first + second));
		}
		self.0.add(first, second)
	}
	fn increment(&self, value: &JsValue, increase: bool) -> Result<JsValue, JsValue> {
		if let Some(value) = value.as_f64() {
			return Ok(JsValue::from_f64(value + if increase { 1.0 } else { -1.0 }));
		}
		self.0.increment(value, increase)
	}
	fn compare(
		&self,
		operation: ModelComparison,
		first: &JsValue,
		second: &JsValue,
	) -> Result<bool, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(match operation {
				ModelComparison::Equal => first == second,
				ModelComparison::Below => first < second,
				ModelComparison::Above => first > second,
				ModelComparison::AtMost => first <= second,
				ModelComparison::AtLeast => first >= second,
			});
		}
		self.0.compare(operation as u32, first, second)
	}
}

/// Identifies lifecycle transition control separately from model reads.
#[wasm_bindgen]
pub fn model_lifecycle_abi_version() -> u32 {
	1
}

/// Runs one complete ordered lifecycle transition, retaining no persistent duplicate model.
#[wasm_bindgen]
pub fn run_model_lifecycle(
	host: LifecycleHost,
	operation: u32,
	input: JsValue,
) -> Result<JsValue, JsValue> {
	let operation = match operation {
		0 => ModelLifecycleOperation::Dispose,
		1 => ModelLifecycleOperation::HasListeners,
		2 => ModelLifecycleOperation::AssertAlive,
		3 => ModelLifecycleOperation::Attach,
		4 => ModelLifecycleOperation::Detach,
		5 => ModelLifecycleOperation::IsAttached,
		6 => ModelLifecycleOperation::AttachedCount,
		7 => ModelLifecycleOperation::TooLargeSync,
		8 => ModelLifecycleOperation::TooLargeTokens,
		9 => ModelLifecycleOperation::TooLargeHeap,
		10 => ModelLifecycleOperation::Disposed,
		11 => ModelLifecycleOperation::Disposing,
		12 => ModelLifecycleOperation::IncreaseVersion,
		13 => ModelLifecycleOperation::OverwriteVersion,
		14 => ModelLifecycleOperation::OverwriteAlternative,
		15 => ModelLifecycleOperation::OverwriteInitial,
		_ => return Err(JsValue::from_str("Unsupported model lifecycle operation")),
	};
	vscode_editor_core::run_model_lifecycle(&Host(host), operation, &input)
}
