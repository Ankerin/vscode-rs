/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { IRange, Range } from '../core/range.js';
import type { SparseLineTokens, SparseMultilineTokens } from './sparseMultilineTokens.js';
import type { ContiguousMultilineTokens } from './contiguousMultilineTokens.js';

/** Generated metadata composition bindings; source arrays retain their existing ownership. */
export interface IRustTokensModule {
	tokens_abi_version(): number;
	merge_semantic_tokens(contiguous: Uint32Array, sparse: Uint32Array, textLength: number): Uint32Array | undefined;
	update_sparse_tokens(tokens: Uint32Array, parameters: Float64Array): Float64Array | undefined;
	split_sparse_tokens(tokens: Uint32Array, parameters: Float64Array): Uint32Array | undefined;
	update_contiguous_tokens(tokens: Uint32Array, operation: number, first: number, second: number): number | undefined;
	append_contiguous_tokens(first: Uint32Array, second: Uint32Array): Uint32Array | undefined;
	edit_contiguous_tokens_block(start: number, lines: (Uint32Array | ArrayBuffer | null)[], empty: ArrayBuffer, parameters: Float64Array): [number, (Uint32Array | ArrayBuffer | null)[]] | undefined;
	contiguous_token_blocks_size(blocks: ContiguousMultilineTokens[], standardSize: () => number, standardWrite: (destination: Uint8Array, offset: number) => number, includeCount: boolean): number | undefined;
	serialize_contiguous_token_blocks(blocks: ContiguousMultilineTokens[], standardSize: () => number, standardWrite: (destination: Uint8Array, offset: number) => number, destination: Uint8Array, offset: number, includeCount: boolean): number | undefined;
	encode_contiguous_token_blocks(blocks: ContiguousMultilineTokens[], standardSize: () => number, standardWrite: (destination: Uint8Array, offset: number) => number): Uint8Array | undefined;
	decode_contiguous_token_blocks(source: Uint8Array, offset: number, includeCount: boolean): [number, [number, Uint32Array[]][]] | undefined;
	WasmContiguousTokensStore: { new(empty: ArrayBuffer): IRustContiguousTokensStore };
	WasmSparseTokensStore: { new(standardEdit?: SparseMultilineTokens['acceptEdit']): IRustSparseTokensStore };
}

/** Owns sparse piece orchestration while retaining the original array and piece objects. */
export interface IRustSparseTokensStore {
	flush(): void;
	is_empty(): boolean;
	is_complete(): boolean;
	set_pieces(pieces: SparseMultilineTokens[], complete: boolean): boolean;
	export_pieces(): SparseMultilineTokens[];
	get_line_tokens(line: number): SparseLineTokens | null;
	set_partial(range: Range, pieces: SparseMultilineTokens[]): Range | undefined;
	accept_edit(range: IRange, eolCount: number, firstLength: number, lastLength: number, firstCode: number): boolean;
	free(): void;
}

/** Owns the line index; encoded buffers retain existing externally mutable references. */
export interface IRustContiguousTokensStore {
	has_tokens(): boolean;
	flush(): void;
	get_tokens(index: number): Uint32Array | ArrayBuffer | null;
	set_tokens(language: number, index: number, textLength: number, tokens: Uint32Array | ArrayBuffer | null, checkEquality: boolean): boolean | undefined;
	accept_edit(parameters: Float64Array): boolean;
	export_lines(): (Uint32Array | ArrayBuffer | null)[];
	free(): void;
}

let registeredModule: IRustTokensModule | undefined;

/** Installs token composition for the initialized core's disposable scope. */
export function registerRustTokens(module: IRustTokensModule): IDisposable {
	if (typeof module.tokens_abi_version !== 'function' || module.tokens_abi_version() !== 7 || typeof module.merge_semantic_tokens !== 'function' || typeof module.update_sparse_tokens !== 'function' || typeof module.split_sparse_tokens !== 'function' || typeof module.update_contiguous_tokens !== 'function' || typeof module.append_contiguous_tokens !== 'function' || typeof module.edit_contiguous_tokens_block !== 'function' || typeof module.contiguous_token_blocks_size !== 'function' || typeof module.serialize_contiguous_token_blocks !== 'function' || typeof module.encode_contiguous_token_blocks !== 'function' || typeof module.decode_contiguous_token_blocks !== 'function' || typeof module.WasmContiguousTokensStore !== 'function' || typeof module.WasmSparseTokensStore !== 'function') {
		throw new Error('The Rust token bindings do not match the current metadata contract');
	}
	if (registeredModule) { throw new Error('A Rust token module is already registered'); }
	registeredModule = module;
	return toDisposable(() => {
		if (registeredModule === module) { registeredModule = undefined; }
	});
}

/** The caller immediately registers the owning store's generated free method for disposal. */
export function createRustContiguousTokensStore(empty: ArrayBuffer): IRustContiguousTokensStore | undefined {
	return registeredModule ? new registeredModule.WasmContiguousTokensStore(empty) : undefined;
}

