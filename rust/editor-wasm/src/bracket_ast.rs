/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! AST operations retain original factories, method dispatch, and partial metadata writes.

use crate::bracket_trees::WasmBracketTreeResult;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type ChildHost;
	#[wasm_bindgen(method, catch, js_name = item)]
	fn child_item(this: &ChildHost, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = isIndex)]
	fn is_index(this: &ChildHost, index: u32) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = invalidIndex)]
	fn invalid_index(this: &ChildHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = setItem)]
	fn set_item(this: &ChildHost, index: u32) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = createArray)]
	fn create_array(this: &ChildHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = pushItem)]
	fn push_item(this: &ChildHost, array: &JsValue, index: u32) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = array2)]
	fn array2(this: &ChildHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = array3)]
	fn array3(
		this: &ChildHost,
		first: &JsValue,
		second: &JsValue,
		third: &JsValue,
	) -> Result<JsValue, JsValue>;
}

struct ChildAccessHost(ChildHost);

impl vscode_editor_core::BracketChildHost for ChildAccessHost {
	type Value = JsValue;
	type Error = JsValue;
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn undefined(&self) -> JsValue {
		JsValue::UNDEFINED
	}
	fn item(&self, index: u32) -> Result<JsValue, JsValue> {
		self.0.child_item(index)
	}
	fn is_null(&self, value: &JsValue) -> bool {
		value.is_null()
	}
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn is_index(&self, index: u32) -> Result<bool, JsValue> {
		self.0.is_index(index)
	}
	fn invalid_index(&self) -> Result<JsValue, JsValue> {
		self.0.invalid_index()
	}
	fn set_item(&self, index: u32) -> Result<(), JsValue> {
		self.0.set_item(index)
	}
	fn create_array(&self) -> Result<JsValue, JsValue> {
		self.0.create_array()
	}
	fn push_item(&self, array: &JsValue, index: u32) -> Result<(), JsValue> {
		self.0.push_item(array, index)
	}
	fn array2(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		self.0.array2(first, second)
	}
	fn array3(
		&self,
		first: &JsValue,
		second: &JsValue,
		third: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0.array3(first, second, third)
	}
}

/// Runs strict child-slot and children-array control using the original property capabilities.
#[wasm_bindgen]
pub fn run_bracket_child_access(
	host: ChildHost,
	operation: u32,
) -> Result<WasmBracketTreeResult, JsValue> {
	if operation > 4 {
		return Err(JsValue::from_str("Invalid Rust bracket child operation"));
	}
	Ok(WasmBracketTreeResult::new(
		vscode_editor_core::access_bracket_child(&ChildAccessHost(host), operation)?,
	))
}

#[wasm_bindgen]
extern "C" {
	pub type AstHost;
	#[wasm_bindgen(method, catch, js_name = receiver)]
	fn receiver(this: &AstHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = item)]
	fn item(this: &AstHost, index: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = truthy)]
	fn truthy(this: &AstHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = length)]
	fn length(this: &AstHost, node: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = missing)]
	fn missing(this: &AstHost, node: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = emptyIds)]
	fn empty_ids(this: &AstHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = addLength)]
	fn add_length(this: &AstHost, length: &JsValue, node: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = mergeIds)]
	fn merge_ids(this: &AstHost, ids: &JsValue, node: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = mergeItem)]
	fn merge_item(this: &AstHost, ids: &JsValue, index: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = equalHeights)]
	fn equal_heights(this: &AstHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = invalidHeights)]
	fn invalid_heights(this: &AstHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = createPair)]
	fn create_pair(this: &AstHost, length: &JsValue, ids: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = createList)]
	fn create_list(
		this: &AstHost,
		length: &JsValue,
		ids: &JsValue,
		compact: bool,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = itemCount)]
	fn item_count(this: &AstHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = isZero)]
	fn is_zero(this: &AstHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = indexBefore)]
	fn index_before(this: &AstHost, index: f64, count: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = emptyList)]
	fn empty_list(this: &AstHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = throwIfImmutable)]
	fn throw_if_immutable(this: &AstHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = childCount)]
	fn child_count(this: &AstHost, node: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = child)]
	fn child(this: &AstHost, node: &JsValue, index: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = setLength)]
	fn set_length(this: &AstHost, value: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = setMissing)]
	fn set_missing(this: &AstHost, value: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = resetIndentation)]
	fn reset_indentation(this: &AstHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = closingMissing)]
	fn closing_missing(this: &AstHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = intersectsNode)]
	fn intersects_node(this: &AstHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = isList)]
	fn is_list(this: &AstHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = invalidEmptyChild)]
	fn invalid_empty_child(this: &AstHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = edgeChild)]
	fn edge_child(
		this: &AstHost,
		node: &JsValue,
		count: &JsValue,
		last: bool,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = reuseLeaf)]
	fn reuse_leaf(this: &AstHost, node: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = toMutable)]
	fn to_mutable(this: &AstHost, node: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = same)]
	fn same(this: &AstHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = setEdge)]
	fn set_edge(
		this: &AstHost,
		count: &JsValue,
		child: &JsValue,
		last: bool,
	) -> Result<(), JsValue>;
}

struct Host(AstHost);

