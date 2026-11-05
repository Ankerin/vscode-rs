/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../base/common/lifecycle.js';
import { FileAccess } from '../../../base/common/network.js';
import { loadAndRegisterRustTextBuffer } from '../../common/model/rustTextBuffer/rustTextBufferLoader.js';

/** Loads the generated bindings before desktop workbench restoration creates document models. */
export async function loadRustTextBuffer(): Promise<IDisposable> {
	const directory = 'vs/editor/common/model/rustTextBuffer';
	const moduleUrl = FileAccess.asBrowserUri(`${directory}/vscode_editor_wasm.js`).toString(true);
	const wasmUrl = FileAccess.asBrowserUri(`${directory}/vscode_editor_wasm_bg.wasm`).toString(true);
	return loadAndRegisterRustTextBuffer({ moduleUrl, wasmUrl });
}
