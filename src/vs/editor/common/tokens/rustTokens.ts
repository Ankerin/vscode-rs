/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { IRange, Range } from '../core/range.js';
import { OffsetRange } from '../core/ranges/offsetRange.js';
import { decodeUTF16, encodeUTF16 } from '../core/utf16Transfer.js';
import type { LineTokens, TokenInfo } from './lineTokens.js';
import type { TokenWithTextInfo } from './tokenWithTextArray.js';
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
	line_token_index(tokens: Uint32Array, desired: number): number | undefined;
	line_token_slice_info(tokens: Uint32Array, start: number, end: number): Float64Array | undefined;
	convert_line_token_offsets(tokens: Uint32Array, length: number): boolean;
	line_tokens_equal(first: Uint32Array, second: Uint32Array, from: number, count: number): boolean | undefined;
	line_tokens_in_range(tokens: Uint32Array, start: number, end: number): Float64Array | undefined;
	insert_line_tokens(tokens: Uint32Array, text: Uint16Array, insertedText: Uint16Array, parameters: Float64Array): [Uint32Array, Uint16Array] | undefined;
	line_token_array(tokens: Uint32Array, textLength: number, text: boolean): Float64Array | undefined;
	slice_token_array(lengths: Float64Array, start: number, end: number): Float64Array | undefined;
	create_line_tokens(data: { text: string; metadata: number }[]): [Uint32Array, string] | undefined;
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
const standardArrayIterator = Array.prototype[Symbol.iterator];

/** Installs token composition for the initialized core's disposable scope. */
export function registerRustTokens(module: IRustTokensModule): IDisposable {
	if (typeof module.tokens_abi_version !== 'function' || module.tokens_abi_version() !== 9 || typeof module.merge_semantic_tokens !== 'function' || typeof module.update_sparse_tokens !== 'function' || typeof module.split_sparse_tokens !== 'function' || typeof module.update_contiguous_tokens !== 'function' || typeof module.append_contiguous_tokens !== 'function' || typeof module.edit_contiguous_tokens_block !== 'function' || typeof module.contiguous_token_blocks_size !== 'function' || typeof module.serialize_contiguous_token_blocks !== 'function' || typeof module.encode_contiguous_token_blocks !== 'function' || typeof module.decode_contiguous_token_blocks !== 'function' || typeof module.line_token_index !== 'function' || typeof module.line_token_slice_info !== 'function' || typeof module.convert_line_token_offsets !== 'function' || typeof module.line_tokens_equal !== 'function' || typeof module.line_tokens_in_range !== 'function' || typeof module.insert_line_tokens !== 'function' || typeof module.line_token_array !== 'function' || typeof module.slice_token_array !== 'function' || typeof module.create_line_tokens !== 'function' || typeof module.WasmContiguousTokensStore !== 'function' || typeof module.WasmSparseTokensStore !== 'function') {
		throw new Error('The Rust token bindings do not match the current metadata contract');
	}
	if (registeredModule) { throw new Error('A Rust token module is already registered'); }
	registeredModule = module;
	return toDisposable(() => {
		if (registeredModule === module) { registeredModule = undefined; }
	});
}

/** Searches the original typed array directly without transferring a complete source stream. */
export function tryFindRustLineTokenIndex(tokens: Uint32Array, desired: number): number | undefined {
	if (!registeredModule || tokens.length % 2 !== 0 || tokens.length > 4 * 1024 * 1024 || Number.isNaN(desired)) { return undefined; }
	const result = registeredModule.line_token_index(tokens, desired);
	if (result !== undefined && (!Number.isSafeInteger(result) || result < 0 || result >= Math.max(1, tokens.length / 2))) { throw new Error('The Rust line token index does not match the editor contract'); }
	return result;
}

/** Converts end offsets through mutable copyback while keeping every provider alias. */
export function tryConvertRustLineTokenOffsets(tokens: Uint32Array, length: number): boolean {
	if (!registeredModule || tokens.length === 0 || tokens.length % 2 !== 0 || tokens.length > 4 * 1024 * 1024 || !Number.isSafeInteger(length) || Math.abs(length) > 2 ** 40) { return false; }
	return registeredModule.convert_line_token_offsets(tokens, length);
}

