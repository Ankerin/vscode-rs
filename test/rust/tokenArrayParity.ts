/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { OffsetRange } from '../../src/vs/editor/common/core/ranges/offsetRange.js';
import { LanguageIdCodec } from '../../src/vs/editor/common/services/languagesRegistry.js';
import { LineTokens, TokenArray, TokenArrayBuilder, TokenInfo } from '../../src/vs/editor/common/tokens/lineTokens.js';
import { IRustTokensModule, registerRustTokens, tryCreateRustLineTokens, tryReadRustTokenArray, trySliceRustTokenSequence } from '../../src/vs/editor/common/tokens/rustTokens.js';
import { TokenWithTextArray, TokenWithTextArrayBuilder, TokenWithTextInfo } from '../../src/vs/editor/common/tokens/tokenWithTextArray.js';

interface IRustModule extends IRustTokensModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });
const codec = new LanguageIdCodec();

function withRust<T>(compute: () => T, module: IRustTokensModule = rust): T {
	const registration = registerRustTokens(module);
	try { return compute(); } finally { registration.dispose(); }
}

function lineState(tokens: LineTokens) {
	return { text: tokens.getLineContent(), words: Array.from(tokens.getEncodedTokens()), count: tokens.getCount() };
}

function capture<T>(compute: () => T) {
	try { return { value: compute() }; } catch (error) {
		if (!(error instanceof Error)) { throw error; }
		return { error: { name: error.name, message: error.message } };
	}
}

test('Rust token sequence construction and slices preserve seeded Unicode, fractional lengths, zero tokens, and aliases', () => {
	let seed = 6571;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	for (let trace = 0; trace < 1024; trace++) {
		const data = Array.from({ length: random(64) }, () => ({
			text: ['', 'ab', '\uD800', '\uDC00', '\uD83D\uDE00', '\uFEFF\n'][random(6)],
			metadata: [Number.NaN, Number.POSITIVE_INFINITY, -1, 2 ** 40 + 31, random(2 ** 32), -random(2 ** 32) - 0.5][random(6)]
		}));
		const expected = LineTokens.createFromTextAndMetadata(data, codec);
		const actual = withRust(() => LineTokens.createFromTextAndMetadata(data, codec));
		assert.deepStrictEqual(lineState(actual), lineState(expected));
		const expectedLengths = TokenArray.fromLineTokens(expected);
		const actualLengths = withRust(() => TokenArray.fromLineTokens(actual));
		const expectedText = TokenWithTextArray.fromLineTokens(expected);
		const actualText = withRust(() => TokenWithTextArray.fromLineTokens(actual));
		const lengthState = (array: TokenArray) => array.map((range, token) => ({ start: range.start, end: range.endExclusive, length: token.length, metadata: token.metadata }));
		const textState = (array: TokenWithTextArray) => array.map((range, token) => ({ start: range.start, end: range.endExclusive, text: token.text, metadata: token.metadata }));
		for (let index = 0; index < 8; index++) {
			const first = random(128) / 2 - 16;
			const last = random(128) / 2 - 16;
			const range = new OffsetRange(Math.min(first, last), Math.max(first, last));
			assert.deepStrictEqual(withRust(() => lengthState(actualLengths.slice(range))), lengthState(expectedLengths.slice(range)));
			assert.deepStrictEqual(withRust(() => textState(actualText.slice(range))), textState(expectedText.slice(range)));
			assert.deepStrictEqual(withRust(() => lineState(actualLengths.slice(range).toLineTokens(actual.getLineContent(), codec))), lineState(expectedLengths.slice(range).toLineTokens(expected.getLineContent(), codec)));
			assert.deepStrictEqual(withRust(() => lineState(actualText.slice(range).toLineTokens(codec))), lineState(expectedText.slice(range).toLineTokens(codec)));
		}
		const info = data.map((token, index) => new TokenInfo(index % 5 / 2, token.metadata));
		const sequence = TokenArray.create(info);
		const range = new OffsetRange(1.5, 8.75);
		const before = sequence.slice(range);
		const nativeBefore = withRust(() => sequence.slice(range));
		info.splice(0, 2, new TokenInfo(3, 42));
		assert.deepStrictEqual(withRust(() => lengthState(sequence.slice(range))), lengthState(sequence.slice(range)));
		assert.deepStrictEqual(lengthState(nativeBefore), lengthState(before), 'Slices retain independent TokenInfo objects');
		assert.strictEqual(sequence.append(sequence).map((_range, token) => token)[0], info[0]);
	}
});

