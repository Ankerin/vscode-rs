/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Concrete list mutations retain original field/array aliases and metadata callback failures.

use crate::bracket_trees::WasmBracketTreeResult;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type MutationHost;
	#[wasm_bindgen(method, catch, js_name = incoming)]
	fn incoming(this: &MutationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = item)]
	fn item(this: &MutationHost, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = truthy)]
	fn truthy(this: &MutationHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = invalidCapacity)]
	fn invalid_capacity(this: &MutationHost, operation: u32) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = throwIfImmutable)]
	fn throw_if_immutable(this: &MutationHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = setItem)]
	fn set_item(this: &MutationHost, index: u32, value: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = arrayMutation)]
	fn array_mutation(this: &MutationHost, operation: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = update)]
	fn update(this: &MutationHost) -> Result<(), JsValue>;
}

struct Host(MutationHost);
impl vscode_editor_core::BracketMutationHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn undefined(&self) -> JsValue {
		JsValue::UNDEFINED
	}
	fn null(&self) -> JsValue {
		JsValue::NULL
	}
	fn incoming(&self) -> Result<JsValue, JsValue> {
		self.0.incoming()
	}
	fn item(&self, index: u32) -> Result<JsValue, JsValue> {
		self.0.item(index)
	}
	fn truthy(&self, value: &JsValue) -> Result<bool, JsValue> {
		self.0.truthy(value)
	}
	fn invalid_capacity(&self, operation: u32) -> Result<(), JsValue> {
		self.0.invalid_capacity(operation)
	}
	fn throw_if_immutable(&self) -> Result<(), JsValue> {
		self.0.throw_if_immutable()
	}
	fn set_item(&self, index: u32, value: &JsValue) -> Result<(), JsValue> {
		self.0.set_item(index, value)
	}
	fn array_mutation(&self, operation: u32) -> Result<JsValue, JsValue> {
		self.0.array_mutation(operation)
	}
	fn update(&self) -> Result<(), JsValue> {
		self.0.update()
	}
}

/// Versions concrete list mutations independently of metadata and topology algorithms.
#[wasm_bindgen]
pub fn bracket_mutation_abi_version() -> u32 {
	1
}

/// Mutates once and scopes the actual removed-node or undefined result.
#[wasm_bindgen]
pub fn mutate_bracket_list(
	host: MutationHost,
	operation: u32,
	compact: bool,
) -> Result<WasmBracketTreeResult, JsValue> {
	if operation > 3 {
		return Err(JsValue::from_str("Invalid Rust bracket mutation operation"));
	}
	Ok(WasmBracketTreeResult::new(
		vscode_editor_core::mutate_bracket_list(&Host(host), operation, compact)?,
	))
}
