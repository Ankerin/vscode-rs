/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IDisposable } from '../../src/vs/base/common/lifecycle.js';
import { IRustTextBufferModule } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

interface IStorageModule {
	registerRustTextBuffer(module: IRustTextBufferModule): IDisposable;
}

// Load the same compiled adapter as the canonical unit runner, avoiding a second module registry.
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const bindingUrl = pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href;
const storageUrl = pathToFileURL(resolve(directory, 'rustTextBuffer.js')).href;
const rust = await import(bindingUrl) as IRustModule;
const storage = await import(storageUrl) as IStorageModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });
const registration = storage.registerRustTextBuffer(rust);
process.on('exit', () => registration.dispose());
