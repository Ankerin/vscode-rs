/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Shared host-array operations retain existing slice/concat identities without per-slot transfers.

use js_sys::Array;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	type TokenArray;
	#[wasm_bindgen(method, js_name = concat)]
	fn concat_parts(this: &TokenArray, middle: &Array, after: &Array) -> Array;
}

/// Creates the same independent index as the existing array-insertion utility.
pub(crate) fn insert(array: &Array, index: u32, values: &Array) -> Array {
	let before = array.slice(0, index);
	let after = array.slice(index, array.length());
	before
		.unchecked_ref::<TokenArray>()
		.concat_parts(values, &after)
}
