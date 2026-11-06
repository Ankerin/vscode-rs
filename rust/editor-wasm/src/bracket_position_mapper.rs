/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Edit mapping retains caught host operations and immediately consumed native results.

use crate::bracket_trees::WasmBracketTreeResult;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type MapperHost;
	#[wasm_bindgen(method, catch, js_name = add)]
	fn add(this: &MapperHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = subtract)]
	fn subtract(this: &MapperHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = equal)]
	fn equal(this: &MapperHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = component)]
	fn component(this: &MapperHost, coordinate: &JsValue, column: bool)
	-> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = delta)]
	fn delta(this: &MapperHost, field: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = setDelta)]
	fn set_delta(this: &MapperHost, field: u32, value: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = pack)]
	fn pack(this: &MapperHost, line: &JsValue, column: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = parts)]
	fn parts(this: &MapperHost, offset: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = hasNextEdit)]
	fn has_next_edit(this: &MapperHost) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = nextEdit)]
	fn next_edit(this: &MapperHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = editExists)]
	fn edit_exists(this: &MapperHost, edit: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = editCoordinate)]
	fn edit_coordinate(this: &MapperHost, edit: &JsValue, field: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = translateEdit)]
	fn translate_edit(this: &MapperHost, edit: &JsValue, field: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = incrementEdit)]
	fn increment_edit(this: &MapperHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = lessEqual)]
	fn less_equal(this: &MapperHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = isNull)]
	fn is_null(this: &MapperHost, offset: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = distance)]
	fn distance(this: &MapperHost, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue>;
}

struct Host(MapperHost);

impl vscode_editor_core::BracketPositionMapperHost for Host {
	type Value = JsValue;
	type Coordinate = JsValue;
	type Edit = JsValue;
	type Error = JsValue;

	fn number(&self, value: &JsValue) -> Option<f64> {
		value.as_f64()
	}
	fn value(&self, number: f64) -> JsValue {
		JsValue::from_f64(number)
	}
	fn add(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		self.0.add(first, second)
	}
	fn subtract(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		self.0.subtract(first, second)
	}
	fn equal(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		self.0.equal(first, second)
	}
	fn component(&self, coordinate: &JsValue, column: bool) -> Result<JsValue, JsValue> {
		self.0.component(coordinate, column)
	}
	fn delta(&self, field: u32) -> Result<JsValue, JsValue> {
		self.0.delta(field)
	}
	fn set_delta(&self, field: u32, value: &JsValue) -> Result<(), JsValue> {
		self.0.set_delta(field, value)
	}
	fn pack(&self, line: &JsValue, column: &JsValue) -> Result<JsValue, JsValue> {
		self.0.pack(line, column)
	}
	fn parts(&self, offset: &JsValue) -> Result<JsValue, JsValue> {
		self.0.parts(offset)
	}
	fn has_next_edit(&self) -> Result<bool, JsValue> {
		self.0.has_next_edit()
	}
	fn next_edit(&self) -> Result<JsValue, JsValue> {
		self.0.next_edit()
	}
	fn edit_exists(&self, edit: &JsValue) -> Result<bool, JsValue> {
		self.0.edit_exists(edit)
	}
	fn edit_coordinate(&self, edit: &JsValue, field: u32) -> Result<JsValue, JsValue> {
		self.0.edit_coordinate(edit, field)
	}
	fn translate_edit(&self, edit: &JsValue, field: u32) -> Result<JsValue, JsValue> {
		self.0.translate_edit(edit, field)
	}
	fn increment_edit(&self) -> Result<(), JsValue> {
		self.0.increment_edit()
	}
	fn less_equal(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		self.0.less_equal(first, second)
	}
	fn is_null(&self, offset: &JsValue) -> Result<bool, JsValue> {
		self.0.is_null(offset)
	}
	fn distance(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsValue> {
		self.0.distance(first, second)
	}
}

/// Versions live edit cursor transitions independently of packed length arithmetic.
#[wasm_bindgen]
pub fn bracket_position_mapper_abi_version() -> u32 {
	1
}

/// Translates an old coordinate without replacing the original object or provider callbacks.
#[wasm_bindgen]
pub fn translate_bracket_old_offset(
	host: MapperHost,
	coordinate: JsValue,
) -> Result<WasmBracketTreeResult, JsValue> {
	let offset = vscode_editor_core::translate_bracket_old_offset(&Host(host), &coordinate)?;
	Ok(WasmBracketTreeResult::new(offset))
}

/// Translates a current offset while retaining original exceptional arithmetic semantics.
#[wasm_bindgen]
pub fn translate_bracket_current_offset(
	host: MapperHost,
	offset: JsValue,
) -> Result<WasmBracketTreeResult, JsValue> {
	let offset = vscode_editor_core::translate_bracket_current_offset(&Host(host), &offset)?;
	Ok(WasmBracketTreeResult::new(offset))
}

/// Commits each completed edit's cursor and delta fields through their original owner.
#[wasm_bindgen]
pub fn adjust_bracket_position_mapper(host: MapperHost, offset: JsValue) -> Result<bool, JsValue> {
	vscode_editor_core::adjust_bracket_position_mapper(&Host(host), &offset)?;
	Ok(true)
}

/// Resolves the next change after the original adjustment dispatch, without replaying state.
#[wasm_bindgen]
pub fn distance_to_bracket_change(
	host: MapperHost,
	offset: JsValue,
) -> Result<WasmBracketTreeResult, JsValue> {
	let distance = vscode_editor_core::distance_to_bracket_change(&Host(host), &offset)?;
	Ok(WasmBracketTreeResult::new(
		distance.unwrap_or(JsValue::NULL),
	))
}
