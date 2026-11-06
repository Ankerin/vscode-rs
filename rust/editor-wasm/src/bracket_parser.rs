/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket parser bindings retain original host identities, callbacks, and scoped results.

use crate::bracket_trees::WasmBracketTreeResult;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type ParserHost;
	#[wasm_bindgen(method, catch, js_name = nodeExists)]
	fn node_exists(this: &ParserHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = resetCounters)]
	fn reset_counters(this: &ParserHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = parseRoot)]
	fn parse_root(this: &ParserHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = empty)]
	fn empty(this: &ParserHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = newItems)]
	fn new_items(this: &ParserHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = cached)]
	fn cached(this: &ParserHost, opened: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = peek)]
	fn peek(this: &ParserHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = tokenExists)]
	fn token_exists(this: &ParserHost, token: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = closesOpened)]
	fn closes_opened(this: &ParserHost, token: &JsValue, opened: &JsValue)
	-> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = parseChild)]
	fn parse_child(this: &ParserHost, opened: &JsValue, level: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = emptyList)]
	fn empty_list(this: &ParserHost, node: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = push)]
	fn push(this: &ParserHost, items: &JsValue, node: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = concat)]
	fn concat(this: &ParserHost, items: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = hasReader)]
	fn has_reader(this: &ParserHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = cacheableLength)]
	fn cacheable_length(this: &ParserHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = cacheable)]
	fn cacheable(this: &ParserHost, length: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = readCache)]
	fn read_cache(
		this: &ParserHost,
		length: &JsValue,
		opened: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = incrementCached)]
	fn increment_cached(this: &ParserHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = skipNode)]
	fn skip_node(this: &ParserHost, node: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = lengthAccepts)]
	fn length_accepts(
		this: &ParserHost,
		node: &JsValue,
		maximum: &JsValue,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = canReuse)]
	fn can_reuse(this: &ParserHost, node: &JsValue, opened: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = incrementConstructed)]
	fn increment_constructed(this: &ParserHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = read)]
	fn read(this: &ParserHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = invalid)]
	fn invalid(this: &ParserHost, token: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = text)]
	fn text(this: &ParserHost, token: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = newText)]
	fn new_text(this: &ParserHost, token: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = merge)]
	fn merge(this: &ParserHost, opened: &JsValue, token: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = parseList)]
	fn parse_list(this: &ParserHost, opened: &JsValue, level: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = closesPair)]
	fn closes_pair(
		this: &ParserHost,
		closing: &JsValue,
		opening: &JsValue,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = tokenKind)]
	fn token_kind(this: &ParserHost, token: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch)]
	fn pair(
		this: &ParserHost,
		opening: &JsValue,
		child: &JsValue,
		closing: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch)]
	fn unexpected(this: &ParserHost) -> Result<JsValue, JsValue>;
}

struct Host(ParserHost);

impl vscode_editor_core::BracketParserHost for Host {
	type Node = JsValue;
	type Token = JsValue;
	type Set = JsValue;
	type Length = JsValue;
	type Items = JsValue;
	type Error = JsValue;

