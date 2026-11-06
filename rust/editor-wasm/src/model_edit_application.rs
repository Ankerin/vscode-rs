/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Applies model changes through original buffer, decoration, and event capabilities.

use vscode_editor_core::ModelEditApplicationHost;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type EditApplicationHost;
	#[wasm_bindgen(method, catch, js_name = lineCount)]
	fn line_count(this: &EditApplicationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = bufferMethod)]
	fn buffer_method(this: &EditApplicationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = trim)]
	fn trim(this: &EditApplicationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = bufferApply)]
	fn buffer_apply(
		this: &EditApplicationHost,
		method: &JsValue,
		operations: &JsValue,
		trim: &JsValue,
		undo: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = changes)]
	fn changes(this: &EditApplicationHost, result: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = trimLines)]
	fn trim_lines(this: &EditApplicationHost, result: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = storeTrim)]
	fn store_trim(this: &EditApplicationHost, lines: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = length)]
	fn length(this: &EditApplicationHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = less)]
	fn less(this: &EditApplicationHost, index: f64, length: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = change)]
	fn change(
		this: &EditApplicationHost,
		changes: &JsValue,
		index: f64,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = replaceMethod)]
	fn replace_method(this: &EditApplicationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = changeField)]
	fn change_field(
		this: &EditApplicationHost,
		change: &JsValue,
		index: u32,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = replace)]
	fn replace(
		this: &EditApplicationHost,
		method: &JsValue,
		offset: &JsValue,
		deleted: &JsValue,
		inserted: &JsValue,
		markers: &JsValue,
	) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = rawChanges)]
	fn raw_changes(this: &EditApplicationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = increaseVersion)]
	fn increase_version(this: &EditApplicationHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = eolCount)]
	fn eol_count(this: &EditApplicationHost, change: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = decorationsFire)]
	fn decorations_fire(this: &EditApplicationHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = rangeLine)]
	fn range_line(
		this: &EditApplicationHost,
		change: &JsValue,
		index: u32,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = subtract)]
	fn subtract(
		this: &EditApplicationHost,
		first: &JsValue,
		second: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = add)]
	fn add(
		this: &EditApplicationHost,
		first: &JsValue,
		second: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = minimum)]
	fn minimum(
		this: &EditApplicationHost,
		first: &JsValue,
		second: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = atLeastZero)]
	fn at_least_zero(this: &EditApplicationHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = decrement)]
	fn decrement(this: &EditApplicationHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = below)]
	fn below(
		this: &EditApplicationHost,
		first: &JsValue,
		second: &JsValue,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = rawChange)]
	fn raw_change(
		this: &EditApplicationHost,
		changes: &JsValue,
		kind: u32,
		first: &JsValue,
		second: &JsValue,
		third: &JsValue,
	) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = emitMethod)]
	fn emit_method(this: &EditApplicationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = rawMethod)]
	fn raw_method(this: &EditApplicationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = version)]
	fn version(this: &EditApplicationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = flag)]
	fn flag(this: &EditApplicationHost, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = rawEvent)]
	fn raw_event(
		this: &EditApplicationHost,
		method: &JsValue,
		changes: &JsValue,
		version: &JsValue,
		undo: &JsValue,
		redo: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = bufferEOL)]
	fn buffer_eol(this: &EditApplicationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = contentEvent)]
	fn content_event(
		this: &EditApplicationHost,
		changes: &JsValue,
		eol: &JsValue,
		version: &JsValue,
		undo: &JsValue,
		redo: &JsValue,
		reason: &JsValue,
		length: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = emit)]
	fn emit(
		this: &EditApplicationHost,
		method: &JsValue,
		raw: &JsValue,
		content: &JsValue,
		selection: &JsValue,
	) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = reverse)]
	fn reverse(this: &EditApplicationHost, result: &JsValue) -> Result<JsValue, JsValue>;
}

