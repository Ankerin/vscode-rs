/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Scoped model reads keep text, model objects, and provider failures at their original owners.

use vscode_editor_core::{
	ModelComparison, ModelCoordinate, ModelQueryHost, ModelQueryMethod, ModelQueryOperation,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type QueryHost;
	#[wasm_bindgen(method, catch, js_name = assertAlive)]
	fn assert_alive(this: &QueryHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = fail)]
	fn fail(this: &QueryHost, heap: bool) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = method)]
	fn method(this: &QueryHost, method: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = call0)]
	fn call0(this: &QueryHost, method: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = call1)]
	fn call1(this: &QueryHost, method: &JsValue, first: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = call2)]
	fn call2(
		this: &QueryHost,
		method: &JsValue,
		first: &JsValue,
		second: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = call3)]
	fn call3(
		this: &QueryHost,
		method: &JsValue,
		first: &JsValue,
		second: &JsValue,
		third: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = coordinate)]
	fn coordinate(this: &QueryHost, value: &JsValue, field: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = compare)]
	fn compare(
		this: &QueryHost,
		operation: u32,
		first: &JsValue,
		second: &JsValue,
	) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = add)]
	fn add(this: &QueryHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = boundOffset)]
	fn bound_offset(
		this: &QueryHost,
		length: &JsValue,
		offset: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = length)]
	fn length(this: &QueryHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = state)]
	fn state(this: &QueryHost, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = snapshot)]
	fn snapshot(this: &QueryHost, source: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = range)]
	fn range(this: &QueryHost, count: &JsValue, max_column: &JsValue) -> Result<JsValue, JsValue>;
}

struct Host(QueryHost);

impl ModelQueryHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn boolean(&self, value: bool) -> JsValue {
		JsValue::from_bool(value)
	}
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn line_feed(&self, value: &JsValue) -> bool {
		*value == JsValue::from_str("\n")
	}
	fn method(&self, method: ModelQueryMethod) -> Result<JsValue, JsValue> {
		self.0.method(method as u32)
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
	fn add(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
			return Ok(JsValue::from_f64(first + second));
		}
		self.0.add(first, second)
	}
	fn bound_offset(&self, length: &JsValue, offset: &JsValue) -> Result<JsValue, JsValue> {
		if let (Some(length), Some(offset)) = (length.as_f64(), offset.as_f64()) {
			return Ok(JsValue::from_f64(vscode_editor_core::bound_model_offset(
				length, offset,
			)));
		}
		self.0.bound_offset(length, offset)
	}
	fn assert_alive(&self) -> Result<(), JsValue> {
		self.0.assert_alive()
	}
	fn fail(&self, heap: bool) -> Result<JsValue, JsValue> {
		self.0.fail(heap)
	}
	fn call0(&self, method: &JsValue) -> Result<JsValue, JsValue> {
		self.0.call0(method)
	}
	fn call1(&self, method: &JsValue, first: &JsValue) -> Result<JsValue, JsValue> {
		self.0.call1(method, first)
	}
	fn call2(
		&self,
		method: &JsValue,
		first: &JsValue,
		second: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0.call2(method, first, second)
	}
	fn call3(
		&self,
		method: &JsValue,
		first: &JsValue,
		second: &JsValue,
		third: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0.call3(method, first, second, third)
	}
	fn length(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.length(value)
	}
	fn state(&self, index: u32) -> Result<JsValue, JsValue> {
		self.0.state(index)
	}
	fn snapshot(&self, source: &JsValue) -> Result<JsValue, JsValue> {
		self.0.snapshot(source)
	}
	fn range(&self, count: &JsValue, max_column: &JsValue) -> Result<JsValue, JsValue> {
		self.0.range(count, max_column)
	}
}

/// Identifies the complete model-read control contract.
#[wasm_bindgen]
pub fn model_query_abi_version() -> u32 {
	1
}

/// Returns the original text, object, or scalar result and releases every scoped host reference.
#[wasm_bindgen]
pub fn run_model_query(
	host: QueryHost,
	operation: u32,
	first: JsValue,
	second: JsValue,
	preserve_bom: JsValue,
) -> Result<JsValue, JsValue> {
	let operation = match operation {
		0 => ModelQueryOperation::Offset,
		1 => ModelQueryOperation::Position,
		2 => ModelQueryOperation::Value,
		3 => ModelQueryOperation::ValueLength,
		4 => ModelQueryOperation::RangeValue,
		5 => ModelQueryOperation::RangeLength,
		6 => ModelQueryOperation::CharacterCount,
		7 => ModelQueryOperation::LineCount,
		8 => ModelQueryOperation::LineContent,
		9 => ModelQueryOperation::LineLength,
		10 => ModelQueryOperation::Lines,
		11 => ModelQueryOperation::Eol,
		12 => ModelQueryOperation::EndSequence,
		13 => ModelQueryOperation::MinColumn,
		14 => ModelQueryOperation::MaxColumn,
		15 => ModelQueryOperation::FirstNonWhitespace,
		16 => ModelQueryOperation::LastNonWhitespace,
		17 => ModelQueryOperation::ModifyPosition,
		18 => ModelQueryOperation::FullRange,
		19 => ModelQueryOperation::DominatedByLongLines,
		20 => ModelQueryOperation::Snapshot,
		21 => ModelQueryOperation::Version,
		22 => ModelQueryOperation::AlternativeVersion,
		23 => ModelQueryOperation::InitialSnapshot,
		24 => ModelQueryOperation::Rtl,
		25 => ModelQueryOperation::UnusualTerminators,
		26 => ModelQueryOperation::NonBasicAscii,
		_ => return Err(JsValue::from_str("Unsupported model query operation")),
	};
	vscode_editor_core::query_model(
		&Host(host),
		operation,
		&first,
		&second,
		preserve_bom.is_truthy(),
	)
}
