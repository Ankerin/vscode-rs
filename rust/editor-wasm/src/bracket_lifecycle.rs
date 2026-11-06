/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket lifecycle preserves original model, parser, queue, and event capabilities.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type LifecycleHost;
	#[wasm_bindgen(method, catch, js_name = truthy)]
	fn truthy(this: &LifecycleHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = isUndefined)]
	fn is_undefined(this: &LifecycleHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = hasTokens)]
	fn has_tokens(this: &LifecycleHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = completed)]
	fn completed(this: &LifecycleHost, constructing: bool) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = initialBrackets)]
	fn initial_brackets(this: &LifecycleHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = fastTokenizer)]
	fn fast_tokenizer(this: &LifecycleHost, brackets: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = parseInitial)]
	fn parse_initial(this: &LifecycleHost, tokenizer: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = initial)]
	fn initial(this: &LifecycleHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = setInitial)]
	fn set_initial(this: &LifecycleHost, node: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = setCurrent)]
	fn set_current(this: &LifecycleHost, node: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = parseEmpty)]
	fn parse_empty(this: &LifecycleHost, immutable: bool) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = fire)]
	fn fire(this: &LifecycleHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = combineQueue)]
	fn combine_queue(this: &LifecycleHost, initial: bool) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = setQueue)]
	fn set_queue(this: &LifecycleHost, initial: bool, edits: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = handleEdits)]
	fn handle_edits(this: &LifecycleHost, token_change: bool) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = queueNonempty)]
	fn queue_nonempty(this: &LifecycleHost, initial: bool) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = parseQueue)]
	fn parse_queue(this: &LifecycleHost, initial: bool) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = clearQueue)]
	fn clear_queue(this: &LifecycleHost, initial: bool) -> Result<(), JsValue>;
}

struct Host(LifecycleHost);

impl vscode_editor_core::BracketLifecycleHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn undefined(&self) -> JsValue {
		JsValue::UNDEFINED
	}
	fn truthy(&self, value: &JsValue) -> Result<bool, JsValue> {
		self.0.truthy(value)
	}
	fn is_undefined(&self, value: &JsValue) -> Result<bool, JsValue> {
		self.0.is_undefined(value)
	}
	fn has_tokens(&self) -> Result<bool, JsValue> {
		self.0.has_tokens()
	}
	fn completed(&self, constructing: bool) -> Result<bool, JsValue> {
		self.0.completed(constructing)
	}
	fn initial_brackets(&self) -> Result<JsValue, JsValue> {
		self.0.initial_brackets()
	}
	fn fast_tokenizer(&self, brackets: &JsValue) -> Result<JsValue, JsValue> {
		self.0.fast_tokenizer(brackets)
	}
	fn parse_initial(&self, tokenizer: &JsValue) -> Result<JsValue, JsValue> {
		self.0.parse_initial(tokenizer)
	}
	fn initial(&self) -> Result<JsValue, JsValue> {
		self.0.initial()
	}
	fn set_initial(&self, node: &JsValue) -> Result<(), JsValue> {
		self.0.set_initial(node)
	}
	fn set_current(&self, node: &JsValue) -> Result<(), JsValue> {
		self.0.set_current(node)
	}
	fn parse_empty(&self, immutable: bool) -> Result<JsValue, JsValue> {
		self.0.parse_empty(immutable)
	}
	fn fire(&self) -> Result<(), JsValue> {
		self.0.fire()
	}
	fn combine_queue(&self, initial: bool) -> Result<JsValue, JsValue> {
		self.0.combine_queue(initial)
	}
	fn set_queue(&self, initial: bool, edits: &JsValue) -> Result<(), JsValue> {
		self.0.set_queue(initial, edits)
	}
	fn handle_edits(&self, token_change: bool) -> Result<(), JsValue> {
		self.0.handle_edits(token_change)
	}
	fn queue_nonempty(&self, initial: bool) -> Result<bool, JsValue> {
		self.0.queue_nonempty(initial)
	}
	fn parse_queue(&self, initial: bool) -> Result<JsValue, JsValue> {
		self.0.parse_queue(initial)
	}
	fn clear_queue(&self, initial: bool) -> Result<(), JsValue> {
		self.0.clear_queue(initial)
	}
}

/// Versions lazy tree updates and tokenization transitions independently of AST ownership.
#[wasm_bindgen]
pub fn bracket_lifecycle_abi_version() -> u32 {
	1
}

/// Executes one complete lifecycle operation without retrying failures.
#[wasm_bindgen]
pub fn run_bracket_lifecycle(
	host: LifecycleHost,
	operation: u32,
	token_change: bool,
) -> Result<(), JsValue> {
	let host = Host(host);
	match operation {
		0 => vscode_editor_core::initialize_bracket_tree(&host),
		1 => vscode_editor_core::complete_bracket_tokenization(&host),
		2 => vscode_editor_core::queue_bracket_edits(&host, token_change),
		3 => vscode_editor_core::handle_bracket_change(&host, token_change),
		4 => vscode_editor_core::flush_bracket_queues(&host),
		_ => Err(JsValue::from_str(
			"Invalid Rust bracket lifecycle operation",
		)),
	}
}
