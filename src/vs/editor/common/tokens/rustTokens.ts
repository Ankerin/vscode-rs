/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';

/** Generated metadata composition bindings; source arrays retain their existing ownership. */
export interface IRustTokensModule {
	tokens_abi_version(): number;
	merge_semantic_tokens(contiguous: Uint32Array, sparse: Uint32Array, textLength: number): Uint32Array | undefined;
}

let registeredModule: IRustTokensModule | undefined;

/** Installs token composition for the initialized core's disposable scope. */
export function registerRustTokens(module: IRustTokensModule): IDisposable {
	if (typeof module.tokens_abi_version !== 'function' || module.tokens_abi_version() !== 1 || typeof module.merge_semantic_tokens !== 'function') {
		throw new Error('The Rust token bindings do not match the current metadata contract');
	}
	if (registeredModule) { throw new Error('A Rust token module is already registered'); }
	registeredModule = module;
	return toDisposable(() => {
		if (registeredModule === module) { registeredModule = undefined; }
	});
}

/** Borrows existing encoding views and retains unsupported arrays on the original path. */
export function tryMergeRustSemanticTokens(contiguous: Uint32Array, sparse: Uint32Array, textLength: number): Uint32Array | undefined {
	if (!registeredModule || contiguous.length % 2 !== 0 || sparse.length % 4 !== 0 || !Number.isSafeInteger(textLength) || textLength < 0 || textLength > 0xFFFFFFFF) {
		return undefined;
	}
	const result = registeredModule.merge_semantic_tokens(contiguous, sparse, textLength);
	if (!result) { return undefined; }
	if (result.length % 2 !== 0 || (result.length > 1 ? result[result.length - 2] : 0) !== textLength) {
		throw new Error('The Rust token result does not match the current metadata contract');
	}
	return result;
}