impl vscode_editor_core::BracketAstHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn boolean(&self, value: bool) -> JsValue {
		JsValue::from_bool(value)
	}
	fn undefined(&self) -> JsValue {
		JsValue::UNDEFINED
	}
	fn receiver(&self) -> Result<JsValue, JsValue> {
		self.0.receiver()
	}
	fn item(&self, index: f64) -> Result<JsValue, JsValue> {
		self.0.item(index)
	}
	fn truthy(&self, value: &JsValue) -> Result<bool, JsValue> {
		self.0.truthy(value)
	}
	fn length(&self, node: &JsValue) -> Result<JsValue, JsValue> {
		self.0.length(node)
	}
	fn missing(&self, node: &JsValue) -> Result<JsValue, JsValue> {
		self.0.missing(node)
	}
	fn empty_ids(&self) -> Result<JsValue, JsValue> {
		self.0.empty_ids()
	}
	fn add_length(&self, length: &JsValue, node: &JsValue) -> Result<JsValue, JsValue> {
		self.0.add_length(length, node)
	}
	fn merge_ids(&self, ids: &JsValue, node: &JsValue) -> Result<JsValue, JsValue> {
		self.0.merge_ids(ids, node)
	}
	fn merge_item(&self, ids: &JsValue, index: f64) -> Result<JsValue, JsValue> {
		self.0.merge_item(ids, index)
	}
	fn equal_heights(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		self.0.equal_heights(first, second)
	}
	fn invalid_heights(&self) -> Result<(), JsValue> {
		self.0.invalid_heights()
	}
	fn create_pair(&self, length: &JsValue, ids: &JsValue) -> Result<JsValue, JsValue> {
		self.0.create_pair(length, ids)
	}
	fn create_list(
		&self,
		length: &JsValue,
		ids: &JsValue,
		compact: bool,
	) -> Result<JsValue, JsValue> {
		self.0.create_list(length, ids, compact)
	}
	fn item_count(&self) -> Result<JsValue, JsValue> {
		self.0.item_count()
	}
	fn is_zero(&self, value: &JsValue) -> Result<bool, JsValue> {
		self.0.is_zero(value)
	}
	fn index_before(&self, index: f64, count: &JsValue) -> Result<bool, JsValue> {
		self.0.index_before(index, count)
	}
	fn empty_list(&self) -> Result<JsValue, JsValue> {
		self.0.empty_list()
	}
	fn throw_if_immutable(&self) -> Result<(), JsValue> {
		self.0.throw_if_immutable()
	}
	fn child_count(&self, node: &JsValue) -> Result<JsValue, JsValue> {
		self.0.child_count(node)
	}
	fn child(&self, node: &JsValue, index: f64) -> Result<JsValue, JsValue> {
		self.0.child(node, index)
	}
	fn set_length(&self, value: &JsValue) -> Result<(), JsValue> {
		self.0.set_length(value)
	}
	fn set_missing(&self, value: &JsValue) -> Result<(), JsValue> {
		self.0.set_missing(value)
	}
	fn reset_indentation(&self) -> Result<(), JsValue> {
		self.0.reset_indentation()
	}
	fn closing_missing(&self) -> Result<bool, JsValue> {
		self.0.closing_missing()
	}
	fn intersects_node(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.intersects_node(node)
	}
	fn is_list(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.is_list(node)
	}
	fn invalid_empty_child(&self) -> Result<(), JsValue> {
		self.0.invalid_empty_child()
	}
	fn edge_child(&self, node: &JsValue, count: &JsValue, last: bool) -> Result<JsValue, JsValue> {
		self.0.edge_child(node, count, last)
	}
	fn reuse_leaf(&self, node: &JsValue) -> Result<JsValue, JsValue> {
		self.0.reuse_leaf(node)
	}
	fn to_mutable(&self, node: &JsValue) -> Result<JsValue, JsValue> {
		self.0.to_mutable(node)
	}
	fn same(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		self.0.same(first, second)
	}
	fn set_edge(&self, count: &JsValue, child: &JsValue, last: bool) -> Result<(), JsValue> {
		self.0.set_edge(count, child, last)
	}
}

/// Versions AST construction, metadata, reuse, and mutable-edge control independently of ownership.
#[wasm_bindgen]
pub fn bracket_ast_abi_version() -> u32 {
	2
}

/// Executes one complete original AST operation and scopes its actual result reference.
#[wasm_bindgen]
pub fn run_bracket_ast(host: AstHost, operation: u32) -> Result<WasmBracketTreeResult, JsValue> {
	let host = Host(host);
	let value = match operation {
		0 => vscode_editor_core::create_bracket_pair(&host)?,
		1 => vscode_editor_core::create_bracket_list(&host, true)?,
		2 => vscode_editor_core::create_bracket_list(&host, false)?,
		3 => {
			vscode_editor_core::update_bracket_children(&host)?;
			JsValue::UNDEFINED
		}
		4 => vscode_editor_core::reuse_bracket_node(&host, 2)?,
		5 => vscode_editor_core::reuse_bracket_node(&host, 4)?,
		6 => vscode_editor_core::reuse_bracket_node(&host, 3)?,
		7 => vscode_editor_core::reuse_bracket_node(&host, 0)?,
		8 => vscode_editor_core::reuse_bracket_node(&host, 1)?,
		9 => vscode_editor_core::make_bracket_edge_mutable(&host, true)?,
		10 => vscode_editor_core::make_bracket_edge_mutable(&host, false)?,
		_ => return Err(JsValue::from_str("Invalid Rust bracket AST operation")),
	};
	Ok(WasmBracketTreeResult::new(value))
}