	fn undefined_node(&self) -> JsValue {
		JsValue::UNDEFINED
	}
	fn node_exists(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.node_exists(node)
	}
	fn reset_counters(&self) -> Result<(), JsValue> {
		self.0.reset_counters()
	}
	fn parse_root(&self) -> Result<JsValue, JsValue> {
		self.0.parse_root()
	}
	fn empty(&self) -> Result<JsValue, JsValue> {
		self.0.empty()
	}
	fn new_items(&self) -> Result<JsValue, JsValue> {
		self.0.new_items()
	}
	fn cached(&self, opened: &JsValue) -> Result<JsValue, JsValue> {
		self.0.cached(opened)
	}
	fn peek(&self) -> Result<JsValue, JsValue> {
		self.0.peek()
	}
	fn token_exists(&self, token: &JsValue) -> Result<bool, JsValue> {
		self.0.token_exists(token)
	}
	fn closes_opened(&self, token: &JsValue, opened: &JsValue) -> Result<bool, JsValue> {
		self.0.closes_opened(token, opened)
	}
	fn parse_child(&self, opened: &JsValue, level: f64) -> Result<JsValue, JsValue> {
		self.0.parse_child(opened, level)
	}
	fn empty_list(&self, node: &JsValue) -> Result<bool, JsValue> {
		self.0.empty_list(node)
	}
	fn push(&self, items: &JsValue, node: &JsValue) -> Result<(), JsValue> {
		self.0.push(items, node)
	}
	fn concat(&self, items: &JsValue) -> Result<JsValue, JsValue> {
		self.0.concat(items)
	}
	fn has_reader(&self) -> Result<bool, JsValue> {
		self.0.has_reader()
	}
	fn cacheable_length(&self) -> Result<JsValue, JsValue> {
		self.0.cacheable_length()
	}
	fn cacheable(&self, length: &JsValue) -> Result<bool, JsValue> {
		self.0.cacheable(length)
	}
	fn read_cache(&self, length: &JsValue, opened: &JsValue) -> Result<JsValue, JsValue> {
		self.0.read_cache(length, opened)
	}
	fn increment_cached(&self) -> Result<(), JsValue> {
		self.0.increment_cached()
	}
	fn skip_node(&self, node: &JsValue) -> Result<(), JsValue> {
		self.0.skip_node(node)
	}
	fn length_accepts(&self, node: &JsValue, maximum: &JsValue) -> Result<bool, JsValue> {
		self.0.length_accepts(node, maximum)
	}
	fn can_reuse(&self, node: &JsValue, opened: &JsValue) -> Result<bool, JsValue> {
		self.0.can_reuse(node, opened)
	}
	fn increment_constructed(&self) -> Result<(), JsValue> {
		self.0.increment_constructed()
	}
	fn read(&self) -> Result<JsValue, JsValue> {
		self.0.read()
	}
	fn invalid(&self, token: &JsValue) -> Result<JsValue, JsValue> {
		self.0.invalid(token)
	}
	fn text(&self, token: &JsValue) -> Result<JsValue, JsValue> {
		self.0.text(token)
	}
	fn new_text(&self, token: &JsValue) -> Result<JsValue, JsValue> {
		self.0.new_text(token)
	}
	fn merge(&self, opened: &JsValue, token: &JsValue) -> Result<JsValue, JsValue> {
		self.0.merge(opened, token)
	}
	fn parse_list(&self, opened: &JsValue, level: f64) -> Result<JsValue, JsValue> {
		self.0.parse_list(opened, level)
	}
	fn closes_pair(&self, closing: &JsValue, opening: &JsValue) -> Result<bool, JsValue> {
		self.0.closes_pair(closing, opening)
	}
	fn token_kind(&self, token: &JsValue) -> Result<Option<u32>, JsValue> {
		Ok(match self.0.token_kind(token)?.as_f64() {
			Some(0.0) => Some(0),
			Some(1.0) => Some(1),
			Some(2.0) => Some(2),
			_ => None,
		})
	}
	fn pair(
		&self,
		opening: &JsValue,
		child: &JsValue,
		closing: Option<&JsValue>,
	) -> Result<JsValue, JsValue> {
		self.0
			.pair(opening, child, closing.unwrap_or(&JsValue::NULL))
	}
	fn unexpected(&self) -> JsValue {
		match self.0.unexpected() {
			Ok(error) | Err(error) => error,
		}
	}
}

/// Versions complete parser orchestration independently of tree storage and token scanning.
#[wasm_bindgen]
pub fn bracket_parser_abi_version() -> u32 {
	1
}

/// Parses a document through the original root dispatch and empty-node factory.
#[wasm_bindgen]
pub fn parse_bracket_document(host: ParserHost) -> Result<WasmBracketTreeResult, JsValue> {
	Ok(WasmBracketTreeResult::new(
		vscode_editor_core::parse_bracket_document(&Host(host))?,
	))
}

/// Parses one list using actual tokens, sets, cached nodes, and concatenation factories.
#[wasm_bindgen]
pub fn parse_bracket_list(
	host: ParserHost,
	opened: JsValue,
	level: f64,
) -> Result<WasmBracketTreeResult, JsValue> {
	Ok(WasmBracketTreeResult::new(
		vscode_editor_core::parse_bracket_list(&Host(host), &opened, level)?,
	))
}

/// Parses one child, preserving the original guard against excessive opening depth.
#[wasm_bindgen]
pub fn parse_bracket_child(
	host: ParserHost,
	opened: JsValue,
	level: f64,
) -> Result<WasmBracketTreeResult, JsValue> {
	Ok(WasmBracketTreeResult::new(
		vscode_editor_core::parse_bracket_child(&Host(host), &opened, level)?,
	))
}

/// Resolves cache reuse through the original mapper, longest-node reader, and skip callback.
#[wasm_bindgen]
pub fn read_bracket_parser_cache(
	host: ParserHost,
	opened: JsValue,
) -> Result<WasmBracketTreeResult, JsValue> {
	Ok(WasmBracketTreeResult::new(
		vscode_editor_core::read_bracket_parser_cache(&Host(host), &opened)?,
	))
}

/// Evaluates touching-edit exclusion before the node's compatibility callback.
#[wasm_bindgen]
pub fn can_reuse_bracket_parser_node(
	host: ParserHost,
	node: JsValue,
	maximum: JsValue,
	opened: JsValue,
) -> Result<bool, JsValue> {
	vscode_editor_core::can_reuse_bracket_parser_node(&Host(host), &node, &maximum, &opened)
}
