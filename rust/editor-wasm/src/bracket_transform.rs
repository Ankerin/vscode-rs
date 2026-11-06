/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! AST transforms retain original clone/factory/iterator capabilities and scoped references.

use crate::bracket_trees::WasmBracketTreeResult;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type TransformHost;
	#[wasm_bindgen(method, catch, js_name = receiver)]
	fn receiver(this: &TransformHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = length)]
	fn length(this: &TransformHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = height)]
	fn height(this: &TransformHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = missing)]
	fn missing(this: &TransformHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = pairFactory)]
	fn pair_factory(this: &TransformHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = pairOpening)]
	fn pair_opening(this: &TransformHost, clone: bool) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = pairChild)]
	fn pair_child(this: &TransformHost, clone: bool) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = pairClosing)]
	fn pair_closing(this: &TransformHost, clone: bool) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = compactItem)]
	fn compact_item(this: &TransformHost, index: u32, clone: bool) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = cloneArray)]
	fn clone_array(this: &TransformHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = indexBeforeCount)]
	fn index_before_count(this: &TransformHost, index: f64) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = cloneInto)]
	fn clone_into(this: &TransformHost, output: &JsValue, index: f64) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = spreadChildren)]
	fn spread_children(this: &TransformHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = emptyItems)]
	fn empty_items(this: &TransformHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = iterator)]
	fn iterator(this: &TransformHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = next)]
	fn next(this: &TransformHost, iterator: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = done)]
	fn done(this: &TransformHost, step: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = stepValue)]
	fn step_value(this: &TransformHost, step: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = close)]
	fn close(this: &TransformHost, iterator: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = flattenChild)]
	fn flatten_child(this: &TransformHost, child: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = isList)]
	fn is_list(this: &TransformHost, child: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = pushFlattened)]
	fn push_flattened(
		this: &TransformHost,
		items: &JsValue,
		child: &JsValue,
		expand: bool,
	) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = createFlattened)]
	fn create_flattened(this: &TransformHost, items: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = createPair)]
	fn create_pair(
		this: &TransformHost,
		factory: &JsValue,
		opening: &JsValue,
		child: &JsValue,
		closing: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = clonePair)]
	fn clone_pair(
		this: &TransformHost,
		length: &JsValue,
		opening: &JsValue,
		child: &JsValue,
		closing: &JsValue,
		missing: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = createCompact)]
	fn create_compact(
		this: &TransformHost,
		length: &JsValue,
		height: &JsValue,
		first: &JsValue,
		second: &JsValue,
		third: &JsValue,
		missing: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = createArray)]
	fn create_array(
		this: &TransformHost,
		length: &JsValue,
		height: &JsValue,
		children: &JsValue,
		missing: &JsValue,
	) -> Result<JsValue, JsValue>;
}

struct Host(TransformHost);
impl vscode_editor_core::BracketTransformHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn receiver(&self) -> Result<JsValue, JsValue> {
		self.0.receiver()
	}
	fn length(&self) -> Result<JsValue, JsValue> {
		self.0.length()
	}
	fn height(&self) -> Result<JsValue, JsValue> {
		self.0.height()
	}
	fn missing(&self) -> Result<JsValue, JsValue> {
		self.0.missing()
	}
	fn pair_factory(&self) -> Result<JsValue, JsValue> {
		self.0.pair_factory()
	}
	fn pair_opening(&self, clone: bool) -> Result<JsValue, JsValue> {
		self.0.pair_opening(clone)
	}
	fn pair_child(&self, clone: bool) -> Result<JsValue, JsValue> {
		self.0.pair_child(clone)
	}
	fn pair_closing(&self, clone: bool) -> Result<JsValue, JsValue> {
		self.0.pair_closing(clone)
	}
	fn compact_item(&self, index: u32, clone: bool) -> Result<JsValue, JsValue> {
		self.0.compact_item(index, clone)
	}
	fn clone_array(&self) -> Result<JsValue, JsValue> {
		self.0.clone_array()
	}
	fn index_before_count(&self, index: f64) -> Result<bool, JsValue> {
		self.0.index_before_count(index)
	}
	fn clone_into(&self, output: &JsValue, index: f64) -> Result<(), JsValue> {
		self.0.clone_into(output, index)
	}
	fn spread_children(&self) -> Result<JsValue, JsValue> {
		self.0.spread_children()
	}
	fn empty_items(&self) -> Result<JsValue, JsValue> {
		self.0.empty_items()
	}
	fn iterator(&self) -> Result<JsValue, JsValue> {
		self.0.iterator()
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
	fn flatten_child(&self, child: &JsValue) -> Result<JsValue, JsValue> {
		self.0.flatten_child(child)
	}
	fn is_list(&self, child: &JsValue) -> Result<bool, JsValue> {
		self.0.is_list(child)
	}
	fn push_flattened(
		&self,
		items: &JsValue,
		child: &JsValue,
		expand: bool,
	) -> Result<(), JsValue> {
		self.0.push_flattened(items, child, expand)
	}
	fn create_flattened(&self, items: &JsValue) -> Result<JsValue, JsValue> {
		self.0.create_flattened(items)
	}
	fn create_pair(&self, factory: &JsValue, children: [&JsValue; 3]) -> Result<JsValue, JsValue> {
		self.0
			.create_pair(factory, children[0], children[1], children[2])
	}
	fn clone_pair(
		&self,
		length: &JsValue,
		children: [&JsValue; 3],
		missing: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0
			.clone_pair(length, children[0], children[1], children[2], missing)
	}
	fn create_compact(
		&self,
		metadata: [&JsValue; 3],
		children: [&JsValue; 3],
	) -> Result<JsValue, JsValue> {
		self.0.create_compact(
			metadata[0],
			metadata[1],
			children[0],
			children[1],
			children[2],
			metadata[2],
		)
	}
	fn create_array(
		&self,
		metadata: [&JsValue; 3],
		children: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0
			.create_array(metadata[0], metadata[1], children, metadata[2])
	}
}

/// Versions AST cloning, flattening, and shallow mutable construction independently of ownership.
#[wasm_bindgen]
pub fn bracket_transform_abi_version() -> u32 {
	1
}

/// Executes one original transform and scopes its actual node/factory result.
#[wasm_bindgen]
pub fn transform_bracket_ast(
	host: TransformHost,
	operation: u32,
) -> Result<WasmBracketTreeResult, JsValue> {
	use vscode_editor_core::BracketTransformHost;
	let host = Host(host);
	let value = match operation {
		0 => vscode_editor_core::transform_bracket_pair(&host, false)?,
		1 => vscode_editor_core::transform_bracket_pair(&host, true)?,
		2 => vscode_editor_core::transform_compact_bracket_list(&host, true)?,
		3 => vscode_editor_core::transform_array_bracket_list(&host, true)?,
		4 => vscode_editor_core::flatten_bracket_list(&host)?,
		5 => vscode_editor_core::transform_compact_bracket_list(&host, false)?,
		6 => vscode_editor_core::transform_array_bracket_list(&host, false)?,
		7 => host.receiver()?,
		_ => {
			return Err(JsValue::from_str(
				"Invalid Rust bracket transform operation",
			));
		}
	};
	Ok(WasmBracketTreeResult::new(value))
}
