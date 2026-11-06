/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Owning array entries retain primitive/reference handles and use generated finalization.

use crate::bracket_node_metadata::ScalarValue;
use std::cell::Cell;
use vscode_editor_core::{BracketNodeProperty, BracketNumberArray};
use wasm_bindgen::prelude::*;

thread_local! {
	static LIVE_ARRAYS: Cell<u32> = const { Cell::new(0) };
}

/// Stores the numeric payload of a reader stack behind its original array protocol.
#[wasm_bindgen]
pub struct WasmBracketNumberArray {
	array: BracketNumberArray<ScalarValue>,
}

#[wasm_bindgen]
impl WasmBracketNumberArray {
	#[wasm_bindgen(constructor)]
	pub fn new() -> Self {
		LIVE_ARRAYS.with(|count| count.set(count.get() + 1));
		Self {
			array: BracketNumberArray::default(),
		}
	}

	pub fn prepare(&mut self, index: u32) -> Result<bool, JsValue> {
		self.array
			.prepare(index as usize)
			.map_err(JsValue::from_str)
	}

	pub fn has(&self, index: u32) -> bool {
		self.array.get(index as usize).is_some()
	}

	pub fn get(&self, index: u32) -> Result<JsValue, JsValue> {
		self.field(index).map(|field| field.value.into_js())
	}

	pub fn attributes(&self, index: u32) -> Result<u32, JsValue> {
		self.field(index)
			.map(|field| u32::from(field.writable) | (u32::from(field.enumerable) << 1))
	}

	pub fn define(
		&mut self,
		index: u32,
		value: JsValue,
		writable: bool,
		enumerable: bool,
	) -> Result<(), JsValue> {
		if !self.array.define(
			index as usize,
			BracketNodeProperty {
				value: ScalarValue::from_js(value)?,
				writable,
				enumerable,
			},
		) {
			return Err(JsValue::from_str(
				"Unprepared Rust bracket number array entry",
			));
		}
		Ok(())
	}

	/// Resolves an entry's handle through the facade's collector-visible host anchors.
	pub fn reference(&self, index: u32) -> Option<u32> {
		self.array.get(index as usize).and_then(|field| {
			if let ScalarValue::Reference(reference) = field.value {
				Some(reference)
			} else {
				None
			}
		})
	}

	/// Commits a prepared reference entry without retaining a native host graph root.
	pub fn define_reference(
		&mut self,
		index: u32,
		reference: u32,
		writable: bool,
		enumerable: bool,
	) -> Result<(), JsValue> {
		if !self.array.define(
			index as usize,
			BracketNodeProperty {
				value: ScalarValue::Reference(reference),
				writable,
				enumerable,
			},
		) {
			return Err(JsValue::from_str(
				"Unprepared Rust bracket number array entry",
			));
		}
		Ok(())
	}

	pub fn remove(&mut self, index: u32) {
		self.array.remove(index as usize);
	}

	pub fn truncate(&mut self, length: u32) {
		self.array.truncate(length as usize);
	}

	pub fn indices(&self) -> Vec<u32> {
		self.array.indices()
	}
}

impl WasmBracketNumberArray {
	fn field(&self, index: u32) -> Result<BracketNodeProperty<ScalarValue>, JsValue> {
		self.array
			.get(index as usize)
			.ok_or_else(|| JsValue::from_str("Missing Rust bracket number array entry"))
	}
}

impl Default for WasmBracketNumberArray {
	fn default() -> Self {
		Self::new()
	}
}

impl Drop for WasmBracketNumberArray {
	fn drop(&mut self) {
		LIVE_ARRAYS.with(|count| count.set(count.get() - 1));
	}
}

/// Versions owning stack payloads separately from numeric parser/AST scalar fields.
#[wasm_bindgen]
pub fn bracket_number_array_abi_version() -> u32 {
	2
}

/// Reports owning arrays without retaining a second global handle registry.
#[wasm_bindgen]
pub fn bracket_number_array_live_count() -> u32 {
	LIVE_ARRAYS.with(Cell::get)
}
