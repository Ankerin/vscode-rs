/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Range collection retains original AST/map operations and opaque callback return values.

use crate::bracket_trees::WasmBracketTreeResult;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type CollectionHost;
	#[wasm_bindgen(method, catch)]
	fn kind(this: &CollectionHost, node: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = truthy)]
	fn truthy(this: &CollectionHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = childCount)]
	fn child_count(this: &CollectionHost, node: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = indexBefore)]
	fn index_before(this: &CollectionHost, index: f64, count: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = child)]
	fn child(this: &CollectionHost, node: &JsValue, index: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = end)]
	fn end(this: &CollectionHost, start: &JsValue, child: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = inRange)]
	fn in_range(this: &CollectionHost, start: &JsValue, end: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = reachesEnd)]
	fn reaches_end(this: &CollectionHost, end: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = isBracket)]
	fn is_bracket(this: &CollectionHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = colorize)]
	fn colorize(this: &CollectionHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = hasLevels)]
	fn has_levels(this: &CollectionHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = getLevel)]
	fn get_level(this: &CollectionHost, node: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = isUndefined)]
	fn is_undefined(this: &CollectionHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = increment)]
	fn increment(this: &CollectionHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = addOne)]
	fn add_one(this: &CollectionHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = setLevel)]
	fn set_level(this: &CollectionHost, node: &JsValue, value: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = restoreLevel)]
	fn restore_level(this: &CollectionHost, node: &JsValue, value: &JsValue)
	-> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = hasClosing)]
	fn has_closing(this: &CollectionHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = collect)]
	fn collect(
		this: &CollectionHost,
		node: &JsValue,
		start: &JsValue,
		end: &JsValue,
		level: f64,
		equal_level: &JsValue,
		incomplete: bool,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = emitUnexpected)]
	fn emit_unexpected(
		this: &CollectionHost,
		start: &JsValue,
		end: &JsValue,
		level: f64,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = emitBracket)]
	fn emit_bracket(
		this: &CollectionHost,
		start: &JsValue,
		end: &JsValue,
		level: f64,
		equal_level: &JsValue,
		incomplete: bool,
	) -> Result<JsValue, JsValue>;
}

struct Host(CollectionHost);

impl vscode_editor_core::BracketCollectionHost for Host {
	type Value = JsValue;
	type Error = JsValue;

	fn boolean(&self, value: bool) -> JsValue {
		JsValue::from_bool(value)
	}
	fn zero(&self) -> JsValue {
		JsValue::from_f64(0.0)
	}
	fn kind(&self, node: &JsValue) -> Result<Option<u32>, JsValue> {
		Ok(match self.0.kind(node)?.as_f64() {
			Some(0.0) => Some(0),
			Some(1.0) => Some(1),
			Some(2.0) => Some(2),
			Some(3.0) => Some(3),
			Some(4.0) => Some(4),
			_ => None,
		})
	}
	fn truthy(&self, value: &JsValue) -> Result<bool, JsValue> {
		self.0.truthy(value)
	}
	fn child_count(&self, node: &JsValue) -> Result<JsValue, JsValue> {
		self.0.child_count(node)
	}
	fn index_before(&self, index: f64, count: &JsValue) -> Result<bool, JsValue> {
		self.0.index_before(index, count)
	}
	fn child(&self, node: &JsValue, index: f64) -> Result<JsValue, JsValue> {
		self.0.child(node, index)
	}
	fn end(&self, start: &JsValue, child: &JsValue) -> Result<JsValue, JsValue> {
		self.0.end(start, child)
	}
	fn in_range(&self, start: &JsValue, end: &JsValue) -> Result<bool, JsValue> {
		self.0.in_range(start, end)
	}
	fn reaches_end(&self, end: &JsValue) -> Result<bool, JsValue> {
		self.0.reaches_end(end)
	}
	fn is_bracket(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.is_bracket(node)
	}
	fn colorize(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.colorize(node)
	}
	fn has_levels(&self) -> Result<bool, JsValue> {
		self.0.has_levels()
	}
	fn get_level(&self, node: &JsValue) -> Result<JsValue, JsValue> {
		self.0.get_level(node)
	}
	fn is_undefined(&self, value: &JsValue) -> Result<bool, JsValue> {
		self.0.is_undefined(value)
	}
	fn increment(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.increment(value)
	}
	fn add_one(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.add_one(value)
	}
	fn set_level(&self, node: &JsValue, value: &JsValue) -> Result<(), JsValue> {
		self.0.set_level(node, value)
	}
	fn restore_level(&self, node: &JsValue, value: &JsValue) -> Result<(), JsValue> {
		self.0.restore_level(node, value)
	}
	fn has_closing(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.has_closing(node)
	}
	fn collect(
		&self,
		node: &JsValue,
		start: &JsValue,
		end: &JsValue,
		level: f64,
		equal_level: &JsValue,
		incomplete: bool,
	) -> Result<JsValue, JsValue> {
		self.0
			.collect(node, start, end, level, equal_level, incomplete)
	}
	fn emit_unexpected(
		&self,
		start: &JsValue,
		end: &JsValue,
		level: f64,
	) -> Result<JsValue, JsValue> {
		self.0.emit_unexpected(start, end, level)
	}
	fn emit_bracket(
		&self,
		start: &JsValue,
		end: &JsValue,
		level: f64,
		equal_level: &JsValue,
		incomplete: bool,
	) -> Result<JsValue, JsValue> {
		self.0
			.emit_bracket(start, end, level, equal_level, incomplete)
	}
}

/// Versions colorized bracket range traversal independently of parser/tree ownership.
#[wasm_bindgen]
pub fn bracket_collection_abi_version() -> u32 {
	1
}

/// Collects the complete requested range through live AST/map/callback capabilities.
#[wasm_bindgen]
pub fn collect_brackets(
	host: CollectionHost,
	node: JsValue,
	start: JsValue,
	end: JsValue,
	level: f64,
	equal_level: JsValue,
	incomplete: bool,
) -> Result<WasmBracketTreeResult, JsValue> {
	Ok(WasmBracketTreeResult::new(
		vscode_editor_core::collect_brackets(
			&Host(host),
			node,
			start,
			end,
			level,
			equal_level,
			incomplete,
		)?,
	))
}
