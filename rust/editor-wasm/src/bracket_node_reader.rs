/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket cache traversal uses caught host capabilities and scoped result references.

use crate::bracket_trees::WasmBracketTreeResult;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type ReaderHost;
	#[wasm_bindgen(method, catch, js_name = currentNode)]
	fn current_node(this: &ReaderHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = currentOffset)]
	fn current_offset(this: &ReaderHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch)]
	fn truthy(this: &ReaderHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = offsetBefore)]
	fn offset_before(this: &ReaderHost, first: &JsValue, second: &JsValue)
	-> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = endBefore)]
	fn end_before(
		this: &ReaderHost,
		node: &JsValue,
		current: &JsValue,
		requested: &JsValue,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch)]
	fn predicate(this: &ReaderHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch)]
	fn advance(this: &ReaderHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = incrementIndex)]
	fn increment_index(this: &ReaderHost, index: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = indexAtEnd)]
	fn index_at_end(this: &ReaderHost, node: &JsValue, index: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = childExists)]
	fn child_exists(this: &ReaderHost, node: &JsValue, index: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = missingIndex)]
	fn missing_index(this: &ReaderHost, index: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch)]
	fn descend(
		this: &ReaderHost,
		node: &JsValue,
		offset: &JsValue,
		index: &JsValue,
	) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = popCurrent)]
	fn pop_current(this: &ReaderHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = noParents)]
	fn no_parents(this: &ReaderHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = lastChildIndex)]
	fn last_child_index(this: &ReaderHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = moveToChild)]
	fn move_to_child(
		this: &ReaderHost,
		parent: &JsValue,
		current: &JsValue,
		offset: &JsValue,
		index: &JsValue,
	) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = popParent)]
	fn pop_parent(this: &ReaderHost) -> Result<(), JsValue>;
}

struct Host(ReaderHost);

impl vscode_editor_core::BracketNodeReaderHost for Host {
	type Node = JsValue;
	type Offset = JsValue;
	type Index = JsValue;
	type Error = JsValue;

	fn undefined_node(&self) -> JsValue {
		JsValue::UNDEFINED
	}
	fn first_index(&self) -> JsValue {
		JsValue::from_f64(-1.0)
	}
	fn current_node(&self) -> Result<JsValue, JsValue> {
		self.0.current_node()
	}
	fn current_offset(&self) -> Result<JsValue, JsValue> {
		self.0.current_offset()
	}
	fn truthy(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.truthy(node)
	}
	fn offset_before(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		self.0.offset_before(first, second)
	}
	fn end_before(
		&self,
		node: &JsValue,
		current: &JsValue,
		requested: &JsValue,
	) -> Result<bool, JsValue> {
		self.0.end_before(node, current, requested)
	}
	fn predicate(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.predicate(node)
	}
	fn advance(&self) -> Result<(), JsValue> {
		self.0.advance()
	}
	fn increment_index(&self, index: &JsValue) -> Result<JsValue, JsValue> {
		self.0.increment_index(index)
	}
	fn index_at_end(&self, node: &JsValue, index: &JsValue) -> Result<bool, JsValue> {
		self.0.index_at_end(node, index)
	}
	fn child_exists(&self, node: &JsValue, index: &JsValue) -> Result<bool, JsValue> {
		self.0.child_exists(node, index)
	}
	fn missing_index(&self, index: &JsValue) -> Result<bool, JsValue> {
		self.0.missing_index(index)
	}
	fn descend(&self, node: &JsValue, offset: &JsValue, index: &JsValue) -> Result<(), JsValue> {
		self.0.descend(node, offset, index)
	}
	fn pop_current(&self) -> Result<(), JsValue> {
		self.0.pop_current()
	}
	fn no_parents(&self) -> Result<bool, JsValue> {
		self.0.no_parents()
	}
	fn last_child_index(&self) -> Result<JsValue, JsValue> {
		self.0.last_child_index()
	}
	fn move_to_child(
		&self,
		parent: &JsValue,
		current: &JsValue,
		offset: &JsValue,
		index: &JsValue,
	) -> Result<(), JsValue> {
		self.0.move_to_child(parent, current, offset, index)
	}
	fn pop_parent(&self) -> Result<(), JsValue> {
		self.0.pop_parent()
	}
}

/// Versions longest-node lookup and live stack advancement independently of AST construction.
#[wasm_bindgen]
pub fn bracket_node_reader_abi_version() -> u32 {
	1
}

/// Executes longest-node lookup while retaining the original predicate, mutation, and result identities.
#[wasm_bindgen]
pub fn read_longest_bracket_node(
	host: ReaderHost,
	offset: JsValue,
) -> Result<WasmBracketTreeResult, JsValue> {
	let node = vscode_editor_core::read_longest_bracket_node(&Host(host), &offset)?;
	Ok(WasmBracketTreeResult::new(node))
}

/// Advances the original reader stacks without retaining native reader state or replaying failed operations.
#[wasm_bindgen]
pub fn advance_bracket_node(host: ReaderHost) -> Result<bool, JsValue> {
	vscode_editor_core::advance_bracket_node(&Host(host))?;
	Ok(true)
}
