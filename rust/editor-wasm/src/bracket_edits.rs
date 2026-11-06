/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Queued bracket edit composition transfers bounded prepared mappings, never model text.

use wasm_bindgen::prelude::*;

/// Versions queued bracket-tree edit composition independently of storage and decorations.
#[wasm_bindgen]
pub fn bracket_edits_abi_version() -> u32 {
	1
}

/// Composes existing prepared mappings and retains plain versus merged edit result shapes.
#[wasm_bindgen]
pub fn combine_bracket_edits(first: &[f64], second: &[f64]) -> Option<Vec<f64>> {
	let (first, first_tail) = first.as_chunks::<3>();
	let (second, second_tail) = second.as_chunks::<3>();
	if !first_tail.is_empty() || !second_tail.is_empty() {
		return None;
	}
	let records = vscode_editor_core::combine_bracket_edits(first, second)?;
	let mut result = Vec::new();
	result.try_reserve_exact(records.len() * 4).ok()?;
	result.extend(records.into_iter().flatten());
	Some(result)
}
