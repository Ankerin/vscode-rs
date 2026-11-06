/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket indentation retains node/model callbacks and original cache mutation.

use crate::bracket_trees::WasmBracketTreeResult;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type IndentationHost;
	#[wasm_bindgen(method, catch, js_name = maximum)]
	fn maximum(this: &IndentationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = pairHasChild)]
	fn pair_has_child(this: &IndentationHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = pairCompute)]
	fn pair_compute(this: &IndentationHost, offset: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = cacheUncomputed)]
	fn cache_uncomputed(this: &IndentationHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = cached)]
	fn cached(this: &IndentationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = indexBeforeCount)]
	fn index_before_count(this: &IndentationHost, index: f64) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = child)]
	fn child(this: &IndentationHost, index: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = truthy)]
	fn truthy(this: &IndentationHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = minimumChild)]
	fn minimum_child(
		this: &IndentationHost,
		current: &JsValue,
		child: &JsValue,
		offset: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = end)]
	fn end(this: &IndentationHost, offset: &JsValue, child: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = setCached)]
	fn set_cached(this: &IndentationHost, value: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = startLine)]
	fn start_line(this: &IndentationHost, offset: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = endLine)]
	fn end_line(this: &IndentationHost, offset: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = lineBeforeEnd)]
	fn line_before_end(
		this: &IndentationHost,
		line: &JsValue,
		end: &JsValue,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = firstColumn)]
	fn first_column(this: &IndentationHost, line: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = lineContent)]
	fn line_content(this: &IndentationHost, line: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = isZero)]
	fn is_zero(this: &IndentationHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = visibleColumn)]
	fn visible_column(
		this: &IndentationHost,
		content: &JsValue,
		first: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = minimum)]
	fn minimum(
		this: &IndentationHost,
		first: &JsValue,
		second: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = increment)]
	fn increment(this: &IndentationHost, line: &JsValue) -> Result<JsValue, JsValue>;
}

struct Host(IndentationHost);

impl vscode_editor_core::BracketIndentationHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn maximum(&self) -> Result<JsValue, JsValue> {
		self.0.maximum()
	}
	fn pair_has_child(&self) -> Result<bool, JsValue> {
		self.0.pair_has_child()
	}
	fn pair_compute(&self, offset: &JsValue) -> Result<JsValue, JsValue> {
		self.0.pair_compute(offset)
	}
	fn cache_uncomputed(&self) -> Result<bool, JsValue> {
		self.0.cache_uncomputed()
	}
	fn cached(&self) -> Result<JsValue, JsValue> {
		self.0.cached()
	}
	fn index_before_count(&self, index: f64) -> Result<bool, JsValue> {
		self.0.index_before_count(index)
	}
	fn child(&self, index: f64) -> Result<JsValue, JsValue> {
		self.0.child(index)
	}
	fn truthy(&self, value: &JsValue) -> Result<bool, JsValue> {
		self.0.truthy(value)
	}
	fn minimum_child(
		&self,
		current: &JsValue,
		child: &JsValue,
		offset: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0.minimum_child(current, child, offset)
	}
	fn end(&self, offset: &JsValue, child: &JsValue) -> Result<JsValue, JsValue> {
		self.0.end(offset, child)
	}
	fn set_cached(&self, value: &JsValue) -> Result<(), JsValue> {
		self.0.set_cached(value)
	}
	fn start_line(&self, offset: &JsValue) -> Result<JsValue, JsValue> {
		self.0.start_line(offset)
	}
	fn end_line(&self, offset: &JsValue) -> Result<JsValue, JsValue> {
		self.0.end_line(offset)
	}
	fn line_before_end(&self, line: &JsValue, end: &JsValue) -> Result<bool, JsValue> {
		self.0.line_before_end(line, end)
	}
	fn first_column(&self, line: &JsValue) -> Result<JsValue, JsValue> {
		self.0.first_column(line)
	}
	fn line_content(&self, line: &JsValue) -> Result<JsValue, JsValue> {
		self.0.line_content(line)
	}
	fn is_zero(&self, value: &JsValue) -> Result<bool, JsValue> {
		self.0.is_zero(value)
	}
	fn visible_column(&self, content: &JsValue, first: &JsValue) -> Result<JsValue, JsValue> {
		self.0.visible_column(content, first)
	}
	fn minimum(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		self.0.minimum(first, second)
	}
	fn increment(&self, line: &JsValue) -> Result<JsValue, JsValue> {
		if let Some(line) = line.as_f64() {
			return Ok(JsValue::from_f64(line + 1.0));
		}
		self.0.increment(line)
	}
}

/// Versions pair/list/text/leaf indentation independently of tree ownership.
#[wasm_bindgen]
pub fn bracket_indentation_abi_version() -> u32 {
	1
}

/// Computes indentation and returns the original scalar callback or cached value.
#[wasm_bindgen]
pub fn compute_bracket_indentation(
	host: IndentationHost,
	operation: u32,
	offset: JsValue,
) -> Result<WasmBracketTreeResult, JsValue> {
	use vscode_editor_core::BracketIndentationHost;
	let host = Host(host);
	let result = match operation {
		0 => vscode_editor_core::pair_bracket_indentation(&host, &offset),
		1 => vscode_editor_core::list_bracket_indentation(&host, &offset),
		2 => vscode_editor_core::text_bracket_indentation(&host, &offset),
		3 => host.maximum(),
		_ => Err(JsValue::from_str(
			"Invalid Rust bracket indentation operation",
		)),
	}?;
	Ok(WasmBracketTreeResult::new(result))
}
