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
import { IViewLineTokens, LineTokens } from '../../src/vs/editor/common/tokens/lineTokens.js';
import { IRustTokensModule, registerRustTokens, tryCompareRustLineTokens, tryExtractRustLineTokens, tryFindRustLineTokenIndex, tryInsertRustLineTokens, trySliceRustLineTokens } from '../../src/vs/editor/common/tokens/rustTokens.js';

interface IRustModule extends IRustTokensModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustTokensModule = rust): T {
	const registration = registerRustTokens(module);
	try { return compute(); } finally { registration.dispose(); }
}

const codec = new LanguageIdCodec();
const colors = Array.from({ length: 512 }, (_, index) => `#${index.toString(16).padStart(6, '0')}`);

function viewState(tokens: IViewLineTokens) {
	return {
		text: tokens.getLineContent(), count: tokens.getCount(),
		tokens: Array.from({ length: tokens.getCount() }, (_, index) => ({
			end: tokens.getEndOffset(index), metadata: tokens.getMetadata(index), text: tokens.getTokenText(index),
			foreground: tokens.getForeground(index), type: tokens.getStandardTokenType(index), language: tokens.getLanguageId(index),
			className: tokens.getClassName(index), style: tokens.getInlineStyle(index, colors), presentation: tokens.getPresentation(index)
		})),
		indices: [-10, 0, 0.5, 1, 3, 10, 1000].map(offset => tokens.findTokenIndexAtOffset(offset))
	};
}

function offsetView(values: number[]): Uint32Array {
	const backing = new Uint32Array(values.length + 8).fill(0xDEADBEEF);
	backing.set(values, 3);
	return backing.subarray(3, 3 + values.length);
}

test('Rust line token transforms preserve seeded UTF-16 insertions, boundaries, masks, ranges, and aliases', () => {
	let seed = 1723;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	for (let trace = 0; trace < 512; trace++) {
		const text = 'a\uD800x\uDC00\uD83D\uDE00\uFEFF'.repeat(1 + random(16));
		const ends = Array.from({ length: 1 + random(32) }, () => random(text.length + 1)).sort((first, second) => first - second);
		ends.push(text.length);
		const words = ends.flatMap(end => [end, random(0x100000000)]);
		const original = offsetView(words);
		const native = offsetView(words);
		const reference = new LineTokens(original, text, codec);
		const actual = new LineTokens(native, text, codec);
		const insertions = Array.from({ length: random(16) }, () => ({
			offset: random(text.length * 3) - text.length,
			text: ['', 'a', '\uD800', '\uDC00', '\uD83D\uDE00', '\n'][random(6)], tokenMetadata: random(0x100000000) - random(0x100000000)
		}));
		if (trace % 2 === 0) { insertions.sort((first, second) => first.offset - second.offset); }
		assert.deepStrictEqual(withRust(() => viewState(actual.withInserted(insertions))), viewState(reference.withInserted(insertions)), `Inserted trace ${trace}`);
		const firstViews: IViewLineTokens[] = [];
		const secondViews: IViewLineTokens[] = [];
		for (let index = 0; index < 8; index++) {
			const start = random(text.length * 3) - text.length;
			const end = random(text.length * 3) - text.length;
			const delta = random(9) - 4;
			const expected = reference.sliceAndInflate(start, end, delta);
			const result = withRust(() => actual.sliceAndInflate(start, end, delta));
			assert.deepStrictEqual(withRust(() => viewState(result)), viewState(expected), `Slice trace ${trace}/${index}`);
			firstViews.push(expected); secondViews.push(result);
			const range = new OffsetRange(Math.min(start, end), Math.max(start, end));
			const read = (tokens: LineTokens) => tokens.getTokensInRange(range).map((range, token) => ({ range, length: token.length, metadata: token.metadata }));
			assert.deepStrictEqual(withRust(() => read(actual)), read(reference));
		}
		const equality = (source: IViewLineTokens[]) => source.map(first => source.map(second => first.equals(second)));
		assert.deepStrictEqual(withRust(() => equality(secondViews)), equality(firstViews));
		for (const tokens of [original, native]) { tokens[1] ^= 0x7FFFFF; tokens[0] = text.length; }
		assert.deepStrictEqual(withRust(() => secondViews.map(viewState)), firstViews.map(viewState), 'Held slices retain their cached selection and mutable metadata');
		assert.deepStrictEqual(new Uint32Array(native.buffer), new Uint32Array(original.buffer));
	}
});

