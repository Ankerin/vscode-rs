/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Numeric AST fields live in Rust without retaining facade references or a second graph.

use std::cell::Cell;
use vscode_editor_core::{BracketNodeMetadata, BracketNodeNumber};
use wasm_bindgen::prelude::*;

thread_local! {
	static LIVE_RECORDS: Cell<u32> = const { Cell::new(0) };
}

/// Owns numeric fields for one AST facade; generated finalization releases unreachable records.
#[wasm_bindgen]
pub struct WasmBracketNodeMetadata {
	metadata: BracketNodeMetadata,
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

	pub fn get(&self, index: u32) -> Result<f64, JsValue> {
		self.metadata
			.get(index as usize)
			.map(|field| field.value)
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
		value: f64,
		writable: bool,
		enumerable: bool,
	) -> Result<(), JsValue> {
		if !self.metadata.define(
			index as usize,
			BracketNodeNumber {
				value,
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
	1
}

/// Exposes resource ownership to disposal tests without retaining a handle registry.
#[wasm_bindgen]
pub fn bracket_node_metadata_live_count() -> u32 {
	LIVE_RECORDS.with(Cell::get)
}