/** Retains cached text/count checks at the caller and delegates only the original word comparison. */
export function tryCompareRustLineTokens(first: Uint32Array, second: Uint32Array, from: number, count: number): boolean | undefined {
	if (!registeredModule || first.length === 0 || second.length === 0 || first.length > 4 * 1024 * 1024 || second.length > 4 * 1024 * 1024 || ![from, count].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 0x3FFFFFFF)) { return undefined; }
	return registeredModule.line_tokens_equal(first, second, from, count);
}

/** Keeps virtual/accessor overrides on their existing path instead of replacing their callbacks. */
function standardLineTokens(source: LineTokens, prototype: LineTokens): boolean {
	return Object.getPrototypeOf(source) === prototype && !['getCount', 'getEncodedTokens', 'findTokenIndexAtOffset', 'getStartOffset', 'getEndOffset', 'getMetadata'].some(name => Object.hasOwn(source, name));
}

/** Captures the existing slice's fixed first index and count over the current mutable encoding. */
export function trySliceRustLineTokens(source: LineTokens, prototype: LineTokens, start: number, end: number): Float64Array | undefined {
	if (!registeredModule || !standardLineTokens(source, prototype)) { return undefined; }
	const tokens = source.getEncodedTokens();
	if (tokens.length / 2 !== source.getCount()) { return undefined; }
	const result = registeredModule.line_token_slice_info(tokens, start, end);
	if (result && (result.length !== 2 || !Number.isSafeInteger(result[0]) || result[0] < 0 || result[0] > source.getCount() || !Number.isSafeInteger(result[1]) || result[1] < 0 || result[1] > source.getCount())) { throw new Error('The Rust line token slice does not match the editor contract'); }
	return result;
}

/** Extracts ordered length/metadata pairs for the existing TokenArray builder. */
export function tryExtractRustLineTokens(source: LineTokens, prototype: LineTokens, start: number, end: number): Float64Array | undefined {
	if (!registeredModule || !standardLineTokens(source, prototype)) { return undefined; }
	const tokens = source.getEncodedTokens();
	if (tokens.length === 0) { return undefined; }
	const result = registeredModule.line_tokens_in_range(tokens, start, end);
	if (result && (result.length % 2 !== 0 || Array.from(result).some(value => !Number.isSafeInteger(value) || value < 0))) { throw new Error('The Rust line token range does not match the editor contract'); }
	return result;
}

/** Packs inserted text losslessly and retains the original token ties, substring rules, and sources. */
export function tryInsertRustLineTokens(tokens: Uint32Array, count: number, text: string, inserted: { offset: number; text: string; tokenMetadata: number }[]): [Uint32Array, string] | undefined {
	if (!registeredModule || tokens.length % 2 !== 0 || tokens.length / 2 !== count || tokens.length > 4 * 1024 * 1024 || text.length > 4 * 1024 * 1024 || inserted.length > 262144) { return undefined; }
	const parameters = new Float64Array(inserted.length * 4);
	const texts: string[] = [];
	let length = 0;
	for (let index = 0; index < inserted.length; index++) {
		const item = inserted[index];
		if (!['offset', 'text', 'tokenMetadata'].every(name => Object.getOwnPropertyDescriptor(item, name)?.value !== undefined)) { return undefined; }
		if (!Number.isSafeInteger(item.offset) || Math.abs(item.offset) > 2 ** 40 || typeof item.text !== 'string' || typeof item.tokenMetadata !== 'number') { return undefined; }
		parameters.set([item.offset, length, item.text.length, item.tokenMetadata >>> 0], index * 4);
		texts.push(item.text);
		length += item.text.length;
		if (length > 4 * 1024 * 1024) { return undefined; }
	}
	const insertedText = new Uint16Array(length);
	let offset = 0;
	for (const text of texts) {
		insertedText.set(encodeUTF16(text), offset);
		offset += text.length;
	}
	const result = registeredModule.insert_line_tokens(tokens, encodeUTF16(text), insertedText, parameters);
	if (!result) { return undefined; }
	if (!Array.isArray(result) || result.length !== 2 || !(result[0] instanceof Uint32Array) || result[0].length % 2 !== 0 || !(result[1] instanceof Uint16Array) || (result[0].length > 1 ? result[0][result[0].length - 2] : 0) !== result[1].length) { throw new Error('The Rust line token insertion result does not match the editor contract'); }
	return [result[0], decodeUTF16(result[1])];
}

