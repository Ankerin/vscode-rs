/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket tokenization retains caught providers, live cursor fields, and scoped token references.

use crate::bracket_trees::WasmBracketTreeResult;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type PeekableHost;
	#[wasm_bindgen(method, catch, js_name = peeked)]
	fn peekable_peeked(this: &PeekableHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = truthy)]
	fn peekable_truthy(this: &PeekableHost, token: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = didPeek)]
	fn peekable_did_peek(this: &PeekableHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = setDidPeek)]
	fn peekable_set_did_peek(this: &PeekableHost, value: bool) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = setPeeked)]
	fn peekable_set_peeked(this: &PeekableHost, token: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = read)]
	fn peekable_read(this: &PeekableHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = advanceToken)]
	fn peekable_advance_token(this: &PeekableHost, token: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = advanceLength)]
	fn peekable_advance_length(this: &PeekableHost, length: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = updatePosition)]
	fn peekable_update_position(this: &PeekableHost) -> Result<(), JsValue>;
	pub type TokenizerHost;
	#[wasm_bindgen(method, catch, js_name = add)]
	fn add(this: &TokenizerHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = subtract)]
	fn subtract(
		this: &TokenizerHost,
		first: &JsValue,
		second: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = greater)]
	fn greater(this: &TokenizerHost, first: &JsValue, second: f64) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = truthy)]
	fn truthy(this: &TokenizerHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = peeked)]
	fn peeked(this: &TokenizerHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = setPeeked)]
	fn set_peeked(this: &TokenizerHost, token: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = consume)]
	fn consume(this: &TokenizerHost, token: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = atEnd)]
	fn at_end(this: &TokenizerHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = lineMissing)]
	fn line_missing(this: &TokenizerHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = loadTokens)]
	fn load_tokens(this: &TokenizerHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = loadLine)]
	fn load_line(this: &TokenizerHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = selectIndex)]
	fn select_index(this: &TokenizerHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = lineIndex)]
	fn line_index(this: &TokenizerHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = column)]
	fn column(this: &TokenizerHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = tokens)]
	fn tokens(this: &TokenizerHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = count)]
	fn count(this: &TokenizerHost, tokens: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = hasToken)]
	fn has_token(this: &TokenizerHost, count: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = metadata)]
	fn metadata(this: &TokenizerHost, tokens: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = identical)]
	fn identical(
		this: &TokenizerHost,
		tokens: &JsValue,
		count: &JsValue,
		metadata: &JsValue,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = incrementIndex)]
	fn increment_index(this: &TokenizerHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = isOther)]
	fn is_other(this: &TokenizerHost, metadata: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = containsBrackets)]
	fn contains_brackets(this: &TokenizerHost, metadata: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = endOffset)]
	fn end_offset(this: &TokenizerHost, tokens: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = beforeEnd)]
	fn before_end(this: &TokenizerHost, end: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = language)]
	fn language(this: &TokenizerHost, tokens: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = text)]
	fn text(this: &TokenizerHost, end: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = brackets)]
	fn brackets(this: &TokenizerHost, language: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = regexp)]
	fn regexp(this: &TokenizerHost, brackets: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = resetRegexp)]
	fn reset_regexp(this: &TokenizerHost, regexp: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = exec)]
	fn exec(this: &TokenizerHost, regexp: &JsValue, text: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = matchedToken)]
	fn matched_token(
		this: &TokenizerHost,
		brackets: &JsValue,
		matched: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = consumeMatch)]
	fn consume_match(this: &TokenizerHost, matched: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = changed)]
	fn changed(this: &TokenizerHost, line: &JsValue, column: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = setColumn)]
	fn set_column(this: &TokenizerHost, column: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = lastLine)]
	fn last_line(this: &TokenizerHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = incrementLine)]
	fn increment_line(this: &TokenizerHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = zeroIndex)]
	fn zero_index(this: &TokenizerHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = finishText)]
	fn finish_text(
		this: &TokenizerHost,
		line: &JsValue,
		column: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = sameLine)]
	fn same_line(this: &TokenizerHost, line: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = setLine)]
	fn set_line(this: &TokenizerHost, line: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = clearLine)]
	fn clear_line(this: &TokenizerHost) -> Result<(), JsValue>;
}

