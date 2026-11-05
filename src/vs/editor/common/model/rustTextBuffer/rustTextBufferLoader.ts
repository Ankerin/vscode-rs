/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IRustTextBufferInitialization, IRustTextBufferModule, registerRustTextBuffer } from './rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: string }): Promise<object>;
}

/** Initializes the same generated core in renderer and worker realms before models are created. */
export async function loadAndRegisterRustTextBuffer(initialization: IRustTextBufferInitialization): Promise<IDisposable> {
	const module = await import(/* webpackIgnore: true */ /* @vite-ignore */ `${initialization.moduleUrl}`) as IRustModule;
	await module.default({ module_or_path: initialization.wasmUrl });
	return registerRustTextBuffer(module, initialization);
}
