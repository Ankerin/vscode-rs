/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Decoration marker edits return only the original node's two updated endpoints.

use wasm_bindgen::prelude::*;

/// Versions the historical decoration marker contract independently of text storage.
#[wasm_bindgen]
pub fn decorations_abi_version() -> u32 {
	1
}

/// Retains metadata bit masks, floating-point domains, collapse behavior, and marker affinity.
#[wasm_bindgen]
pub fn decoration_accept_edit(
	metadata: u32,
	node_start: f64,
	node_end: f64,
	start: f64,
	end: f64,
	text_length: f64,
	force_move: bool,
) -> Vec<f64> {
	vscode_editor_core::decoration_accept_edit(
		metadata,
		node_start,
		node_end,
		start,
		end,
		text_length,
		force_move,
	)
	.to_vec()
}