/** Retains original provider callbacks for subclassed or externally overridden line tokens. */
export function tryReadRustTokenArray(source: LineTokens, prototype: LineTokens, text: boolean): Float64Array | undefined {
	if (!registeredModule || !standardLineTokens(source, prototype) || ['getTextLength', 'getLineContent', 'getTokenText'].some(name => Object.hasOwn(source, name))) { return undefined; }
	const tokens = source.getEncodedTokens();
	if (tokens.length / 2 !== source.getCount()) { return undefined; }
	const result = registeredModule.line_token_array(tokens, source.getTextLength(), text);
	const stride = text ? 3 : 2;
	if (result && (result.length !== source.getCount() * stride || Array.from(result).some(value => !Number.isSafeInteger(value)))) { throw new Error('The Rust token sequence does not match the editor contract'); }
	return result;
}

/** Rejects virtual iterators, sparse/accessor slots, and accessor fields without invoking providers. */
function standardTokenSequence(items: readonly (TokenInfo | TokenWithTextInfo)[], text: boolean): boolean {
	if (Object.getPrototypeOf(items) !== Array.prototype || Object.hasOwn(items, Symbol.iterator) || Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)?.value !== standardArrayIterator || items.length > 262144) { return false; }
	for (let index = 0; index < items.length; index++) {
		const item = Object.getOwnPropertyDescriptor(items, index)?.value as TokenInfo | TokenWithTextInfo | undefined;
		if (!item || typeof Object.getOwnPropertyDescriptor(item, 'metadata')?.value !== 'number' || typeof Object.getOwnPropertyDescriptor(item, text ? 'text' : 'length')?.value !== (text ? 'string' : 'number')) { return false; }
	}
	return true;
}

/** Clips a complete sequence using its current lengths while keeping the original metadata objects. */
export function trySliceRustTokenSequence(items: readonly (TokenInfo | TokenWithTextInfo)[], range: OffsetRange, text: boolean): Float64Array | undefined {
	if (!registeredModule || !standardTokenSequence(items, text) || typeof Object.getOwnPropertyDescriptor(range, 'start')?.value !== 'number' || typeof Object.getOwnPropertyDescriptor(range, 'endExclusive')?.value !== 'number') { return undefined; }
	const lengths = new Float64Array(items.length);
	for (let index = 0; index < items.length; index++) { lengths[index] = text ? (items[index] as TokenWithTextInfo).text.length : (items[index] as TokenInfo).length; }
	const result = registeredModule.slice_token_array(lengths, range.start, range.endExclusive);
	if (result) {
		if (result.length % 4 !== 0 || result.length > items.length * 4) { throw new Error('The Rust token slice does not match the editor contract'); }
		for (let index = 0; index < result.length; index += 4) {
			if (!Number.isSafeInteger(result[index]) || result[index] < 0 || result[index] >= items.length || (index > 0 && result[index] <= result[index - 4])) { throw new Error('The Rust token slice does not match the editor contract'); }
		}
	}
	return result;
}

/** Joins primitive strings without decoding UTF-16 into Rust strings or changing original metadata coercion. */
export function tryCreateRustLineTokens(data: { text: string; metadata: number }[]): [Uint32Array, string] | undefined {
	if (!registeredModule || !standardTokenSequence(data, true)) { return undefined; }
	const result = registeredModule.create_line_tokens(data);
	if (result && (!Array.isArray(result) || result.length !== 2 || !(result[0] instanceof Uint32Array) || result[0].length !== data.length * 2 || typeof result[1] !== 'string' || (result[0].length > 1 ? result[0][result[0].length - 2] : 0) !== result[1].length)) { throw new Error('The Rust token construction does not match the editor contract'); }
	return result;
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
