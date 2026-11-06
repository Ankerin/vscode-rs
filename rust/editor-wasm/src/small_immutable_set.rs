/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket-set queries borrow only required host words; mutations return one bounded result.

use js_sys::Function;
use wasm_bindgen::prelude::*;

/// Versions immutable bracket-set operations independently of packed lengths and edit composition.
#[wasm_bindgen]
pub fn small_set_abi_version() -> u32 {
	1
}

/// Adds a key without retaining a persistent second encoding of the original set.
#[wasm_bindgen]
pub fn small_set_add(
	word: f64,
	key: f64,
	length: u32,
	reader: Function,
) -> Result<Option<Vec<f64>>, JsValue> {
	let mut failure = None;
	let result = vscode_editor_core::small_set_add(word, key, length as usize, |index| {
		read(&reader, false, index as i32, &mut failure)
	});
	if let Some(failure) = failure {
		return Err(failure);
	}
	Ok(result)
}

/// Merges the original complete word spans, preserving trailing zero words.
#[wasm_bindgen]
pub fn small_set_merge(
	first: f64,
	second: f64,
	first_length: u32,
	second_length: u32,
	reader: Function,
) -> Result<Option<Vec<f64>>, JsValue> {
	let mut failure = None;
	let result = vscode_editor_core::small_set_merge(
		first,
		second,
		first_length as usize,
		second_length as usize,
		|second, index| read(&reader, second, index as i32, &mut failure),
	);
	if let Some(failure) = failure {
		return Err(failure);
	}
	Ok(result)
}

/// Membership and intersection short circuits do not transfer or scan unrelated words.
#[wasm_bindgen]
pub fn small_set_query(
	operation: u32,
	first: f64,
	second: f64,
	key: f64,
	first_length: u32,
	second_length: u32,
	reader: Function,
) -> Result<Option<bool>, JsValue> {
	let mut failure = None;
	let result = vscode_editor_core::small_set_query(
		operation,
		first,
		second,
		key,
		first_length as usize,
		second_length as usize,
		|second, index| read(&reader, second, index, &mut failure),
	);
	if let Some(failure) = failure {
		return Err(failure);
	}
	Ok(result)
}

fn read(reader: &Function, second: bool, index: i32, failure: &mut Option<JsValue>) -> Option<f64> {
	match reader.call2(
		&JsValue::UNDEFINED,
		&JsValue::from_bool(second),
		&JsValue::from_f64(f64::from(index)),
	) {
		Ok(value) => value.as_f64(),
		Err(error) => {
			*failure = Some(error);
			None
		}
	}
}
