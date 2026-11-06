/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Validates original model edits through captured, caught JavaScript capabilities.

use vscode_editor_core::ModelEditValidationHost;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type EditValidationHost;
	#[wasm_bindgen(method, catch, js_name = annotated)]
	fn annotated(this: &EditValidationHost, operation: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = field)]
	fn field(
		this: &EditValidationHost,
		operation: &JsValue,
		index: u32,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = rangeMethod)]
	fn range_method(this: &EditValidationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = validateRange)]
	fn validate_range(
		this: &EditValidationHost,
		method: &JsValue,
		range: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = length)]
	fn length(this: &EditValidationHost, text: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = aboveZero)]
	fn above_zero(this: &EditValidationHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = minusOne)]
	fn minus_one(this: &EditValidationHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = charMethod)]
	fn char_method(this: &EditValidationHost, text: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = charCode)]
	fn char_code(
		this: &EditValidationHost,
		method: &JsValue,
		index: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = eol)]
	fn eol(this: &EditValidationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = endColumn)]
	fn end_column(this: &EditValidationHost, range: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = maxMethod)]
	fn max_method(this: &EditValidationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = endLine)]
	fn end_line(this: &EditValidationHost, range: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = maxColumn)]
	fn max_column(
		this: &EditValidationHost,
		method: &JsValue,
		line: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = substringMethod)]
	fn substring_method(this: &EditValidationHost, text: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = substring)]
	fn substring(
		this: &EditValidationHost,
		method: &JsValue,
		end: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = construct)]
	fn construct(
		this: &EditValidationHost,
		method: &JsValue,
		identifier: &JsValue,
		range: &JsValue,
		text: &JsValue,
		markers: &JsValue,
		whitespace: &JsValue,
		tracked: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = constructMethod)]
	fn construct_method(this: &EditValidationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = result)]
	fn result(this: &EditValidationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = operationLength)]
	fn operation_length(
		this: &EditValidationHost,
		operations: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = less)]
	fn less(this: &EditValidationHost, index: f64, length: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = editMethod)]
	fn edit_method(this: &EditValidationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = operation)]
	fn operation(
		this: &EditValidationHost,
		operations: &JsValue,
		index: f64,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = validateEdit)]
	fn validate_edit(
		this: &EditValidationHost,
		method: &JsValue,
		operation: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = write)]
	fn write(
		this: &EditValidationHost,
		result: &JsValue,
		index: f64,
		operation: &JsValue,
	) -> Result<(), JsValue>;
}

struct Host(EditValidationHost);
impl ModelEditValidationHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn null(&self) -> JsValue {
		JsValue::NULL
	}
	fn boolean(&self, value: bool) -> JsValue {
		JsValue::from_bool(value)
	}
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn crlf(&self) -> JsValue {
		JsValue::from_str("\r\n")
	}
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn same(&self, first: &JsValue, second: &JsValue) -> bool {
		first == second
	}
	fn annotated(&self, operation: &JsValue) -> Result<bool, JsValue> {
		self.0.annotated(operation)
	}
	fn field(&self, operation: &JsValue, index: u32) -> Result<JsValue, JsValue> {
		self.0.field(operation, index)
	}
	fn range_method(&self) -> Result<JsValue, JsValue> {
		self.0.range_method()
	}
	fn validate_range(&self, method: &JsValue, range: &JsValue) -> Result<JsValue, JsValue> {
		self.0.validate_range(method, range)
	}
	fn length(&self, text: &JsValue) -> Result<JsValue, JsValue> {
		self.0.length(text)
	}
	fn above_zero(&self, value: &JsValue) -> Result<bool, JsValue> {
		match value.as_f64() {
			Some(value) => Ok(value > 0.0),
			None => self.0.above_zero(value),
		}
	}
	fn minus_one(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		match value.as_f64() {
			Some(value) => Ok(JsValue::from_f64(value - 1.0)),
			None => self.0.minus_one(value),
		}
	}
	fn char_method(&self, text: &JsValue) -> Result<JsValue, JsValue> {
		self.0.char_method(text)
	}
	fn char_code(&self, method: &JsValue, index: &JsValue) -> Result<JsValue, JsValue> {
		self.0.char_code(method, index)
	}
	fn eol(&self) -> Result<JsValue, JsValue> {
		self.0.eol()
	}
	fn end_column(&self, range: &JsValue) -> Result<JsValue, JsValue> {
		self.0.end_column(range)
	}
	fn max_method(&self) -> Result<JsValue, JsValue> {
		self.0.max_method()
	}
	fn end_line(&self, range: &JsValue) -> Result<JsValue, JsValue> {
		self.0.end_line(range)
	}
	fn max_column(&self, method: &JsValue, line: &JsValue) -> Result<JsValue, JsValue> {
		self.0.max_column(method, line)
	}
	fn substring_method(&self, text: &JsValue) -> Result<JsValue, JsValue> {
		self.0.substring_method(text)
	}
	fn substring(&self, method: &JsValue, end: &JsValue) -> Result<JsValue, JsValue> {
		self.0.substring(method, end)
	}
	fn construct_method(&self) -> Result<JsValue, JsValue> {
		self.0.construct_method()
	}
	fn construct(&self, method: &JsValue, values: &[JsValue; 6]) -> Result<JsValue, JsValue> {
		self.0.construct(
			method, &values[0], &values[1], &values[2], &values[3], &values[4], &values[5],
		)
	}
	fn result(&self) -> Result<JsValue, JsValue> {
		self.0.result()
	}
	fn operation_length(&self, operations: &JsValue) -> Result<JsValue, JsValue> {
		self.0.operation_length(operations)
	}
	fn less(&self, index: f64, length: &JsValue) -> Result<bool, JsValue> {
		match length.as_f64() {
			Some(length) => Ok(index < length),
			None => self.0.less(index, length),
		}
	}
	fn edit_method(&self) -> Result<JsValue, JsValue> {
		self.0.edit_method()
	}
	fn operation(&self, operations: &JsValue, index: f64) -> Result<JsValue, JsValue> {
		self.0.operation(operations, index)
	}
	fn validate_edit(&self, method: &JsValue, operation: &JsValue) -> Result<JsValue, JsValue> {
		self.0.validate_edit(method, operation)
	}
	fn write(&self, result: &JsValue, index: f64, operation: &JsValue) -> Result<(), JsValue> {
		self.0.write(result, index, operation)
	}
}

/// Identifies model edit validation independently of buffer edit execution.
#[wasm_bindgen]
pub fn model_edit_validation_abi_version() -> u32 {
	1
}

/// Preserves validated operation identity and original batch array behavior.
#[wasm_bindgen]
pub fn run_model_edit_validation(
	host: EditValidationHost,
	operation: u32,
	input: JsValue,
) -> Result<JsValue, JsValue> {
	let host = Host(host);
	match operation {
		0 => vscode_editor_core::validate_model_edit(&host, input),
		1 => vscode_editor_core::validate_model_edits(&host, &input),
		_ => Err(JsValue::from_str(
			"Unsupported model edit validation operation",
		)),
	}
}
