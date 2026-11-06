/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Pair range collection retains live providers, callback values, and iterable completion.

use crate::bracket_trees::WasmBracketTreeResult;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type PairCollectionHost;
	#[wasm_bindgen(method, catch, js_name = truthy)]
	fn truthy(this: &PairCollectionHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = isPair)]
	fn is_pair(this: &PairCollectionHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = hasLevels)]
	fn has_levels(this: &PairCollectionHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = getLevel)]
	fn get_level(this: &PairCollectionHost, node: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = isUndefined)]
	fn is_undefined(this: &PairCollectionHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = increment)]
	fn increment(this: &PairCollectionHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = setLevel)]
	fn set_level(this: &PairCollectionHost, node: &JsValue, value: &JsValue)
	-> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = restoreLevel)]
	fn restore_level(
		this: &PairCollectionHost,
		node: &JsValue,
		value: &JsValue,
	) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = openingEnd)]
	fn opening_end(
		this: &PairCollectionHost,
		node: &JsValue,
		start: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = includeIndentation)]
	fn include_indentation(this: &PairCollectionHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = indentation)]
	fn indentation(
		this: &PairCollectionHost,
		node: &JsValue,
		start: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = hasChild)]
	fn has_child(this: &PairCollectionHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = child)]
	fn child(this: &PairCollectionHost, node: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = end)]
	fn end(this: &PairCollectionHost, start: &JsValue, child: &JsValue)
	-> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = inPairRange)]
	fn in_pair_range(
		this: &PairCollectionHost,
		start: &JsValue,
		end: &JsValue,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = inListRange)]
	fn in_list_range(
		this: &PairCollectionHost,
		start: &JsValue,
		end: &JsValue,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = collect)]
	fn collect(
		this: &PairCollectionHost,
		node: &JsValue,
		start: &JsValue,
		end: &JsValue,
		level: f64,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = iterator)]
	fn iterator(this: &PairCollectionHost, node: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = next)]
	fn next(this: &PairCollectionHost, iterator: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = done)]
	fn done(this: &PairCollectionHost, step: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = stepValue)]
	fn step_value(this: &PairCollectionHost, step: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = close)]
	fn close(this: &PairCollectionHost, iterator: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = emitPair)]
	fn emit_pair(
		this: &PairCollectionHost,
		node: &JsValue,
		start: &JsValue,
		end: &JsValue,
		opening: &JsValue,
		level: f64,
		equal: &JsValue,
		indentation: &JsValue,
	) -> Result<JsValue, JsValue>;
}

struct Host(PairCollectionHost);

impl vscode_editor_core::BracketPairCollectionHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn boolean(&self, value: bool) -> JsValue {
		JsValue::from_bool(value)
	}
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn truthy(&self, value: &JsValue) -> Result<bool, JsValue> {
		self.0.truthy(value)
	}
	fn is_pair(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.is_pair(node)
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
	fn set_level(&self, node: &JsValue, value: &JsValue) -> Result<(), JsValue> {
		self.0.set_level(node, value)
	}
	fn restore_level(&self, node: &JsValue, value: &JsValue) -> Result<(), JsValue> {
		self.0.restore_level(node, value)
	}
	fn opening_end(&self, node: &JsValue, start: &JsValue) -> Result<JsValue, JsValue> {
		self.0.opening_end(node, start)
	}
	fn include_indentation(&self) -> Result<bool, JsValue> {
		self.0.include_indentation()
	}
	fn indentation(&self, node: &JsValue, start: &JsValue) -> Result<JsValue, JsValue> {
		self.0.indentation(node, start)
	}
	fn has_child(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.has_child(node)
	}
	fn child(&self, node: &JsValue) -> Result<JsValue, JsValue> {
		self.0.child(node)
	}
	fn end(&self, start: &JsValue, child: &JsValue) -> Result<JsValue, JsValue> {
		self.0.end(start, child)
	}
	fn in_pair_range(&self, start: &JsValue, end: &JsValue) -> Result<bool, JsValue> {
		self.0.in_pair_range(start, end)
	}
	fn in_list_range(&self, start: &JsValue, end: &JsValue) -> Result<bool, JsValue> {
		self.0.in_list_range(start, end)
	}
	fn collect(
		&self,
		node: &JsValue,
		start: &JsValue,
		end: &JsValue,
		level: f64,
	) -> Result<JsValue, JsValue> {
		self.0.collect(node, start, end, level)
	}
	fn iterator(&self, node: &JsValue) -> Result<JsValue, JsValue> {
		self.0.iterator(node)
	}
	fn next(&self, iterator: &JsValue) -> Result<JsValue, JsValue> {
		self.0.next(iterator)
	}
	fn done(&self, step: &JsValue) -> Result<bool, JsValue> {
		self.0.done(step)
	}
	fn step_value(&self, step: &JsValue) -> Result<JsValue, JsValue> {
		self.0.step_value(step)
	}
	fn close(&self, iterator: &JsValue) -> Result<(), JsValue> {
		self.0.close(iterator)
	}
	fn emit_pair(
		&self,
		node: &JsValue,
		offsets: [&JsValue; 3],
		level: f64,
		equal: &JsValue,
		indentation: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0.emit_pair(
			node,
			offsets[0],
			offsets[1],
			offsets[2],
			level,
			equal,
			indentation,
		)
	}
}

/// Versions bracket pair traversal independently of colorized ranges.
#[wasm_bindgen]
pub fn bracket_pair_collection_abi_version() -> u32 {
	1
}

/// Collects the complete pair range with original indentation and callback completion.
#[wasm_bindgen]
pub fn collect_bracket_pairs(
	host: PairCollectionHost,
	node: JsValue,
	start: JsValue,
	end: JsValue,
	level: f64,
) -> Result<WasmBracketTreeResult, JsValue> {
	Ok(WasmBracketTreeResult::new(
		vscode_editor_core::collect_bracket_pairs(&Host(host), &node, &start, &end, level)?,
	))
}
