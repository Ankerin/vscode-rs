/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Tree construction returns a scoped host result reference and retains the original factory callbacks.

use js_sys::Function;
use wasm_bindgen::prelude::*;

/// Versions integrated bracket-tree construction independently of lengths and identifier sets.
#[wasm_bindgen]
pub fn bracket_trees_abi_version() -> u32 {
	1
}

/// Transfers one original result, including null/undefined callback returns, without a host array wrapper.
#[wasm_bindgen]
pub struct WasmBracketTreeResult {
	node: Option<JsValue>,
}

#[wasm_bindgen]
impl WasmBracketTreeResult {
	/// Releases the held reference when consumed; the adapter immediately frees the scoped result handle.
	pub fn take(&mut self) -> JsValue {
		self.node.take().unwrap_or(JsValue::UNDEFINED)
	}
}

/// Runs the original equal-height grouping and aborts on the same factory/slot-write exception.
#[wasm_bindgen]
pub fn concat_bracket_trees_same_height(
	length: f64,
	create: Function,
) -> Result<Option<WasmBracketTreeResult>, JsValue> {
	if !length.is_finite() || length.fract() != 0.0 || !(2.0..=262_144.0).contains(&length) {
		return Ok(None);
	}
	let result = vscode_editor_core::concat_bracket_trees_same_height(length as usize, |group| {
		create.call4(
			&JsValue::UNDEFINED,
			&JsValue::from_f64(group.target.map_or(-1.0, |index| index as f64)),
			&JsValue::from_f64(group.first as f64),
			&JsValue::from_f64(group.second as f64),
			&JsValue::from_f64(group.third.map_or(-1.0, |index| index as f64)),
		)
	})?;
	Ok(result.map(|node| WasmBracketTreeResult { node: Some(node) }))
}