/** The caller registers the generated native owner for its own disposable scope. */
export function createRustSparseTokensStore(standardEdit: SparseMultilineTokens['acceptEdit']): IRustSparseTokensStore | undefined {
	return registeredModule ? new registeredModule.WasmSparseTokensStore(standardEdit) : undefined;
}

/** Adjusts block coordinates and the original line-array references in one native edit scope. */
export function tryEditRustContiguousTokenBlock(start: number, lines: (Uint32Array | ArrayBuffer | null)[], empty: ArrayBuffer, range: IRange, eolCount: number, firstLength: number): [number, (Uint32Array | ArrayBuffer | null)[]] | undefined {
	if (!registeredModule) { return undefined; }
	const result = registeredModule.edit_contiguous_tokens_block(start, lines, empty, new Float64Array([range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn, eolCount, firstLength]));
	if (result && (result.length !== 2 || !Number.isSafeInteger(result[0]) || !Array.isArray(result[1]))) { throw new Error('The Rust contiguous token block result does not match the editor contract'); }
	return result;
}

/** Retains original errors and subview behavior when native serialization is unsupported. */
export function trySizeRustTokenBlocks(blocks: ContiguousMultilineTokens[], size: () => number, write: (destination: Uint8Array, offset: number) => number, includeCount: boolean): number | undefined {
	const result = registeredModule?.contiguous_token_blocks_size(blocks, size, write, includeCount);
	if (result !== undefined && (!Number.isSafeInteger(result) || result < 0)) { throw new Error('The Rust token serialization size does not match the editor contract'); }
	return result;
}

/** Writes directly into the existing destination after preflighting the complete supported stream. */
export function trySerializeRustTokenBlocks(blocks: ContiguousMultilineTokens[], size: () => number, write: (destination: Uint8Array, offset: number) => number, destination: Uint8Array, offset: number, includeCount: boolean): number | undefined {
	const result = registeredModule?.serialize_contiguous_token_blocks(blocks, size, write, destination, offset, includeCount);
	if (result !== undefined && (!Number.isSafeInteger(result) || result < offset || result > destination.length)) { throw new Error('The Rust token serialization result does not match the editor contract'); }
	return result;
}

/** Produces the existing serialized byte array without a second persistent/native encoded copy. */
export function tryEncodeRustTokenBlocks(blocks: ContiguousMultilineTokens[], size: () => number, write: (destination: Uint8Array, offset: number) => number): Uint8Array | undefined {
	const result = registeredModule?.encode_contiguous_token_blocks(blocks, size, write);
	if (result && !(result instanceof Uint8Array)) { throw new Error('The Rust token serialization bytes do not match the editor contract'); }
	return result;
}

/** Returns existing source views; malformed/subview streams keep the original permissive decoder. */
export function tryDecodeRustTokenBlocks(source: Uint8Array, offset: number, includeCount: boolean): [number, [number, Uint32Array[]][]] | undefined {
	const result = registeredModule?.decode_contiguous_token_blocks(source, offset, includeCount);
	if (result && (result.length !== 2 || !Number.isSafeInteger(result[0]) || result[0] < offset || result[0] > source.length || !Array.isArray(result[1]) || (!includeCount && result[1].length !== 1) || result[1].some(block => !Array.isArray(block) || block.length !== 2 || !Number.isSafeInteger(block[0]) || block[0] < 0 || block[0] > 0xFFFFFFFF || !Array.isArray(block[1])))) {
		throw new Error('The Rust token deserialization result does not match the editor contract');
	}
	return result;
}

/** Retains source identity while returning the native surviving length or shared-empty sentinel. */
export function tryUpdateRustContiguousTokens(tokens: Uint32Array, operation: number, first: number, second: number): number | undefined {
	if (!registeredModule || tokens.length === 0 || tokens.length % 2 !== 0 || tokens.length > 4 * 1024 * 1024 || ![first, second].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 2 ** 40)) { return undefined; }
	const result = registeredModule.update_contiguous_tokens(tokens, operation, first, second);
	if (result === undefined) { return undefined; }
	if (!Number.isSafeInteger(result) || (result !== -1 && (result < 0 || result % 2 !== 0 || result > tokens.length))) {
		throw new Error('The Rust contiguous token result does not match the editor contract');
	}
	return result;
}

/** Creates an independent concatenated encoding with the original metadata and wrapping rules. */
export function tryAppendRustContiguousTokens(first: Uint32Array, second: Uint32Array): Uint32Array | undefined {
	if (!registeredModule || first.length === 0 || first.length % 2 !== 0 || second.length % 2 !== 0 || first.length + second.length > 4 * 1024 * 1024) { return undefined; }
	const result = registeredModule.append_contiguous_tokens(first, second);
	if (result && result.length !== first.length + second.length) { throw new Error('The Rust contiguous token append does not match the editor contract'); }
	return result;
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