struct Host(EditApplicationHost);
impl ModelEditApplicationHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn undefined(&self) -> JsValue {
		JsValue::UNDEFINED
	}
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn same(&self, first: &JsValue, second: &JsValue) -> bool {
		first == second
	}
	fn null(&self, value: &JsValue) -> bool {
		value.is_null()
	}
	fn line_count(&self) -> Result<JsValue, JsValue> {
		self.0.line_count()
	}
	fn buffer_method(&self) -> Result<JsValue, JsValue> {
		self.0.buffer_method()
	}
	fn trim(&self) -> Result<JsValue, JsValue> {
		self.0.trim()
	}
	fn buffer_apply(
		&self,
		method: &JsValue,
		operations: &JsValue,
		trim: &JsValue,
		undo: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0.buffer_apply(method, operations, trim, undo)
	}
	fn changes(&self, result: &JsValue) -> Result<JsValue, JsValue> {
		self.0.changes(result)
	}
	fn trim_lines(&self, result: &JsValue) -> Result<JsValue, JsValue> {
		self.0.trim_lines(result)
	}
	fn store_trim(&self, lines: &JsValue) -> Result<(), JsValue> {
		self.0.store_trim(lines)
	}
	fn length(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.length(value)
	}
	fn less(&self, index: f64, length: &JsValue) -> Result<bool, JsValue> {
		match length.as_f64() {
			Some(length) => Ok(index < length),
			None => self.0.less(index, length),
		}
	}
	fn change(&self, changes: &JsValue, index: f64) -> Result<JsValue, JsValue> {
		self.0.change(changes, index)
	}
	fn replace_method(&self) -> Result<JsValue, JsValue> {
		self.0.replace_method()
	}
	fn change_field(&self, change: &JsValue, index: u32) -> Result<JsValue, JsValue> {
		self.0.change_field(change, index)
	}
	fn replace(&self, method: &JsValue, values: &[JsValue; 4]) -> Result<(), JsValue> {
		self.0
			.replace(method, &values[0], &values[1], &values[2], &values[3])
	}
	fn raw_changes(&self) -> Result<JsValue, JsValue> {
		self.0.raw_changes()
	}
	fn increase_version(&self) -> Result<(), JsValue> {
		self.0.increase_version()
	}
	fn eol_count(&self, change: &JsValue) -> Result<JsValue, JsValue> {
		self.0.eol_count(change)
	}
	fn decorations_fire(&self) -> Result<(), JsValue> {
		self.0.decorations_fire()
	}
	fn range_line(&self, change: &JsValue, index: u32) -> Result<JsValue, JsValue> {
		self.0.range_line(change, index)
	}
	fn subtract(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		match (first.as_f64(), second.as_f64()) {
			(Some(first), Some(second)) => Ok(JsValue::from_f64(first - second)),
			_ => self.0.subtract(first, second),
		}
	}
	fn add(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		match (first.as_f64(), second.as_f64()) {
			(Some(first), Some(second)) => Ok(JsValue::from_f64(first + second)),
			_ => self.0.add(first, second),
		}
	}
	fn minimum(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		self.0.minimum(first, second)
	}
	fn at_least_zero(&self, value: &JsValue) -> Result<bool, JsValue> {
		match value.as_f64() {
			Some(value) => Ok(value >= 0.0),
			None => self.0.at_least_zero(value),
		}
	}
	fn decrement(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		match value.as_f64() {
			Some(value) => Ok(JsValue::from_f64(value - 1.0)),
			None => self.0.decrement(value),
		}
	}
	fn below(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		match (first.as_f64(), second.as_f64()) {
			(Some(first), Some(second)) => Ok(first < second),
			_ => self.0.below(first, second),
		}
	}
	fn raw_change(
		&self,
		changes: &JsValue,
		kind: u32,
		first: &JsValue,
		second: &JsValue,
		third: &JsValue,
	) -> Result<(), JsValue> {
		self.0.raw_change(changes, kind, first, second, third)
	}
	fn emit_method(&self) -> Result<JsValue, JsValue> {
		self.0.emit_method()
	}
	fn raw_method(&self) -> Result<JsValue, JsValue> {
		self.0.raw_method()
	}
	fn version(&self) -> Result<JsValue, JsValue> {
		self.0.version()
	}
	fn flag(&self, index: u32) -> Result<JsValue, JsValue> {
		self.0.flag(index)
	}
	fn raw_event(
		&self,
		method: &JsValue,
		changes: &JsValue,
		version: &JsValue,
		undo: &JsValue,
		redo: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0.raw_event(method, changes, version, undo, redo)
	}
	fn buffer_eol(&self) -> Result<JsValue, JsValue> {
		self.0.buffer_eol()
	}
	fn content_event(&self, values: &[JsValue; 7]) -> Result<JsValue, JsValue> {
		self.0.content_event(
			&values[0], &values[1], &values[2], &values[3], &values[4], &values[5], &values[6],
		)
	}
	fn emit(
		&self,
		method: &JsValue,
		raw: &JsValue,
		content: &JsValue,
		selection: &JsValue,
	) -> Result<(), JsValue> {
		self.0.emit(method, raw, content, selection)
	}
	fn reverse(&self, result: &JsValue) -> Result<JsValue, JsValue> {
		self.0.reverse(result)
	}
}

/// Identifies model change application independently of text-buffer storage.
#[wasm_bindgen]
pub fn model_edit_application_abi_version() -> u32 {
	1
}

/// Applies one validated model batch, retaining original event and inverse-edit results.
#[wasm_bindgen]
pub fn apply_model_edits(
	host: EditApplicationHost,
	operations: JsValue,
	undo: JsValue,
	reason: JsValue,
	selection: JsValue,
) -> Result<JsValue, JsValue> {
	vscode_editor_core::apply_model_edits(&Host(host), &operations, &undo, reason, &selection)
}
