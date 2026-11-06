/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Cursor queries borrow primitive host strings and preserve every UTF-16 code unit.

use js_sys::JsString;
use vscode_editor_core::CursorColumnOperation;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	type Text;
	#[wasm_bindgen(method, catch, js_name = charCodeAt)]
	fn character(this: &Text, offset: u32) -> Result<f64, JsValue>;
}

/// Versions cursor arithmetic and the repository's exact grapheme and width contracts.
#[wasm_bindgen]
pub fn cursor_columns_abi_version() -> u32 {
	2
}

/// Traverses only requested units without transferring or retaining a second full line.
#[wasm_bindgen]
pub fn cursor_column(
	text: JsString,
	column: f64,
	tab_size: f64,
	operation: u32,
) -> Result<Option<f64>, JsValue> {
	if text.length() > 4 * 1024 * 1024 {
		return Ok(None);
	}
	let operation = match operation {
		0 => CursorColumnOperation::VisibleFromColumn,
		1 => CursorColumnOperation::StatusbarColumn,
		2 => CursorColumnOperation::ColumnFromVisible,
		_ => return Ok(None),
	};
	let result = vscode_editor_core::cursor_column(
		text.length() as usize,
		column,
		tab_size,
		operation,
		|offset| {
			text.unchecked_ref::<Text>()
				.character(offset as u32)
				.map(|value| value as u16)
		},
	)?;
	Ok(Some(result))
}

/// Computes render/indent stops with the same floating-point and signed-zero rules.
#[wasm_bindgen]
pub fn cursor_tab_stop(column: f64, size: f64, previous: bool) -> f64 {
	if previous {
		vscode_editor_core::previous_cursor_tab_stop(column, size)
	} else {
		vscode_editor_core::next_cursor_tab_stop(column, size)
	}
}

/// Returns the three original indentation coordinates using borrowed host units.
#[wasm_bindgen]
pub fn cursor_whitespace_column(
	text: JsString,
	position: f64,
	tab_size: f64,
) -> Result<Option<Vec<f64>>, JsValue> {
	if text.length() > 4 * 1024 * 1024 {
		return Ok(None);
	}
	let result = vscode_editor_core::whitespace_visible_column(
		text.length() as usize,
		position,
		tab_size,
		|offset| {
			text.unchecked_ref::<Text>()
				.character(offset as u32)
				.map(|value| value as u16)
		},
	)?;
	Ok(Some(result.to_vec()))
}

/// Traverses initial indentation and rejects partial stops before returning an atomic position.
#[wasm_bindgen]
pub fn cursor_atomic_position(
	text: JsString,
	position: f64,
	tab_size: f64,
	direction: f64,
) -> Result<Option<f64>, JsValue> {
	if text.length() > 4 * 1024 * 1024 {
		return Ok(None);
	}
	let result = vscode_editor_core::atomic_tab_position(
		text.length() as usize,
		position,
		tab_size,
		direction,
		|offset| {
			text.unchecked_ref::<Text>()
				.character(offset as u32)
				.map(|value| value as u16)
		},
	)?;
	Ok(Some(result))
}

/// Exposes the exact classification contract for exhaustive differential validation.
#[wasm_bindgen]
pub fn grapheme_break_type(point: u32) -> Option<u32> {
	vscode_editor_core::grapheme_break_type(point)
}
