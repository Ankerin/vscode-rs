/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Scalar bracket lengths share the same native arithmetic as queued edit composition.

use wasm_bindgen::prelude::*;

/// Versions packed-coordinate arithmetic independently of edit composition and storage.
#[wasm_bindgen]
pub fn bracket_lengths_abi_version() -> u32 {
	1
}

/// Retains fractional, exceptional, negative, and signed-zero numeric domains.
#[wasm_bindgen]
pub fn bracket_length(
	operation: u32,
	first: f64,
	second: f64,
	third: f64,
	fourth: f64,
) -> Option<f64> {
	vscode_editor_core::bracket_length(operation, first, second, third, fourth)
}

/// Returns line/column coordinates for the original Position, Range, and TextLength construction.
#[wasm_bindgen]
pub fn bracket_length_parts(length: f64) -> Vec<f64> {
	vscode_editor_core::bracket_length_parts(length).to_vec()
}