struct Peekable(PeekableHost);
struct Host(TokenizerHost);

impl vscode_editor_core::PeekableBracketTokenizerHost for Peekable {
	type Value = JsValue;
	type Error = JsValue;
	fn peeked(&self) -> Result<JsValue, JsValue> {
		self.0.peekable_peeked()
	}
	fn truthy(&self, token: &JsValue) -> Result<bool, JsValue> {
		self.0.peekable_truthy(token)
	}
	fn did_peek(&self) -> Result<bool, JsValue> {
		self.0.peekable_did_peek()
	}
	fn set_did_peek(&self, value: bool) -> Result<(), JsValue> {
		self.0.peekable_set_did_peek(value)
	}
	fn set_peeked(&self, token: &JsValue) -> Result<(), JsValue> {
		self.0.peekable_set_peeked(token)
	}
	fn read(&self) -> Result<JsValue, JsValue> {
		self.0.peekable_read()
	}
	fn advance_token(&self, token: &JsValue) -> Result<(), JsValue> {
		self.0.peekable_advance_token(token)
	}
	fn advance_length(&self, length: &JsValue) -> Result<(), JsValue> {
		self.0.peekable_advance_length(length)
	}
	fn update_position(&self) -> Result<(), JsValue> {
		self.0.peekable_update_position()
	}
}

impl vscode_editor_core::BracketTokenizerHost for Host {
	type Value = JsValue;
	type Error = JsValue;

	fn number(&self, value: &JsValue) -> Option<f64> {
		value.as_f64()
	}
	fn value(&self, number: f64) -> JsValue {
		JsValue::from_f64(number)
	}
	fn null(&self) -> JsValue {
		JsValue::NULL
	}
	fn add(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		self.0.add(first, second)
	}
	fn subtract(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		self.0.subtract(first, second)
	}
	fn greater(&self, first: &JsValue, second: f64) -> Result<bool, JsValue> {
		self.0.greater(first, second)
	}
	fn truthy(&self, value: &JsValue) -> Result<bool, JsValue> {
		self.0.truthy(value)
	}
	fn peeked(&self) -> Result<JsValue, JsValue> {
		self.0.peeked()
	}
	fn set_peeked(&self, token: &JsValue) -> Result<(), JsValue> {
		self.0.set_peeked(token)
	}
	fn consume(&self, token: &JsValue) -> Result<(), JsValue> {
		self.0.consume(token)
	}
	fn at_end(&self) -> Result<bool, JsValue> {
		self.0.at_end()
	}
	fn line_missing(&self) -> Result<bool, JsValue> {
		self.0.line_missing()
	}
	fn load_tokens(&self) -> Result<(), JsValue> {
		self.0.load_tokens()
	}
	fn load_line(&self) -> Result<(), JsValue> {
		self.0.load_line()
	}
	fn select_index(&self) -> Result<(), JsValue> {
		self.0.select_index()
	}
	fn line_index(&self) -> Result<JsValue, JsValue> {
		self.0.line_index()
	}
	fn column(&self) -> Result<JsValue, JsValue> {
		self.0.column()
	}
	fn tokens(&self) -> Result<JsValue, JsValue> {
		self.0.tokens()
	}
	fn count(&self, tokens: &JsValue) -> Result<JsValue, JsValue> {
		self.0.count(tokens)
	}
	fn has_token(&self, count: &JsValue) -> Result<bool, JsValue> {
		self.0.has_token(count)
	}
	fn metadata(&self, tokens: &JsValue) -> Result<JsValue, JsValue> {
		self.0.metadata(tokens)
	}
	fn identical(
		&self,
		tokens: &JsValue,
		count: &JsValue,
		metadata: &JsValue,
	) -> Result<bool, JsValue> {
		self.0.identical(tokens, count, metadata)
	}
	fn increment_index(&self) -> Result<(), JsValue> {
		self.0.increment_index()
	}
	fn is_other(&self, metadata: &JsValue) -> Result<bool, JsValue> {
		self.0.is_other(metadata)
	}
	fn contains_brackets(&self, metadata: &JsValue) -> Result<bool, JsValue> {
		self.0.contains_brackets(metadata)
	}
	fn end_offset(&self, tokens: &JsValue) -> Result<JsValue, JsValue> {
		self.0.end_offset(tokens)
	}
	fn before_end(&self, end: &JsValue) -> Result<bool, JsValue> {
		self.0.before_end(end)
	}
	fn language(&self, tokens: &JsValue) -> Result<JsValue, JsValue> {
		self.0.language(tokens)
	}
	fn text(&self, end: &JsValue) -> Result<JsValue, JsValue> {
		self.0.text(end)
	}
	fn brackets(&self, language: &JsValue) -> Result<JsValue, JsValue> {
		self.0.brackets(language)
	}
	fn regexp(&self, brackets: &JsValue) -> Result<JsValue, JsValue> {
		self.0.regexp(brackets)
	}
	fn reset_regexp(&self, regexp: &JsValue) -> Result<(), JsValue> {
		self.0.reset_regexp(regexp)
	}
	fn exec(&self, regexp: &JsValue, text: &JsValue) -> Result<JsValue, JsValue> {
		self.0.exec(regexp, text)
	}
	fn matched_token(&self, brackets: &JsValue, matched: &JsValue) -> Result<JsValue, JsValue> {
		self.0.matched_token(brackets, matched)
	}
	fn consume_match(&self, matched: &JsValue) -> Result<(), JsValue> {
		self.0.consume_match(matched)
	}
	fn changed(&self, line: &JsValue, column: &JsValue) -> Result<bool, JsValue> {
		self.0.changed(line, column)
	}
	fn set_column(&self, column: &JsValue) -> Result<(), JsValue> {
		self.0.set_column(column)
	}
	fn last_line(&self) -> Result<bool, JsValue> {
		self.0.last_line()
	}
	fn increment_line(&self) -> Result<(), JsValue> {
		self.0.increment_line()
	}
	fn zero_index(&self) -> Result<(), JsValue> {
		self.0.zero_index()
	}
	fn finish_text(&self, line: &JsValue, column: &JsValue) -> Result<JsValue, JsValue> {
		self.0.finish_text(line, column)
	}
	fn same_line(&self, line: &JsValue) -> Result<bool, JsValue> {
		self.0.same_line(line)
	}
	fn set_line(&self, line: &JsValue) -> Result<(), JsValue> {
		self.0.set_line(line)
	}
	fn clear_line(&self) -> Result<(), JsValue> {
		self.0.clear_line()
	}
}

