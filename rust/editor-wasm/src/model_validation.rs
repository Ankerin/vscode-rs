/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Scoped model validation retains original provider exceptions and compatibility objects.

use vscode_editor_core::{ModelComparison, ModelCoordinate, ModelValidationHost};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type ValidationHost;
	#[wasm_bindgen(method, catch, js_name = publicIsValidRange)]
	fn public_is_valid_range(this: &ValidationHost, range: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = positionMethod)]
	fn position_method(this: &ValidationHost, valid: bool) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = callIsValidPosition)]
	fn call_is_valid_position(
		this: &ValidationHost,
		method: &JsValue,
		line: &JsValue,
		column: &JsValue,
		surrogates: bool,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = callValidatePosition)]
	fn call_validate_position(
		this: &ValidationHost,
		method: &JsValue,
		line: &JsValue,
		column: &JsValue,
		surrogates: bool,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = charCodeMethod)]
	fn char_code_method(this: &ValidationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = callCharCode)]
	fn call_char_code(
		this: &ValidationHost,
		method: &JsValue,
		line: &JsValue,
		index: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = coordinate)]
	fn coordinate(this: &ValidationHost, value: &JsValue, field: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = compare)]
	fn compare(
		this: &ValidationHost,
		operation: u32,
		first: &JsValue,
		second: &JsValue,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = add)]
	fn add(this: &ValidationHost, value: &JsValue, amount: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = subtract)]
	fn subtract(this: &ValidationHost, value: &JsValue, amount: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = lineCount)]
	fn line_count(this: &ValidationHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = maxColumn)]
	fn max_column(this: &ValidationHost, line: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = lineLength)]
	fn line_length(this: &ValidationHost, line: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = charCode)]
	fn char_code(
		this: &ValidationHost,
		line: &JsValue,
		index: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = assertAlive)]
	fn assert_alive(this: &ValidationHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = reusable)]
	fn reusable(this: &ValidationHost, value: &JsValue, range: bool) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = isValidPosition)]
	fn is_valid_position(
		this: &ValidationHost,
		line: &JsValue,
		column: &JsValue,
		surrogates: bool,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = validatePosition)]
	fn validate_position(
		this: &ValidationHost,
		line: &JsValue,
		column: &JsValue,
		surrogates: bool,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = isValidRange)]
	fn is_valid_range(
		this: &ValidationHost,
		range: &JsValue,
		surrogates: bool,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = makePosition)]
	fn make_position(
		this: &ValidationHost,
		line: &JsValue,
		column: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = makeRange)]
	fn make_range(
		this: &ValidationHost,
		start_line: &JsValue,
		start_column: &JsValue,
		end_line: &JsValue,
		end_column: &JsValue,
	) -> Result<JsValue, JsValue>;
}

struct Host(ValidationHost);

