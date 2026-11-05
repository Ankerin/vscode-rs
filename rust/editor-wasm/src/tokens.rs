/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use wasm_bindgen::prelude::*;

/// Identifies token metadata composition independently of storage and diff contracts.
#[wasm_bindgen]
pub fn tokens_abi_version() -> u32 {
	1
}

#[wasm_bindgen]
pub fn merge_semantic_tokens(
	contiguous: &[u32],
	sparse: &[u32],
	text_length: u32,
) -> Result<Option<Vec<u32>>, JsError> {
	Ok(vscode_editor_core::merge_semantic_tokens(
		contiguous,
		sparse,
		text_length,
	)?)
}