/// Versions line scanning, peekable reads, and live tokenizer positioning independently of parsing.
#[wasm_bindgen]
pub fn bracket_tokenizer_abi_version() -> u32 {
	1
}

/// Reads one line-aware bracket/text token through the original source and regular expression providers.
#[wasm_bindgen]
pub fn read_bracket_token(host: TokenizerHost) -> Result<WasmBracketTreeResult, JsValue> {
	Ok(WasmBracketTreeResult::new(
		vscode_editor_core::read_bracket_token(&Host(host))?,
	))
}

/// Repositions the live line reader with original invalidation and partial-write behavior.
#[wasm_bindgen]
pub fn set_bracket_token_position(
	host: TokenizerHost,
	line: JsValue,
	column: JsValue,
) -> Result<bool, JsValue> {
	vscode_editor_core::set_bracket_token_position(&Host(host), &line, &column)?;
	Ok(true)
}

/// Reads the peekable wrapper while retaining its historical cached token alias behavior.
#[wasm_bindgen]
pub fn read_peekable_bracket_token(host: PeekableHost) -> Result<WasmBracketTreeResult, JsValue> {
	Ok(WasmBracketTreeResult::new(
		vscode_editor_core::read_peekable_bracket_token(&Peekable(host))?,
	))
}

/// Peeks through original read/assignment/flag transitions.
#[wasm_bindgen]
pub fn peek_bracket_token(host: PeekableHost) -> Result<WasmBracketTreeResult, JsValue> {
	Ok(WasmBracketTreeResult::new(
		vscode_editor_core::peek_bracket_token(&Peekable(host))?,
	))
}

/// Skips through original offset arithmetic and the reader's positioning method.
#[wasm_bindgen]
pub fn skip_bracket_tokens(host: PeekableHost, length: JsValue) -> Result<bool, JsValue> {
	vscode_editor_core::skip_bracket_tokens(&Peekable(host), &length)?;
	Ok(true)
}
