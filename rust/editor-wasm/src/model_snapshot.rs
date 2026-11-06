/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Scoped streaming reads retain original source values and errors.

use vscode_editor_core::{ModelComparison, ModelSnapshotHost};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type SnapshotHost;
	#[wasm_bindgen(method, catch, js_name = eos)]
	fn eos(this: &SnapshotHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = createResult)]
	fn create_result(this: &SnapshotHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = read)]
	fn read(this: &SnapshotHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = setEos)]
	fn set_eos(this: &SnapshotHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = length)]
	fn length(this: &SnapshotHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = compare)]
	fn compare(
		this: &SnapshotHost,
		operation: u32,
		first: &JsValue,
		second: &JsValue,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = add)]
	fn add(this: &SnapshotHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = write)]
	fn write(
		this: &SnapshotHost,
		result: &JsValue,
		index: f64,
		value: &JsValue,
	) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = join)]
	fn join(this: &SnapshotHost, result: &JsValue) -> Result<JsValue, JsValue>;
}

struct Host(SnapshotHost);
impl ModelSnapshotHost for Host {
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
	fn is_null(&self, value: &JsValue) -> bool {
		value.is_null()
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
	fn add(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(JsValue::from_f64(first + second));
		}
		self.0.add(first, second)
	}
	fn eos(&self) -> Result<JsValue, JsValue> {
		self.0.eos()
	}
	fn create_result(&self) -> Result<JsValue, JsValue> {
		self.0.create_result()
	}
	fn read(&self) -> Result<JsValue, JsValue> {
		self.0.read()
	}
	fn set_eos(&self) -> Result<(), JsValue> {
		self.0.set_eos()
	}
	fn length(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.length(value)
	}
	fn write(&self, result: &JsValue, index: f64, value: &JsValue) -> Result<(), JsValue> {
		self.0.write(result, index, value)
	}
	fn join(&self, result: &JsValue) -> Result<JsValue, JsValue> {
		self.0.join(result)
	}
}

/// Identifies streaming snapshot control separately from text storage.
#[wasm_bindgen]
pub fn model_snapshot_abi_version() -> u32 {
	1
}

/// Returns the original joined value or null without retaining the snapshot/source/result.
#[wasm_bindgen]
pub fn read_model_snapshot(host: SnapshotHost) -> Result<JsValue, JsValue> {
	vscode_editor_core::read_model_snapshot(&Host(host))
}
