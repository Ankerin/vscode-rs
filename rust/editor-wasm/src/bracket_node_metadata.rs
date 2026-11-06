/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket scalar fields live in Rust; borrowed host primitives cannot retain facade references.

use std::cell::Cell;
use vscode_editor_core::{BracketNodeMetadata, BracketNodeProperty};
use wasm_bindgen::prelude::*;

thread_local! {
	static LIVE_RECORDS: Cell<u32> = const { Cell::new(0) };
}

/// Owns scalar fields for one bracket facade; generated finalization releases unreachable records.
#[wasm_bindgen]
pub struct WasmBracketNodeMetadata {
	metadata: BracketNodeMetadata<7, ScalarValue>,
}

#[derive(Clone)]
enum ScalarValue {
	Number(f64),
	Boolean(bool),
	Primitive(JsValue),
}

impl ScalarValue {
	fn from_js(value: JsValue) -> Result<Self, JsValue> {
		if let Some(number) = value.as_f64() {
			return Ok(Self::Number(number));
		}
		if let Some(boolean) = value.as_bool() {
			return Ok(Self::Boolean(boolean));
		}
		if value.is_null() || value.is_undefined() || value.is_string() || value.is_bigint() {
			return Ok(Self::Primitive(value));
		}
		Err(JsValue::from_str(
			"Unsupported Rust bracket scalar property value",
		))
	}

	fn into_js(self) -> JsValue {
		match self {
			Self::Number(value) => JsValue::from_f64(value),
			Self::Boolean(value) => JsValue::from_bool(value),
			Self::Primitive(value) => value,
		}
	}
}

#[wasm_bindgen]
impl WasmBracketNodeMetadata {
	#[wasm_bindgen(constructor)]
	pub fn new() -> Self {
		LIVE_RECORDS.with(|count| count.set(count.get() + 1));
		Self {
			metadata: BracketNodeMetadata::default(),
		}
	}

	pub fn has(&self, index: u32) -> bool {
		self.metadata.get(index as usize).is_some()
	}

	pub fn get(&self, index: u32) -> Result<JsValue, JsValue> {
		self.metadata
			.get(index as usize)
			.map(|field| field.value.into_js())
			.ok_or_else(|| JsValue::from_str("Missing Rust bracket node metadata field"))
	}

	pub fn attributes(&self, index: u32) -> Result<u32, JsValue> {
		self.metadata
			.get(index as usize)
			.map(|field| u32::from(field.writable) | (u32::from(field.enumerable) << 1))
			.ok_or_else(|| JsValue::from_str("Missing Rust bracket node metadata field"))
	}

	pub fn define(
		&mut self,
		index: u32,
		value: JsValue,
		writable: bool,
		enumerable: bool,
	) -> Result<(), JsValue> {
		if !self.metadata.define(
			index as usize,
			BracketNodeProperty {
				value: ScalarValue::from_js(value)?,
				writable,
				enumerable,
			},
		) {
			return Err(JsValue::from_str(
				"Invalid Rust bracket node metadata field",
			));
		}
		Ok(())
	}

	pub fn remove(&mut self, index: u32) {
		self.metadata.remove(index as usize);
	}
}

impl Default for WasmBracketNodeMetadata {
	fn default() -> Self {
		Self::new()
	}
}

impl Drop for WasmBracketNodeMetadata {
	fn drop(&mut self) {
		LIVE_RECORDS.with(|count| count.set(count.get() - 1));
	}
}

/// Versions the owning scalar metadata contract independently of AST traversal operations.
#[wasm_bindgen]
pub fn bracket_node_metadata_abi_version() -> u32 {
	3
}

/// Exposes resource ownership to disposal tests without retaining a handle registry.
#[wasm_bindgen]
pub fn bracket_node_metadata_live_count() -> u32 {
	LIVE_RECORDS.with(Cell::get)
}