impl ModelValidationHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn position_method(&self, valid: bool) -> Result<JsValue, JsValue> {
		self.0.position_method(valid)
	}
	fn call_is_valid_position(
		&self,
		method: &JsValue,
		line: &JsValue,
		column: &JsValue,
		surrogates: bool,
	) -> Result<bool, JsValue> {
		self.0
			.call_is_valid_position(method, line, column, surrogates)
	}
	fn call_validate_position(
		&self,
		method: &JsValue,
		line: &JsValue,
		column: &JsValue,
		surrogates: bool,
	) -> Result<JsValue, JsValue> {
		self.0
			.call_validate_position(method, line, column, surrogates)
	}
	fn char_code_method(&self) -> Result<JsValue, JsValue> {
		self.0.char_code_method()
	}
	fn call_char_code(
		&self,
		method: &JsValue,
		line: &JsValue,
		index: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0.call_char_code(method, line, index)
	}
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn copy_value(&self, value: &JsValue) -> JsValue {
		value.clone()
	}
	fn numeric(&self, value: &JsValue) -> Option<f64> {
		value.as_f64()
	}
	fn coordinate(&self, value: &JsValue, field: ModelCoordinate) -> Result<JsValue, JsValue> {
		self.0.coordinate(value, field as u32)
	}
	fn compare(
		&self,
		operation: ModelComparison,
		first: &JsValue,
		second: &JsValue,
	) -> Result<bool, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(match operation {
				ModelComparison::Equal => first == second,
				ModelComparison::Below => first < second,
				ModelComparison::Above => first > second,
				ModelComparison::AtMost => first <= second,
				ModelComparison::AtLeast => first >= second,
			});
		}
		self.0.compare(operation as u32, first, second)
	}
	fn add(&self, value: &JsValue, amount: f64) -> Result<JsValue, JsValue> {
		if let Some(value) = value.as_f64() {
			return Ok(JsValue::from_f64(value + amount));
		}
		self.0.add(value, amount)
	}
	fn subtract(&self, value: &JsValue, amount: f64) -> Result<JsValue, JsValue> {
		if let Some(value) = value.as_f64() {
			return Ok(JsValue::from_f64(value - amount));
		}
		self.0.subtract(value, amount)
	}
	fn line_count(&self) -> Result<JsValue, JsValue> {
		self.0.line_count()
	}
	fn max_column(&self, line: &JsValue) -> Result<JsValue, JsValue> {
		self.0.max_column(line)
	}
	fn line_length(&self, line: &JsValue) -> Result<JsValue, JsValue> {
		self.0.line_length(line)
	}
	fn char_code(&self, line: &JsValue, index: &JsValue) -> Result<JsValue, JsValue> {
		self.0.char_code(line, index)
	}
	fn assert_alive(&self) -> Result<(), JsValue> {
		self.0.assert_alive()
	}
	fn reusable(&self, value: &JsValue, range: bool) -> Result<bool, JsValue> {
		self.0.reusable(value, range)
	}
	fn is_valid_position(
		&self,
		line: &JsValue,
		column: &JsValue,
		surrogates: bool,
	) -> Result<bool, JsValue> {
		self.0.is_valid_position(line, column, surrogates)
	}
	fn validate_position(
		&self,
		line: &JsValue,
		column: &JsValue,
		surrogates: bool,
	) -> Result<JsValue, JsValue> {
		self.0.validate_position(line, column, surrogates)
	}
	fn is_valid_range(&self, range: &JsValue, surrogates: bool) -> Result<bool, JsValue> {
		self.0.is_valid_range(range, surrogates)
	}
	fn make_position(&self, line: &JsValue, column: &JsValue) -> Result<JsValue, JsValue> {
		self.0.make_position(line, column)
	}
	fn make_range(
		&self,
		start_line: &JsValue,
		start_column: &JsValue,
		end_line: &JsValue,
		end_column: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0
			.make_range(start_line, start_column, end_line, end_column)
	}
}

/// Identifies position/range validation separately from text storage and search.
#[wasm_bindgen]
pub fn model_validation_abi_version() -> u32 {
	1
}

/// Executes a complete validation operation without retaining the model or its arguments.
#[wasm_bindgen]
pub fn run_model_validation(
	host: ValidationHost,
	operation: u32,
	first: JsValue,
	second: JsValue,
	validation_type: JsValue,
) -> Result<JsValue, JsValue> {
	let host = Host(host);
	let surrogates = validation_type.as_f64() == Some(1.0);
	match operation {
		0 => vscode_editor_core::validate_relaxed_model_range(&host, &first),
		1 => Ok(JsValue::from_bool(
			vscode_editor_core::is_valid_model_position(&host, &first, &second, surrogates)?,
		)),
		2 => vscode_editor_core::clamp_model_position(&host, &first, &second, surrogates),
		3 => vscode_editor_core::validate_model_position(&host, &first),
		4 => Ok(JsValue::from_bool(
			vscode_editor_core::is_valid_model_range(&host, &first, surrogates)?,
		)),
		5 => vscode_editor_core::validate_model_range(&host, &first),
		6 => host.0.public_is_valid_range(&first),
		_ => Err(JsValue::from_str("Unsupported model validation operation")),
	}
}
