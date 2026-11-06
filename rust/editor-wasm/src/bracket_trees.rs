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
	2
}

/// Transfers one original result, including null/undefined callback returns, without a host array wrapper.
#[wasm_bindgen]
pub struct WasmBracketTreeResult {
	node: Option<JsValue>,
}

impl WasmBracketTreeResult {
	pub(crate) fn new(node: JsValue) -> Self {
		Self { node: Some(node) }
	}
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

#[wasm_bindgen]
extern "C" {
	pub type TreeHost;
	#[wasm_bindgen(method, catch, js_name = isEnd)]
	fn is_end(this: &TreeHost, index: f64) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = heightAt)]
	fn height_at(this: &TreeHost, index: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = matchesHeight)]
	fn matches_height(this: &TreeHost, index: f64, height: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch)]
	fn item(this: &TreeHost, index: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch)]
	fn group(this: &TreeHost, start: f64, end: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch)]
	fn truthy(this: &TreeHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = preferFirst)]
	fn prefer_first(
		this: &TreeHost,
		first: &JsValue,
		second: &JsValue,
		next: &JsValue,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = compareHeight)]
	fn compare_height(
		this: &TreeHost,
		first: &JsValue,
		second: &JsValue,
		greater: bool,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = createPair)]
	fn create_pair(this: &TreeHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = toMutable)]
	fn to_mutable(this: &TreeHost, node: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = createParents)]
	fn create_parents(this: &TreeHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = pushParent)]
	fn push_parent(this: &TreeHost, parents: &JsValue, node: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = parentsLastIndex)]
	fn parents_last_index(this: &TreeHost, parents: &JsValue) -> Result<f64, JsValue>;
	#[wasm_bindgen(method, catch, js_name = parentAt)]
	fn parent_at(this: &TreeHost, parents: &JsValue, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = isList)]
	fn is_list(this: &TreeHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = edgeMutable)]
	fn edge_mutable(this: &TreeHost, node: &JsValue, append: bool) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = fullChildren)]
	fn full_children(this: &TreeHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = splitChild)]
	fn split_child(
		this: &TreeHost,
		parent: &JsValue,
		carried: &JsValue,
		append: bool,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = addChild)]
	fn add_child(
		this: &TreeHost,
		parent: &JsValue,
		carried: &JsValue,
		append: bool,
	) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = childrenChanged)]
	fn children_changed(this: &TreeHost, parent: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = unexpectedError)]
	fn unexpected_error(this: &TreeHost) -> Result<JsValue, JsValue>;
}

struct Host(TreeHost);

impl vscode_editor_core::BracketTreeHost for Host {
	type Node = JsValue;
	type Height = JsValue;
	type Parents = JsValue;
	type Error = JsValue;

	fn null_node(&self) -> JsValue {
		JsValue::NULL
	}
	fn is_end(&self, index: f64) -> Result<bool, JsValue> {
		self.0.is_end(index)
	}
	fn height_at(&self, index: f64) -> Result<JsValue, JsValue> {
		self.0.height_at(index)
	}
	fn matches_height(&self, index: f64, height: &JsValue) -> Result<bool, JsValue> {
		self.0.matches_height(index, height)
	}
	fn item(&self, index: f64) -> Result<JsValue, JsValue> {
		self.0.item(index)
	}
	fn group(&self, start: f64, end: f64) -> Result<JsValue, JsValue> {
		self.0.group(start, end)
	}
	fn truthy(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.truthy(node)
	}
	fn prefer_first(
		&self,
		first: &JsValue,
		second: &JsValue,
		next: &JsValue,
	) -> Result<bool, JsValue> {
		self.0.prefer_first(first, second, next)
	}
	fn compare_height(
		&self,
		first: &JsValue,
		second: &JsValue,
		greater: bool,
	) -> Result<bool, JsValue> {
		self.0.compare_height(first, second, greater)
	}
	fn create_pair(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		self.0.create_pair(first, second)
	}
	fn to_mutable(&self, node: &JsValue) -> Result<JsValue, JsValue> {
		self.0.to_mutable(node)
	}
	fn create_parents(&self) -> Result<JsValue, JsValue> {
		self.0.create_parents()
	}
	fn push_parent(&self, parents: &JsValue, node: &JsValue) -> Result<(), JsValue> {
		self.0.push_parent(parents, node)
	}
	fn parents_last_index(&self, parents: &JsValue) -> Result<i64, JsValue> {
		self.0.parents_last_index(parents).map(|index| index as i64)
	}
	fn parent_at(&self, parents: &JsValue, index: usize) -> Result<JsValue, JsValue> {
		self.0.parent_at(parents, index as u32)
	}
	fn is_list(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.is_list(node)
	}
	fn edge_mutable(&self, node: &JsValue, append: bool) -> Result<JsValue, JsValue> {
		self.0.edge_mutable(node, append)
	}
	fn full_children(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.full_children(node)
	}
	fn split_child(
		&self,
		parent: &JsValue,
		carried: &JsValue,
		append: bool,
	) -> Result<JsValue, JsValue> {
		self.0.split_child(parent, carried, append)
	}
	fn add_child(&self, parent: &JsValue, carried: &JsValue, append: bool) -> Result<(), JsValue> {
		self.0.add_child(parent, carried, append)
	}
	fn children_changed(&self, parent: &JsValue) -> Result<(), JsValue> {
		self.0.children_changed(parent)
	}
	fn unexpected(&self) -> JsValue {
		self.0.unexpected_error().unwrap_or_else(|error| error)
	}
}

/// Concatenates height runs and balances both edges through the original caught AST capabilities.
#[wasm_bindgen]
pub fn concat_bracket_trees(host: TreeHost) -> Result<WasmBracketTreeResult, JsValue> {
	let node = vscode_editor_core::concat_bracket_trees(&Host(host))?;
	Ok(WasmBracketTreeResult { node: Some(node) })
}