test('Rust token sequence slicing retains floating-point exceptional values, negative lengths, and substring swapping', () => {
	const numeric = [0, -0, 0.5, -2, 4, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
	for (const first of numeric) {
		for (const second of numeric) {
			const items = [new TokenInfo(first, 7), new TokenInfo(second, 9), new TokenInfo(3, 11)];
			const array = TokenArray.create(items);
			for (const start of numeric) {
				const end = Number.isNaN(start) ? 8 : Math.max(start, 8);
				const range = new OffsetRange(start, end);
				const read = () => array.slice(range).map((range, token) => ({ range, token }));
				assert.deepStrictEqual(withRust(() => capture(read)), capture(read));
			}
		}
	}
	const words = new Uint32Array([5, 1, 2, 3, 0, 5, 8, 7]);
	const line = new LineTokens(words, 'a\uD800x\uDC00\uD83D\uDE00yz', codec);
	assert.deepStrictEqual(withRust(() => TokenArray.fromLineTokens(line).slice(new OffsetRange(0, 6))), TokenArray.fromLineTokens(line).slice(new OffsetRange(0, 6)));
	assert.deepStrictEqual(withRust(() => lineState(TokenWithTextArray.fromLineTokens(line).toLineTokens(codec))), lineState(TokenWithTextArray.fromLineTokens(line).toLineTokens(codec)));
});

test('Rust token sequence transforms retain provider callbacks, custom iterators, range getters, and builder sharing', () => {
	const failure = new Error('Original token sequence provider failure');
	class CustomTokens extends LineTokens {
		public override getTokenText(): string { throw failure; }
		public override getEndOffset(): number { throw failure; }
	}
	const custom = new CustomTokens(new Uint32Array([3, 7]), 'abc', codec);
	assert.throws(() => withRust(() => TokenArray.fromLineTokens(custom)), error => error === failure);
	assert.throws(() => withRust(() => TokenWithTextArray.fromLineTokens(custom)), error => error === failure);
	let reads = 0;
	const data = [{ get text() { reads++; return 'x\uD800'; }, metadata: 7 }];
	const expected = LineTokens.createFromTextAndMetadata(data, codec);
	const count = reads; reads = 0;
	assert.deepStrictEqual(withRust(() => ({ state: lineState(LineTokens.createFromTextAndMetadata(data, codec)), reads })), { state: lineState(expected), reads: count });
	const items = [new TokenInfo(3, 7), new TokenInfo(4, 9)];
	Object.defineProperty(items, Symbol.iterator, { value: function* () { yield new TokenInfo(2, 42); yield items[0]; } });
	const array = TokenArray.create(items);
	assert.deepStrictEqual(withRust(() => array.slice(new OffsetRange(1, 4))), array.slice(new OffsetRange(1, 4)));
	const range = new OffsetRange(0, 4);
	Object.defineProperty(range, 'start', { get: () => { reads++; return 1; } });
	reads = 0;
	const reference = array.slice(range);
	const referenceReads = reads; reads = 0;
	assert.deepStrictEqual(withRust(() => ({ value: array.slice(range), reads })), { value: reference, reads: referenceReads });
	const builder = new TokenArrayBuilder();
	builder.add(1, 2);
	const held = builder.build();
	builder.add(3, 4);
	assert.deepStrictEqual(withRust(() => held.slice(new OffsetRange(0, 4))), held.slice(new OffsetRange(0, 4)));
	const textBuilder = new TokenWithTextArrayBuilder();
	textBuilder.add('\uD800', 7);
	const textHeld = textBuilder.build();
	textBuilder.add('\uDC00', 9);
	assert.deepStrictEqual(withRust(() => lineState(textHeld.toLineTokens(codec))), lineState(textHeld.toLineTokens(codec)));
	const detached = new Uint32Array([3, 7]);
	const source = new LineTokens(detached, 'abc', codec);
	structuredClone(detached.buffer, { transfer: [detached.buffer] });
	assert.deepStrictEqual(withRust(() => TokenArray.fromLineTokens(source)), TokenArray.fromLineTokens(source));
	assert.deepStrictEqual(withRust(() => TokenWithTextArray.fromLineTokens(source)), TokenWithTextArray.fromLineTokens(source));
});

test('Rust token sequence bindings validate results and retain oversized and unsupported states before mutation', () => {
	const items = [new TokenWithTextInfo('abc', 7)];
	const range = new OffsetRange(0, 3);
	const source = LineTokens.createFromTextAndMetadata(items, codec);
	withRust(() => {
		assert.strictEqual(tryCreateRustLineTokens([{ text: 'a'.repeat(4 * 1024 * 1024 + 1), metadata: 7 }]), undefined);
		assert.strictEqual(trySliceRustTokenSequence(new Array<TokenInfo>(262145), range, false), undefined);
		assert.strictEqual(tryReadRustTokenArray(source, LineTokens.prototype, false)?.length, 2);
	});
	assert.strictEqual(rust.slice_token_array(new Float64Array(262145), 0, 3), undefined);
	assert.strictEqual(rust.line_token_array(new Uint32Array([3]), 3, false), undefined);
	withRust(() => assert.throws(() => trySliceRustTokenSequence(items, range, true), /token slice/), { ...rust, slice_token_array: () => new Float64Array([1, 0, 0, 3]) });
	withRust(() => assert.throws(() => tryReadRustTokenArray(source, LineTokens.prototype, false), /token sequence/), { ...rust, line_token_array: () => new Float64Array([3]) });
	withRust(() => assert.throws(() => tryCreateRustLineTokens(items), /token construction/), { ...rust, create_line_tokens: () => [new Uint32Array([2, 7]), 'abc'] });
	assert.throws(() => registerRustTokens({ ...rust, tokens_abi_version: () => 8 }), /metadata contract/);
});