test('Rust line token conversion and equality preserve seeded sources, wrapping, and slice coercion fallback', () => {
	let seed = 127;
	const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
	for (let trace = 0; trace < 1024; trace++) {
		const values = Array.from({ length: trace % 65 }, () => random());
		const reference = offsetView(values);
		const actual = offsetView(values);
		const length = [0, 3, 0xFFFFFFFF, 0x100000005, -1, 1.5][trace % 6];
		LineTokens.convertToEndOffset(reference, length);
		withRust(() => LineTokens.convertToEndOffset(actual, length));
		assert.deepStrictEqual(new Uint32Array(actual.buffer), new Uint32Array(reference.buffer));
	}
	const first = new LineTokens(new Uint32Array([3, 7, 6, 9, 10, 11]), '0123456789', codec);
	const second = new LineTokens(new Uint32Array([3, 7, 6, 19, 10, 11]), '0123456789', codec);
	for (const [from, count] of [[0, 3], [1, 1], [2, 1], [2, 5], [-1, 1], [0.5, 2], [2 ** 31, 1]]) {
		assert.strictEqual(withRust(() => first.slicedEquals(second, from, count)), first.slicedEquals(second, from, count));
	}
});

test('Rust line token queries retain virtual callbacks, getter inputs, malformed ranges, and detached buffers', () => {
	const failure = new Error('Original line token callback failure');
	class CustomTokens extends LineTokens {
		public override getStartOffset(): number { throw failure; }
	}
	const custom = new CustomTokens(new Uint32Array([3, 7, 8, 9]), '01234567', codec);
	assert.throws(() => withRust(() => custom.getTokensInRange(new OffsetRange(0, 8))), error => error === failure);
	assert.throws(() => withRust(() => custom.sliceAndInflate(0, 8, 0)), error => error === failure);
	const source = new LineTokens(new Uint32Array([3, 7, 8, 9]), '01234567', codec);
	let reads = 0;
	const insertion = { offset: 2, get text() { reads++; return 'x'; }, tokenMetadata: 3 };
	const expected = source.withInserted([insertion]);
	const originalReads = reads;
	reads = 0;
	const actual = withRust(() => source.withInserted([insertion]));
	assert.deepStrictEqual({ state: viewState(actual), reads }, { state: viewState(expected), reads: originalReads });
	const malformed = new LineTokens(new Uint32Array([10, 1, 2, 3, 8, 5]), '01234567', codec);
	assert.throws(() => withRust(() => malformed.getTokensInRange(new OffsetRange(0, 8))), /Invalid range/);
	assert.deepStrictEqual(withRust(() => viewState(malformed.withInserted([{ offset: 4, text: '\uD800', tokenMetadata: -1 }]))), viewState(malformed.withInserted([{ offset: 4, text: '\uD800', tokenMetadata: -1 }])));
	const first = new Uint32Array([3, 7, 8, 9]);
	const second = first.slice();
	const reference = new LineTokens(first, '01234567', codec);
	const detached = new LineTokens(second, '01234567', codec);
	structuredClone(first.buffer, { transfer: [first.buffer] });
	structuredClone(second.buffer, { transfer: [second.buffer] });
	assert.deepStrictEqual(withRust(() => viewState(detached.sliceAndInflate(0, 8, 0))), viewState(reference.sliceAndInflate(0, 8, 0)));
	assert.deepStrictEqual(withRust(() => viewState(detached.withInserted([{ offset: 2, text: 'x', tokenMetadata: 3 }]))), viewState(reference.withInserted([{ offset: 2, text: 'x', tokenMetadata: 3 }])));
	assert.strictEqual(withRust(() => detached.slicedEquals(reference, 0, 2)), reference.slicedEquals(detached, 0, 2));
});

test('Rust line token bindings validate packets and keep unsupported domains and stale assets on fallback', () => {
	const tokens = new Uint32Array([3, 7, 8, 9]);
	const source = new LineTokens(tokens, '01234567', codec);
	withRust(() => {
		assert.strictEqual(tryCompareRustLineTokens(tokens, tokens, -1, 1), undefined);
		assert.strictEqual(tryInsertRustLineTokens(tokens, 2, '01234567', [{ offset: 1.5, text: 'x', tokenMetadata: 3 }]), undefined);
		assert.strictEqual(trySliceRustLineTokens(source, LineTokens.prototype, 1.5, 3), undefined);
		assert.strictEqual(tryExtractRustLineTokens(source, LineTokens.prototype, 1.5, 3), undefined);
	});
	assert.strictEqual(rust.line_token_index(tokens, Number.NaN), undefined);
	assert.strictEqual(rust.line_token_index(new Uint32Array([3]), 2), undefined);
	assert.throws(() => rust.insert_line_tokens(tokens, new Uint16Array(8), new Uint16Array(), new Float64Array([1])), /insertion packet/);
	assert.throws(() => rust.insert_line_tokens(tokens, new Uint16Array(8), new Uint16Array(), new Float64Array([1, 0, 1, 3])), /insertion packet/);
	withRust(() => assert.throws(() => tryFindRustLineTokenIndex(tokens, 2), /line token index/), { ...rust, line_token_index: () => -1 });
	assert.throws(() => registerRustTokens({ ...rust, tokens_abi_version: () => 7 }), /metadata contract/);
});
