/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket searches preserve original AST, array, and iterable observations.

use crate::bracket_trees::WasmBracketTreeResult;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type SearchHost;
	#[wasm_bindgen(method, catch, js_name = truthy)]
	fn truthy(this: &SearchHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = container)]
	fn container(this: &SearchHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = unexpected)]
	fn unexpected(this: &SearchHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = bracket)]
	fn bracket(this: &SearchHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = found)]
	fn found(
		this: &SearchHost,
		node: &JsValue,
		start: &JsValue,
		end: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = iterator)]
	fn iterator(this: &SearchHost, node: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = next)]
	fn next(this: &SearchHost, iterator: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = done)]
	fn done(this: &SearchHost, step: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = stepValue)]
	fn step_value(this: &SearchHost, step: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = close)]
	fn close(this: &SearchHost, iterator: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = end)]
	fn end(this: &SearchHost, start: &JsValue, node: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = beforePosition)]
	fn before_position(this: &SearchHost, offset: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = positionBefore)]
	fn position_before(this: &SearchHost, offset: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = find)]
	fn find(
		this: &SearchHost,
		node: &JsValue,
		start: &JsValue,
		end: &JsValue,
		before: bool,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = lengths)]
	fn lengths(this: &SearchHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = pushLength)]
	fn push_length(
		this: &SearchHost,
		lengths: &JsValue,
		start: &JsValue,
		end: &JsValue,
	) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = lastIndex)]
	fn last_index(this: &SearchHost, lengths: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = validIndex)]
	fn valid_index(this: &SearchHost, index: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = lengthEntry)]
	fn length_entry(
		this: &SearchHost,
		lengths: &JsValue,
		index: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = entryStart)]
	fn entry_start(this: &SearchHost, entry: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = entryEnd)]
	fn entry_end(this: &SearchHost, entry: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = indexedChild)]
	fn indexed_child(
		this: &SearchHost,
		node: &JsValue,
		index: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = decrement)]
	fn decrement(this: &SearchHost, index: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = openingIds)]
	fn opening_ids(this: &SearchHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = intersects)]
	fn intersects(this: &SearchHost, node: &JsValue, ids: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = stack)]
	fn stack(this: &SearchHost, root: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = hasStack)]
	fn has_stack(this: &SearchHost, stack: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = pop)]
	fn pop(this: &SearchHost, stack: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = entryNode)]
	fn entry_node(this: &SearchHost, entry: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = entryOffset)]
	fn entry_offset(this: &SearchHost, entry: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = afterPosition)]
	fn after_position(this: &SearchHost, offset: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = pushNode)]
	fn push_node(
		this: &SearchHost,
		stack: &JsValue,
		node: &JsValue,
		offset: &JsValue,
	) -> Result<(), JsValue>;
}

struct Host(SearchHost);

impl vscode_editor_core::BracketSearchHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn null(&self) -> JsValue {
		JsValue::NULL
	}
	fn truthy(&self, value: &JsValue) -> Result<bool, JsValue> {
		self.0.truthy(value)
	}
	fn container(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.container(node)
	}
	fn unexpected(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.unexpected(node)
	}
	fn bracket(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.bracket(node)
	}
	fn found(&self, node: &JsValue, start: &JsValue, end: &JsValue) -> Result<JsValue, JsValue> {
		self.0.found(node, start, end)
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
	fn end(&self, start: &JsValue, node: &JsValue) -> Result<JsValue, JsValue> {
		self.0.end(start, node)
	}
	fn before_position(&self, offset: &JsValue) -> Result<bool, JsValue> {
		self.0.before_position(offset)
	}
	fn position_before(&self, offset: &JsValue) -> Result<bool, JsValue> {
		self.0.position_before(offset)
	}
	fn find(
		&self,
		node: &JsValue,
		start: &JsValue,
		end: &JsValue,
		before: bool,
	) -> Result<JsValue, JsValue> {
		self.0.find(node, start, end, before)
	}
	fn lengths(&self) -> Result<JsValue, JsValue> {
		self.0.lengths()
	}
	fn push_length(
		&self,
		lengths: &JsValue,
		start: &JsValue,
		end: &JsValue,
	) -> Result<(), JsValue> {
		self.0.push_length(lengths, start, end)
	}
	fn last_index(&self, lengths: &JsValue) -> Result<JsValue, JsValue> {
		self.0.last_index(lengths)
	}
	fn valid_index(&self, index: &JsValue) -> Result<bool, JsValue> {
		self.0.valid_index(index)
	}
	fn length_entry(&self, lengths: &JsValue, index: &JsValue) -> Result<JsValue, JsValue> {
		self.0.length_entry(lengths, index)
	}
	fn entry_start(&self, entry: &JsValue) -> Result<JsValue, JsValue> {
		self.0.entry_start(entry)
	}
	fn entry_end(&self, entry: &JsValue) -> Result<JsValue, JsValue> {
		self.0.entry_end(entry)
	}
	fn indexed_child(&self, node: &JsValue, index: &JsValue) -> Result<JsValue, JsValue> {
		self.0.indexed_child(node, index)
	}
	fn decrement(&self, index: &JsValue) -> Result<JsValue, JsValue> {
		self.0.decrement(index)
	}
	fn opening_ids(&self) -> Result<JsValue, JsValue> {
		self.0.opening_ids()
	}
	fn intersects(&self, node: &JsValue, ids: &JsValue) -> Result<bool, JsValue> {
		self.0.intersects(node, ids)
	}
	fn stack(&self, root: &JsValue) -> Result<JsValue, JsValue> {
		self.0.stack(root)
	}
	fn has_stack(&self, stack: &JsValue) -> Result<bool, JsValue> {
		self.0.has_stack(stack)
	}
	fn pop(&self, stack: &JsValue) -> Result<JsValue, JsValue> {
		self.0.pop(stack)
	}
	fn entry_node(&self, entry: &JsValue) -> Result<JsValue, JsValue> {
		self.0.entry_node(entry)
	}
	fn entry_offset(&self, entry: &JsValue) -> Result<JsValue, JsValue> {
		self.0.entry_offset(entry)
	}
	fn after_position(&self, offset: &JsValue) -> Result<bool, JsValue> {
		self.0.after_position(offset)
	}
	fn push_node(&self, stack: &JsValue, node: &JsValue, offset: &JsValue) -> Result<(), JsValue> {
		self.0.push_node(stack, node, offset)
	}
}

/// Versions nearest and unmatched bracket queries independently of range collection.
#[wasm_bindgen]
pub fn bracket_search_abi_version() -> u32 {
	1
}

/// Finds the nearest ordinary bracket and returns its original information identity.
#[wasm_bindgen]
pub fn find_bracket(
	host: SearchHost,
	node: JsValue,
	start: JsValue,
	end: JsValue,
	before: bool,
) -> Result<WasmBracketTreeResult, JsValue> {
	Ok(WasmBracketTreeResult::new(
		vscode_editor_core::find_bracket(&Host(host), &node, &start, &end, before)?,
	))
}

/// Finds a globally unmatched closer at or after the cursor.
#[wasm_bindgen]
pub fn has_unmatched_bracket(host: SearchHost, root: JsValue) -> Result<bool, JsValue> {
	vscode_editor_core::has_unmatched_bracket(&Host(host), &root)
}
