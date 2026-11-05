/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { IRange } from '../core/range.js';

/** Generated metadata composition bindings; source arrays retain their existing ownership. */
export interface IRustTokensModule {
	tokens_abi_version(): number;
	merge_semantic_tokens(contiguous: Uint32Array, sparse: Uint32Array, textLength: number): Uint32Array | undefined;
	update_sparse_tokens(tokens: Uint32Array, parameters: Float64Array): Float64Array | undefined;
	split_sparse_tokens(tokens: Uint32Array, parameters: Float64Array): Uint32Array | undefined;
}

let registeredModule: IRustTokensModule | undefined;

/** Installs token composition for the initialized core's disposable scope. */
export function registerRustTokens(module: IRustTokensModule): IDisposable {
	if (typeof module.tokens_abi_version !== 'function' || module.tokens_abi_version() !== 2 || typeof module.merge_semantic_tokens !== 'function' || typeof module.update_sparse_tokens !== 'function' || typeof module.split_sparse_tokens !== 'function') {
		throw new Error('The Rust token bindings do not match the current metadata contract');
	}
	if (registeredModule) { throw new Error('A Rust token module is already registered'); }
	registeredModule = module;
	return toDisposable(() => {
		if (registeredModule === module) { registeredModule = undefined; }
	});
}

/** Updates existing arrays without changing their ownership or the observable inactive suffix. */
function tryUpdateSparseTokens(tokens: Uint32Array, count: number, parameters: number[]): Float64Array | undefined {
	if (!registeredModule || !Number.isSafeInteger(count) || count < 0 || count * 4 > tokens.length || count * 4 > 4 * 1024 * 1024 || !parameters.every(value => Number.isSafeInteger(value) && Math.abs(value) <= 2 ** 40)) {
		return undefined;
	}
	const result = registeredModule.update_sparse_tokens(tokens.subarray(0, count * 4), new Float64Array(parameters));
	if (!result) { return undefined; }
	if (result.length !== 2 || !Number.isSafeInteger(result[0]) || result[0] < 0 || result[0] > count || !Number.isSafeInteger(result[1])) {
		throw new Error('The Rust sparse token result does not match the editor contract');
	}
	return result;
}

/** Removes touching tokens and returns active count and the first surviving line delta. */
export function tryRemoveRustSparseTokens(tokens: Uint32Array, count: number, startLine: number, startChar: number, endLine: number, endChar: number): Float64Array | undefined {
	return tryUpdateSparseTokens(tokens, count, [0, startLine, startChar, endLine, endChar]);
}

/** Adjusts a complete block for deletion and insertion with a single source transfer. */
export function tryEditRustSparseTokens(tokens: Uint32Array, count: number, blockStart: number, range: IRange, eolCount: number, firstLineLength: number, lastLineLength: number, firstCharCode: number): Float64Array | undefined {
	return tryUpdateSparseTokens(tokens, count, [1, blockStart, range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn, eolCount, firstLineLength, lastLineLength, firstCharCode]);
}

/** Splits into independent encodings while retaining the second block's line delta. */
export function trySplitRustSparseTokens(tokens: Uint32Array, count: number, startLine: number, startChar: number, endLine: number, endChar: number): { first: Uint32Array; second: Uint32Array; deltaLine: number } | undefined {
	const parameters = [startLine, startChar, endLine, endChar];
	if (!registeredModule || !Number.isSafeInteger(count) || count < 0 || count * 4 > tokens.length || count * 4 + 2 > 4 * 1024 * 1024 || !parameters.every(value => Number.isSafeInteger(value) && Math.abs(value) <= 2 ** 40)) { return undefined; }
	const result = registeredModule.split_sparse_tokens(tokens.subarray(0, count * 4), new Float64Array(parameters));
	if (!result) { return undefined; }
	if (result.length < 2 || (result.length - 2) % 4 !== 0 || result[0] % 4 !== 0 || result[0] > result.length - 2) {
		throw new Error('The Rust sparse token split does not match the editor contract');
	}
	return { first: result.slice(2, 2 + result[0]), second: result.slice(2 + result[0]), deltaLine: result[1] };
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
