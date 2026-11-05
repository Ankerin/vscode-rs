/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { LanguageIdCodec } from '../../src/vs/editor/common/services/languagesRegistry.js';
import { LineTokens } from '../../src/vs/editor/common/tokens/lineTokens.js';
import { IRustTokensModule, registerRustTokens, tryAppendRustContiguousTokens, tryEditRustSparseTokens, tryFindRustSparseLineTokens, tryMergeRustSemanticTokens, tryRemoveRustSparseTokens, trySplitRustSparseTokens, tryUpdateRustContiguousTokens } from '../../src/vs/editor/common/tokens/rustTokens.js';
import { ContiguousTokensEditing, EMPTY_LINE_TOKENS, toUint32Array } from '../../src/vs/editor/common/tokens/contiguousTokensEditing.js';
import { ContiguousMultilineTokens } from '../../src/vs/editor/common/tokens/contiguousMultilineTokens.js';
import { ContiguousTokensStore } from '../../src/vs/editor/common/tokens/contiguousTokensStore.js';
import { countEOL } from '../../src/vs/editor/common/core/misc/eolCounter.js';
import { DisposableStore } from '../../src/vs/base/common/lifecycle.js';
import { errorHandler, setUnexpectedErrorHandler } from '../../src/vs/base/common/errors.js';
import { EncodedTokenizationResult, IBackgroundTokenizationStore, ITokenizationSupport, TokenizationRegistry } from '../../src/vs/editor/common/languages.js';
import { ILanguageService } from '../../src/vs/editor/common/languages/language.js';
import { NullState, nullTokenize } from '../../src/vs/editor/common/languages/nullTokenize.js';
import { SparseMultilineTokens } from '../../src/vs/editor/common/tokens/sparseMultilineTokens.js';
import { SparseTokensStore } from '../../src/vs/editor/common/tokens/sparseTokensStore.js';
import { createModelServices, createTextModel, instantiateTextModel } from '../../src/vs/editor/test/common/testTextModel.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustTokensModule = rust): T {
	const registration = registerRustTokens(module);
	try { return compute(); } finally { registration.dispose(); }
}

function createStore(sparse: Uint32Array): SparseTokensStore {
	const store = new SparseTokensStore(new LanguageIdCodec());
	store.set([SparseMultilineTokens.create(1, sparse)], true);
	return store;
}

function offsetView(values: number[]): Uint32Array {
	const backing = new Uint32Array(values.length + 8);
	backing.fill(0xDEADBEEF);
	backing.set(values, 3);
	return backing.subarray(3, 3 + values.length);
}

test('Rust sparse line selection preserves seeded duplicate bounds, live source aliases, and inactive suffixes', () => {
	let seed = 3721;
	let calls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const module: IRustTokensModule = { ...rust, sparse_line_token_range: (tokens, count, desired) => { calls++; return rust.sparse_line_token_range(tokens, count, desired); } };
	for (let trace = 0; trace < 1024; trace++) {
		let line = 0;
		const words = Array.from({ length: 1 + random(96) }, () => {
			line += random(3);
			return [line, random(16), random(32), random(2 ** 32)];
		}).flat();
		const first = offsetView(words);
		const second = offsetView(words);
		const reference = SparseMultilineTokens.create(5, first);
		const actual = SparseMultilineTokens.create(5, second);
		const read = (piece: SparseMultilineTokens, line: number) => {
			const tokens = piece.getLineTokens(line)?.getEncodedTokens();
			return tokens ? { words: Array.from(tokens), offset: tokens.byteOffset, length: tokens.length } : null;
		};
		const query = Array.from({ length: 24 }, () => 3 + random(line + 7));
		assert.deepStrictEqual(withRust(() => query.map(line => read(actual, line)), module), query.map(line => read(reference, line)));
		const expectedHeld = reference.getLineTokens(5 + first[0]);
		const actualHeld = withRust(() => actual.getLineTokens(5 + second[0]), module);
		for (const tokens of [first, second]) { tokens[1] = 27; tokens[3] ^= 0xFFFFFFFF; if (tokens.length > 4) { tokens[4] = tokens[0]; } }
		assert.deepStrictEqual(actualHeld?.getEncodedTokens(), expectedHeld?.getEncodedTokens());
		assert.deepStrictEqual(withRust(() => query.map(line => read(actual, line)), module), query.map(line => read(reference, line)));
		const range = new Range(5, 1, 5 + Math.floor(line / 2), 4);
		reference.removeTokens(range);
		withRust(() => actual.removeTokens(range), module);
		assert.deepStrictEqual(withRust(() => query.map(line => read(actual, line)), module), query.map(line => read(reference, line)));
		assert.deepStrictEqual(new Uint32Array(second.buffer), new Uint32Array(first.buffer));
	}
	assert.ok(calls > 10000, 'Actual public piece queries dispatch the native selector');
});

test('Rust sparse line selection retains malformed ordering, provider subarray callbacks, and detached or unsupported states', () => {
	for (const words of [[4, 0, 3, 7, 0, 0, 3, 9, 2, 1, 4, 11, 2, 4, 8, 13, 1, 2, 3, 17, 4, 0, 2, 19], [0, 0, 3, 7, 3], []]) {
		const piece = SparseMultilineTokens.create(1, new Uint32Array(words));
		const read = () => [0, 1, 1.5, 2, 3, 4, 5, 6, Number.NaN, Number.POSITIVE_INFINITY].map(line => piece.getLineTokens(line)?.getEncodedTokens());
		assert.deepStrictEqual(withRust(read), read());
	}
	const failure = new Error('Original sparse source view failure');
	class CallbackTokens extends Uint32Array {
		public override subarray(): Uint32Array<ArrayBuffer> { throw failure; }
	}
	const callbacks = SparseMultilineTokens.create(1, new CallbackTokens([0, 0, 3, 7]));
	assert.throws(() => withRust(() => callbacks.getLineTokens(1)), error => error === failure);
	const tokens = new Uint32Array([0, 0, 3, 7]);
	const detached = SparseMultilineTokens.create(1, tokens);
	structuredClone(tokens.buffer, { transfer: [tokens.buffer] });
	assert.deepStrictEqual(withRust(() => detached.getLineTokens(1)), detached.getLineTokens(1));
	const backing = new Uint32Array([0, 0, 3, 7, 2, 1, 4, 9]);
	withRust(() => {
		assert.strictEqual(tryFindRustSparseLineTokens(backing, 1.5, 0), undefined);
		assert.strictEqual(tryFindRustSparseLineTokens(backing, 3, 0), undefined);
		assert.strictEqual(tryFindRustSparseLineTokens(backing, 2, Number.NaN), undefined);
		assert.deepStrictEqual(tryFindRustSparseLineTokens(backing, 0, 0), new Float64Array([0, 4]));
		assert.deepStrictEqual(tryFindRustSparseLineTokens(backing, 1, 2), new Float64Array());
	});
	assert.strictEqual(rust.sparse_line_token_range(backing, 3, 0), undefined);
	assert.strictEqual(rust.sparse_line_token_range(new Uint32Array([0]), 0, 0), undefined);
	for (const result of [new Float64Array([0]), new Float64Array([-4, 4]), new Float64Array([0, 12]), new Float64Array([1, 4])]) {
		withRust(() => assert.throws(() => tryFindRustSparseLineTokens(backing, 2, 0), /sparse line token range/), { ...rust, sparse_line_token_range: () => result });
	}
	assert.throws(() => registerRustTokens({ ...rust, tokens_abi_version: () => 10 }), /metadata contract/);
});

test('Rust semantic overlays preserve seeded boundaries, all presentation masks, and source aliases', () => {
	let seed = 151;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	for (let iteration = 0; iteration < 512; iteration++) {
		const text = 'a\uD800x\uDC00\uD83D\uDE00\uFEFF'.repeat(1 + random(16));
		const boundaries = Array.from({ length: 1 + random(32) }, () => random(text.length + 1)).sort((first, second) => first - second);
		boundaries.push(text.length);
		const contiguous = offsetView(boundaries.flatMap(end => [end, random(0x100000000)]));
		const beforeSyntax = new Uint32Array(contiguous.buffer.slice(0));
		const syntax = new LineTokens(contiguous, text, new LanguageIdCodec());
		for (let mask = 0; mask < 64; mask++) {
			// Provider ranges are intentionally unvalidated: duplicates, overlaps, reversed spans, and clamping.
			const semantic = offsetView(Array.from({ length: 1 + random(16) }, () => [3, random(text.length * 2), random(text.length * 2), (random(0x100000000) & ~63) | mask]).flat());
			const beforeSemantic = new Uint32Array(semantic.buffer.slice(0));
			const store = createStore(semantic);
			try {
				const reference = store.addSparseTokens(4, syntax);
				const actual = withRust(() => store.addSparseTokens(4, syntax));
				assert.deepStrictEqual({ tokens: actual.getEncodedTokens(), text: actual.getLineContent(), syntax: new Uint32Array(contiguous.buffer), sparse: new Uint32Array(semantic.buffer) }, { tokens: reference.getEncodedTokens(), text, syntax: beforeSyntax, sparse: beforeSemantic }, `Semantic overlay ${iteration}/${mask}`);
			} finally { store.dispose(); }
		}
	}
});

test('Rust semantic overlays preserve identity shortcuts, unsupported fallback, and atomic registration', () => {
	const syntax = new LineTokens(new Uint32Array([4, 0xFF010407]), 'text', new LanguageIdCodec());
	const sparse = new Uint32Array([0, 1, 3, 0x8028803F]);
	const store = createStore(sparse);
	try {
		const reference = store.addSparseTokens(1, syntax).getEncodedTokens();
		assert.deepStrictEqual(withRust(() => store.addSparseTokens(1, syntax).getEncodedTokens(), { ...rust, merge_semantic_tokens: () => undefined }), reference);
		withRust(() => {
			const empty = new LineTokens(new Uint32Array([0, 7]), '', new LanguageIdCodec());
			assert.strictEqual(store.addSparseTokens(1, empty), empty);
			assert.strictEqual(store.addSparseTokens(2, syntax), syntax);
			store.flush();
			assert.strictEqual(store.addSparseTokens(1, syntax), syntax);
		}, { ...rust, merge_semantic_tokens: () => { throw new Error('Unexpected identity-shortcut call'); } });
		assert.throws(() => registerRustTextBuffer({ ...rust, tokens_abi_version: () => 0 }), /metadata contract/);
		const registration = registerRustTextBuffer(rust);
		try { assert.throws(() => registerRustTokens(rust), /already registered/); } finally { registration.dispose(); }
		assert.strictEqual(tryMergeRustSemanticTokens(syntax.getEncodedTokens(), sparse, 4), undefined);
		withRust(() => {
			for (const length of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x100000000]) {
				assert.strictEqual(tryMergeRustSemanticTokens(syntax.getEncodedTokens(), sparse, length), undefined);
			}
			assert.strictEqual(tryMergeRustSemanticTokens(new Uint32Array([1]), sparse, 4), undefined);
			assert.strictEqual(tryMergeRustSemanticTokens(syntax.getEncodedTokens(), new Uint32Array([1]), 4), undefined);
		});
		for (const result of [new Uint32Array([4]), new Uint32Array([3, 0]), new Uint32Array()]) {
			assert.throws(() => withRust(() => tryMergeRustSemanticTokens(syntax.getEncodedTokens(), sparse, 4), { ...rust, merge_semantic_tokens: () => result }), /token result/);
		}
		assert.throws(() => rust.merge_semantic_tokens(new Uint32Array([1]), sparse, 4), /encoding|contract/);
		assert.throws(() => rust.merge_semantic_tokens(syntax.getEncodedTokens(), new Uint32Array([1]), 4), /encoding|contract/);
		for (const tokens of [[], [3, 0], [3, 0, 1, 0]]) {
			assert.strictEqual(rust.merge_semantic_tokens(new Uint32Array(tokens), sparse, 4), undefined);
		}
	} finally { store.dispose(); }
});

test('Rust semantic overlays preserve real model tokens through edits, partial updates, and language changes', () => {
	const text = 'alpha\uD800 beta\n\tgamma\uD83D\uDE00 delta\nlast';
	const reference = createTextModel(text);
	const registration = registerRustTextBuffer(rust);
	let actual: ReturnType<typeof createTextModel>;
	try { actual = createTextModel(text); } finally { registration.dispose(); }
	const records = new Uint32Array([0, 1, 5, 0x8068883F, 0, 7, 11, 0x00109010, 1, 1, 8, 0x00003006, 2, 0, 4, 0x04000020]);
	const state = (model: ReturnType<typeof createTextModel>) => Array.from({ length: model.getLineCount() }, (_, index) => {
		const tokens = model.tokenization.getLineTokens(index + 1);
		return { text: tokens.getLineContent(), encoding: tokens.getEncodedTokens() };
	});
	const compare = () => assert.deepStrictEqual(withRust(() => state(actual)), state(reference));
	try {
		for (const model of [reference, actual]) { model.tokenization.setSemanticTokens([SparseMultilineTokens.create(1, records.slice())], true); }
		compare();
		for (const edits of [
			[{ range: new Range(1, 2, 1, 2), text: 'xy' }],
			[{ range: new Range(1, 4, 2, 3), text: '\ninsert\r\n' }],
			[{ range: new Range(2, 1, 2, 1), text: '\uD800\uFEFF' }]
		]) {
			reference.applyEdits(edits);
			actual.applyEdits(edits);
			compare();
		}
		for (const model of [reference, actual]) {
			model.tokenization.setSemanticTokens(null, false);
			model.tokenization.setPartialSemanticTokens(new Range(2, 1, 3, 1), [SparseMultilineTokens.create(2, new Uint32Array([0, 0, 2, 0x00108010]))]);
			model.updateOptions({ tabSize: 3, indentSize: 2 });
		}
		compare();
		for (const model of [reference, actual]) { model.setLanguage('rust'); }
		compare();
	} finally {
		reference.dispose();
		actual.dispose();
	}
});

function sparseState(piece: SparseMultilineTokens) {
	return { start: piece.startLineNumber, end: piece.endLineNumber, range: piece.getRange(), empty: piece.isEmpty(), text: piece.toString() };
}

test('Rust sparse token edits preserve seeded block rebasing, boundaries, mutable aliases, and inactive suffixes', () => {
	let seed = 157;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const insertions = ['', 'a', '0', 'Z', '_', ' ', 'xy', '\uD800', '\uD83D\uDE00', '\r', '\n', 'first\r\nlast', '\n\n'];
	for (let iteration = 0; iteration < 1024; iteration++) {
		const records = Array.from({ length: 32 }, (_, index) => {
			const start = random(32);
			return [Math.floor(index / 4), start, start + random(16), random(0x100000000)];
		}).flat();
		const original = offsetView(records);
		const native = offsetView(records);
		const blockStart = 1 + random(8);
		const reference = SparseMultilineTokens.create(blockStart, original);
		const actual = SparseMultilineTokens.create(blockStart, native);
		for (let index = 0; index < 16; index++) {
			const startLine = 1 + random(20);
			const endLine = startLine + random(index % 4 === 0 ? 8 : 2);
			const startColumn = 1 + random(32);
			const endColumn = endLine === startLine ? startColumn + random(8) : 1 + random(32);
			const range = new Range(startLine, startColumn, endLine, endColumn);
			const text = insertions[random(insertions.length)];
			const referenceAlias = reference.getLineTokens(reference.startLineNumber);
			const actualAlias = actual.getLineTokens(actual.startLineNumber);
			reference.applyEdit(range, text);
			withRust(() => actual.applyEdit(range, text));
			assert.deepStrictEqual({ state: sparseState(actual), backing: new Uint32Array(native.buffer), alias: actualAlias?.getEncodedTokens() }, { state: sparseState(reference), backing: new Uint32Array(original.buffer), alias: referenceAlias?.getEncodedTokens() }, `Sparse edit ${iteration}/${index}`);
		}
	}
});

test('Rust sparse removals and splits preserve touching endpoints, negative relative lines, and independent storage', () => {
	let seed = 163;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	for (let iteration = 0; iteration < 2048; iteration++) {
		const records = Array.from({ length: 1 + random(64) }, (_, index) => [Math.floor(index / 4), random(32), random(32), random(0x100000000)]).flat();
		const original = offsetView(records);
		const native = offsetView(records);
		const blockStart = 1 + random(16);
		const reference = SparseMultilineTokens.create(blockStart, original);
		const actual = SparseMultilineTokens.create(blockStart, native);
		for (let index = 0; index < 4; index++) {
			const start = 1 + random(32);
			const range = new Range(start, 1 + random(32), start + random(8), 1 + random(32));
			const expectedSplit = reference.split(range);
			const actualSplit = withRust(() => actual.split(range));
			assert.deepStrictEqual(actualSplit.map(sparseState), expectedSplit.map(sparseState), `Sparse split ${iteration}/${index}`);
			for (let splitIndex = 0; splitIndex < 2; splitIndex++) {
				expectedSplit[splitIndex].applyEdit(new Range(start, 1, start, 1), 'a\n');
				withRust(() => actualSplit[splitIndex].applyEdit(new Range(start, 1, start, 1), 'a\n'));
			}
			assert.deepStrictEqual(actualSplit.map(sparseState), expectedSplit.map(sparseState));
			reference.removeTokens(range);
			withRust(() => actual.removeTokens(range));
			assert.deepStrictEqual({ state: sparseState(actual), backing: new Uint32Array(native.buffer) }, { state: sparseState(reference), backing: new Uint32Array(original.buffer) }, `Sparse removal ${iteration}/${index}`);
		}
	}
});

test('Rust sparse mutation rejects malformed packets atomically and retains unsupported-state fallback', () => {
	const tokens = offsetView([0, 1, 4, 7, 1, 0, 5, 9]);
	const before = new Uint32Array(tokens.buffer.slice(0));
	for (const parameters of [[], [2, 0], [0, 0], [1, 0]]) {
		assert.throws(() => rust.update_sparse_tokens(tokens, new Float64Array(parameters)), /operation/);
		assert.deepStrictEqual(new Uint32Array(tokens.buffer), before);
	}
	assert.throws(() => rust.update_sparse_tokens(tokens.subarray(0, 3), new Float64Array([0, 0, 0, 1, 0])), /contract/);
	assert.deepStrictEqual(new Uint32Array(tokens.buffer), before);
	assert.throws(() => rust.split_sparse_tokens(tokens, new Float64Array()), /range/);
	assert.strictEqual(rust.update_sparse_tokens(tokens, new Float64Array([1, 1, 1, 2, 1, 1, 0, 0, 0, 0])), undefined);
	assert.strictEqual(rust.update_sparse_tokens(tokens, new Float64Array([0, 0, Number.NaN, 1, 0])), undefined);
	assert.strictEqual(rust.split_sparse_tokens(tokens, new Float64Array([0, 0, Number.POSITIVE_INFINITY, 0])), undefined);
	assert.deepStrictEqual(new Uint32Array(tokens.buffer), before);
	withRust(() => {
		assert.strictEqual(tryRemoveRustSparseTokens(tokens, 3, 0, 0, 1, 0), undefined);
		assert.strictEqual(trySplitRustSparseTokens(tokens, 2, 0, 0, 2 ** 41, 0), undefined);
		assert.strictEqual(tryEditRustSparseTokens(tokens, 2, 1, new Range(1, 1, 1, 1), 0, 0.5, 0, 0), undefined);
	});
	for (const result of [new Float64Array([1]), new Float64Array([3, 1]), new Float64Array([0, Number.NaN])]) {
		assert.throws(() => withRust(() => tryRemoveRustSparseTokens(tokens, 2, 0, 0, 1, 0), { ...rust, update_sparse_tokens: () => result }), /sparse token result/);
	}
	for (const result of [new Uint32Array([0]), new Uint32Array([8, 0]), new Uint32Array([0, 0, 1])]) {
		assert.throws(() => withRust(() => trySplitRustSparseTokens(tokens, 2, 0, 0, 1, 0), { ...rust, split_sparse_tokens: () => result }), /sparse token split/);
	}
	const reference = SparseMultilineTokens.create(1, tokens.slice());
	const actual = SparseMultilineTokens.create(1, tokens.slice());
	const range = new Range(1, 2, 2, 2);
	const expectedSplit = reference.split(range);
	const actualSplit = withRust(() => actual.split(range), { ...rust, split_sparse_tokens: () => undefined });
	assert.deepStrictEqual(actualSplit.map(sparseState), expectedSplit.map(sparseState));
	reference.applyEdit(range, 'first\nlast');
	withRust(() => actual.applyEdit(range, 'first\nlast'), { ...rust, update_sparse_tokens: () => undefined });
	assert.deepStrictEqual(sparseState(actual), sparseState(reference));
});

test('Rust sparse edits preserve typed-array wrapping, word-edge affinity, and cleared block coordinates', () => {
	for (const fixture of [
		{ tokens: [0, 0, 6, 7, 0xFFFFFFFF, 0, 6, 9], range: new Range(1, 3, 1, 3), eolCount: 0xFFFFFFFF, firstLength: 1, lastLength: 2, firstCode: 97 },
		{ tokens: [0, 0xFFFFFFFD, 0xFFFFFFFF, 7], range: new Range(1, 0xFFFFFFFE, 1, 0xFFFFFFFE), eolCount: 0, firstLength: 8, lastLength: 8, firstCode: 97 },
		{ tokens: [0, 1, 3, 7, 0, 3, 5, 9], range: new Range(1, 4, 1, 4), eolCount: 0, firstLength: 1, lastLength: 1, firstCode: 97 },
		{ tokens: [0, 1, 3, 7, 0, 3, 5, 9], range: new Range(1, 4, 1, 4), eolCount: 0, firstLength: 1, lastLength: 1, firstCode: 95 },
		{ tokens: [0, 1, 3, 7], range: new Range(1, 1, 3, 1), eolCount: 1, firstLength: 0, lastLength: 0, firstCode: 10 },
		{ tokens: [], range: new Range(1, 1, 1, 1), eolCount: 1, firstLength: 0, lastLength: 0, firstCode: 10 }
	]) {
		const { tokens, range, eolCount, firstLength, lastLength, firstCode } = fixture;
		const original = offsetView(tokens);
		const native = offsetView(tokens);
		const reference = SparseMultilineTokens.create(1, original);
		const actual = SparseMultilineTokens.create(1, native);
		reference.acceptEdit(range, eolCount, firstLength, lastLength, firstCode);
		withRust(() => actual.acceptEdit(range, eolCount, firstLength, lastLength, firstCode));
		assert.deepStrictEqual({ state: sparseState(actual), backing: new Uint32Array(native.buffer) }, { state: sparseState(reference), backing: new Uint32Array(original.buffer) });
	}
});

function contiguousState(result: Uint32Array | ArrayBuffer | null, source: Uint32Array | ArrayBuffer | null) {
	return { words: result === null ? null : toUint32Array(result), sameSource: result === source, emptySentinel: result === EMPTY_LINE_TOKENS, typedArray: result instanceof Uint32Array };
}

test('Rust contiguous token editing preserves seeded endpoints, mutable aliases, result shapes, and sentinel identity', () => {
	let seed = 167;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	for (let iteration = 0; iteration < 1024; iteration++) {
		const ends = Array.from({ length: 1 + random(32) }, () => random(128)).sort((first, second) => first - second);
		const records = ends.flatMap(end => [end, random(0x100000000)]);
		const last = ends[ends.length - 1];
		const position = random(last + 1);
		const operations = [
			(tokens: Uint32Array | ArrayBuffer) => ContiguousTokensEditing.delete(tokens, 0, last),
			(tokens: Uint32Array | ArrayBuffer) => ContiguousTokensEditing.delete(tokens, 0, last + 1),
			(tokens: Uint32Array | ArrayBuffer) => ContiguousTokensEditing.delete(tokens, position, position + random(last - position + 1)),
			(tokens: Uint32Array | ArrayBuffer) => ContiguousTokensEditing.deleteBeginning(tokens, position),
			(tokens: Uint32Array | ArrayBuffer) => ContiguousTokensEditing.deleteEnding(tokens, position),
			(tokens: Uint32Array | ArrayBuffer) => ContiguousTokensEditing.insert(tokens, ends[0], 3),
			(tokens: Uint32Array | ArrayBuffer) => ContiguousTokensEditing.insert(tokens, last, 0xFFFFFFFF)
		];
		for (const operation of operations) {
			const original = iteration % 2 === 0 ? offsetView(records) : new Uint32Array(records).buffer;
			const native = iteration % 2 === 0 ? offsetView(records) : new Uint32Array(records).buffer;
			const previousSeed = seed;
			const expected = operation(original);
			seed = previousSeed;
			const actual = withRust(() => operation(native));
			assert.deepStrictEqual({ result: contiguousState(actual, native), backing: new Uint32Array(native instanceof Uint32Array ? native.buffer : native) }, { result: contiguousState(expected, original), backing: new Uint32Array(original instanceof Uint32Array ? original.buffer : original) }, `Contiguous edit ${iteration}`);
		}
		const first = offsetView(records);
		const second = offsetView(records);
		const before = new Uint32Array(first.buffer.slice(0));
		const expected = ContiguousTokensEditing.append(first, second);
		const actual = withRust(() => ContiguousTokensEditing.append(first, second));
		assert.deepStrictEqual({ result: contiguousState(actual, first), first: new Uint32Array(first.buffer), second: new Uint32Array(second.buffer) }, { result: contiguousState(expected, first), first: before, second: before });
	}
});

test('Rust contiguous token editing preserves missing/empty shortcuts, unsupported fallback, and binding validation', () => {
	const tokens = new Uint32Array([3, 7, 6, 9]);
	const reject: IRustTokensModule = { ...rust, update_contiguous_tokens: () => { throw new Error('Unexpected token edit'); }, append_contiguous_tokens: () => { throw new Error('Unexpected token append'); } };
	withRust(() => {
		for (const source of [null, EMPTY_LINE_TOKENS]) {
			assert.strictEqual(ContiguousTokensEditing.delete(source, 1, 2), source);
			assert.strictEqual(ContiguousTokensEditing.deleteBeginning(source, 2), source);
			assert.strictEqual(ContiguousTokensEditing.deleteEnding(source, 2), source);
			assert.strictEqual(ContiguousTokensEditing.insert(source, 1, 2), source);
		}
		assert.strictEqual(ContiguousTokensEditing.delete(tokens, 2, 2), tokens);
		assert.strictEqual(ContiguousTokensEditing.append(tokens, EMPTY_LINE_TOKENS), tokens);
		assert.strictEqual(ContiguousTokensEditing.append(EMPTY_LINE_TOKENS, tokens), tokens);
		assert.strictEqual(ContiguousTokensEditing.append(null, tokens), null);
		assert.strictEqual(ContiguousTokensEditing.append(tokens, null), null);
	}, reject);
	for (const operation of [
		(tokens: Uint32Array) => ContiguousTokensEditing.delete(tokens, 1, 4),
		(tokens: Uint32Array) => ContiguousTokensEditing.insert(tokens, 3, 2),
		(tokens: Uint32Array) => ContiguousTokensEditing.append(tokens, tokens)
	]) {
		const original = tokens.slice();
		const native = tokens.slice();
		const expected = operation(original);
		const actual = withRust(() => operation(native), { ...rust, update_contiguous_tokens: () => undefined, append_contiguous_tokens: () => undefined });
		assert.deepStrictEqual(contiguousState(actual, native), contiguousState(expected, original));
	}
	for (const value of [Number.NaN, -2, 3, 8]) {
		assert.throws(() => withRust(() => tryUpdateRustContiguousTokens(tokens, 0, 1, 2), { ...rust, update_contiguous_tokens: () => value }), /contiguous token result/);
	}
	assert.throws(() => withRust(() => tryAppendRustContiguousTokens(tokens, tokens), { ...rust, append_contiguous_tokens: () => new Uint32Array(2) }), /contiguous token append/);
	const before = tokens.slice();
	assert.throws(() => rust.update_contiguous_tokens(tokens.subarray(0, 3), 0, 1, 2), /contract/);
	assert.throws(() => rust.update_contiguous_tokens(tokens, 2, 1, 2), /operation/);
	assert.throws(() => rust.append_contiguous_tokens(tokens, new Uint32Array(3)), /contract/);
	assert.strictEqual(rust.update_contiguous_tokens(tokens, 0, 2, 1), undefined);
	assert.strictEqual(rust.update_contiguous_tokens(tokens, 1, 1, Number.NaN), undefined);
	assert.strictEqual(rust.append_contiguous_tokens(new Uint32Array(), tokens), undefined);
	assert.deepStrictEqual(tokens, before);
});

test('Rust contiguous token edits preserve multiline block behavior and held line views', () => {
	const records = Array.from({ length: 12 }, (_, index) => offsetView([3, 0xFF000000 + index, 6, 7 + index, 10, 11 + index]));
	const original = records.map(tokens => offsetView(Array.from(tokens)));
	const native = records.map(tokens => offsetView(Array.from(tokens)));
	const reference = new ContiguousMultilineTokens(5, original);
	const actual = new ContiguousMultilineTokens(5, native);
	const state = (piece: ContiguousMultilineTokens) => ({
		start: piece.startLineNumber, end: piece.endLineNumber,
		tokens: Array.from({ length: piece.endLineNumber - piece.startLineNumber + 1 }, (_, index) => {
			const tokens = piece.getLineTokens(piece.startLineNumber + index);
			return tokens === null ? null : toUint32Array(tokens);
		})
	});
	for (const [range, text] of [
		[new Range(5, 4, 5, 4), '\uD800x'],
		[new Range(6, 2, 8, 4), 'first\r\nlast'],
		[new Range(1, 3, 2, 4), '\n'],
		[new Range(5, 3, 5, 3), '\nnew\n'],
		[new Range(1, 1, 20, 1), '']
	] as const) {
		reference.applyEdit(range, text);
		withRust(() => actual.applyEdit(range, text));
		assert.deepStrictEqual({ state: state(actual), backing: native.map(tokens => new Uint32Array(tokens.buffer)) }, { state: state(reference), backing: original.map(tokens => new Uint32Array(tokens.buffer)) });
	}
});

test('Rust owning syntax stores preserve seeded model edits, line indexing, equality, and externally mutable buffers', () => {
	let seed = 173;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	let frees = 0;
	class CountedStore extends rust.WasmContiguousTokensStore {
		public override free(): void { frees++; super.free(); }
	}
	const codec = new LanguageIdCodec();
	codec.register('rust');
	codec.register('typescript');
	const inserted = ['', 'a', '\uD800', '\uD83D\uDE00', '\r\n', 'first\nlast'];
	for (let iteration = 0; iteration < 256; iteration++) {
		const disposables = new DisposableStore();
		try {
			const model = disposables.add(createTextModel(('alpha beta gamma delta'.repeat(3) + '\n').repeat(16)));
			const reference = disposables.add(new ContiguousTokensStore(codec));
			const actual = withRust(() => disposables.add(new ContiguousTokensStore(codec)), { ...rust, WasmContiguousTokensStore: CountedStore });
			disposables.add(model.onDidChangeContent(event => {
				for (const change of event.changes) {
					const [eols, firstLength] = countEOL(change.text);
					reference.acceptEdit(change.range, eols, firstLength);
					actual.acceptEdit(change.range, eols, firstLength);
				}
			}));
			const referenceViews: Uint32Array[] = [];
			const actualViews: Uint32Array[] = [];
			const set = (line: number) => {
				const length = model.getLineLength(line);
				const ends = length === 0 ? [0] : Array.from(new Set([1 + random(length), 1 + random(length), length])).sort((first, second) => first - second);
				const records = ends.flatMap(end => [end, random(0x100000000)]);
				const original = iteration % 2 === 0 ? offsetView(records) : new Uint32Array(records);
				const native = iteration % 2 === 0 ? offsetView(records) : new Uint32Array(records);
				referenceViews.push(original);
				actualViews.push(native);
				assert.strictEqual(actual.setTokens('rust', line - 1, length, native, true), reference.setTokens('rust', line - 1, length, original, true));
				assert.strictEqual(actual.setTokens('rust', line - 1, length, native, true), reference.setTokens('rust', line - 1, length, original, true));
			};
			for (let line = 1; line <= model.getLineCount(); line += 2) { set(line); }
			const compare = () => {
				assert.strictEqual(actual.hasTokens, reference.hasTokens);
				for (let line = 1; line <= model.getLineCount() + 1; line++) {
					const text = line <= model.getLineCount() ? model.getLineContent(line) : '';
					const expectedErrors: string[] = [];
					const actualErrors: string[] = [];
					const previousHandler = errorHandler.getUnexpectedErrorHandler();
					try {
						setUnexpectedErrorHandler((error: Error) => expectedErrors.push(error.message));
						const expected = reference.getTokens('typescript', line - 1, text).getEncodedTokens();
						setUnexpectedErrorHandler((error: Error) => actualErrors.push(error.message));
						const result = actual.getTokens('typescript', line - 1, text).getEncodedTokens();
						assert.deepStrictEqual({ result, errors: actualErrors }, { result: expected, errors: expectedErrors }, `Syntax store ${iteration}/${line}`);
					} finally { setUnexpectedErrorHandler(previousHandler); }
				}
				assert.deepStrictEqual(actualViews.map(tokens => new Uint32Array(tokens.buffer)), referenceViews.map(tokens => new Uint32Array(tokens.buffer)));
			};
			for (let index = 0; index < 16; index++) {
				const first = 1 + random(model.getLineCount());
				const last = first + random(Math.min(3, model.getLineCount() - first + 1));
				const start = 1 + random(model.getLineLength(first) + 1);
				const end = last === first ? start + random(model.getLineLength(last) - start + 2) : 1 + random(model.getLineLength(last) + 1);
				const range = model.validateRange(new Range(first, start, last, end));
				const text = inserted[random(inserted.length)];
				model.applyEdits([{ range, text }]);
				set(1 + random(model.getLineCount()));
				// Token providers may mutate their retained arrays after publishing them.
				const alias = random(referenceViews.length);
				referenceViews[alias][1] ^= 0xFFFF0000;
				actualViews[alias][1] ^= 0xFFFF0000;
				compare();
			}
			assert.strictEqual(frees, iteration, 'Supported traces must retain the owning native store');
			actual.flush();
			reference.flush();
			compare();
		} finally { disposables.dispose(); }
		assert.strictEqual(frees, iteration + 1);
	}
});

test('Rust owning syntax stores retain unsupported state and aliases and release on fallback/model disposal', () => {
	let frees = 0;
	class CountedStore extends rust.WasmContiguousTokensStore {
		public override free(): void { frees++; super.free(); }
	}
	const module = { ...rust, WasmContiguousTokensStore: CountedStore };
	for (const invalid of [new Uint32Array([1]), new Uint32Array([1, 7, 3]), new Uint32Array()]) {
		const disposables = new DisposableStore();
		try {
			const codec = new LanguageIdCodec();
			const reference = disposables.add(new ContiguousTokensStore(codec));
			const actual = withRust(() => disposables.add(new ContiguousTokensStore(codec)), module);
			reference.setTokens('plaintext', 0, 3, invalid.slice(), true);
			actual.setTokens('plaintext', 0, 3, invalid.slice(), true);
			const range = new Range(1, 2, 1, 3);
			reference.acceptEdit(range, 0, 1);
			actual.acceptEdit(range, 0, 1);
			const errors: string[] = [];
			const previousHandler = errorHandler.getUnexpectedErrorHandler();
			setUnexpectedErrorHandler((error: Error) => errors.push(error.message));
			try {
				assert.deepStrictEqual(actual.getTokens('plaintext', 0, 'text').getEncodedTokens(), reference.getTokens('plaintext', 0, 'text').getEncodedTokens());
				assert.deepStrictEqual(errors, ['Token length and text length do not match!', 'Token length and text length do not match!']);
			} finally { setUnexpectedErrorHandler(previousHandler); }
		} finally { disposables.dispose(); }
	}
	const disposables = new DisposableStore();
	try {
		const codec = new LanguageIdCodec();
		const reference = disposables.add(new ContiguousTokensStore(codec));
		const actual = withRust(() => disposables.add(new ContiguousTokensStore(codec)), module);
		const original = offsetView([3, 7]);
		const native = offsetView([3, 7]);
		reference.setTokens('plaintext', 1, 3, original, true);
		actual.setTokens('plaintext', 1, 3, native, true);
		const before = frees;
		reference.setTokens('plaintext', 0, 2.5, null, true);
		actual.setTokens('plaintext', 0, 2.5, null, true);
		assert.strictEqual(frees, before + 1);
		original[1] = native[1] = 0xFF000007;
		assert.deepStrictEqual(actual.getTokens('plaintext', 1, 'tex').getEncodedTokens(), reference.getTokens('plaintext', 1, 'tex').getEncodedTokens());
	} finally { disposables.dispose(); }
	const before = frees;
	const registration = registerRustTextBuffer(module);
	let model: ReturnType<typeof createTextModel>;
	try { model = createTextModel('text'); } finally { registration.dispose(); }
	model.dispose();
	assert.strictEqual(frees, before + 1);
	const store = new rust.WasmContiguousTokensStore(EMPTY_LINE_TOKENS);
	try {
		assert.throws(() => store.accept_edit(new Float64Array([1])), /edit/);
		assert.strictEqual(store.set_tokens(1, 262144, 3, null, true), undefined);
		assert.strictEqual(store.accept_edit(new Float64Array([1, 2, 1, 1, 0, 0])), false);
		assert.deepStrictEqual(store.export_lines(), []);
	} finally { store.free(); }
});

test('Rust owning syntax stores retain shared source buffers through line joins and model debug stores release on replacement', () => {
	const disposables = new DisposableStore();
	let created = 0;
	let freed = 0;
	let backgroundCreated = 0;
	let backgroundDisposed = 0;
	const backgroundStores: IBackgroundTokenizationStore[] = [];
	class CountedStore extends rust.WasmContiguousTokensStore {
		constructor(empty: ArrayBuffer) { super(empty); created++; }
		public override free(): void { freed++; super.free(); }
	}
	try {
		const codec = new LanguageIdCodec();
		const reference = disposables.add(new ContiguousTokensStore(codec));
		const actual = withRust(() => disposables.add(new ContiguousTokensStore(codec)));
		const original = offsetView([3, 7, 6, 9, 10, 11]);
		const native = offsetView([3, 7, 6, 9, 10, 11]);
		for (let line = 0; line < 2; line++) {
			reference.setTokens('plaintext', line, 10, original, false);
			actual.setTokens('plaintext', line, 10, native, false);
		}
		reference.acceptEdit(new Range(1, 3, 2, 4), 0, 1);
		actual.acceptEdit(new Range(1, 3, 2, 4), 0, 1);
		assert.deepStrictEqual(new Uint32Array(native.buffer), new Uint32Array(original.buffer));
		const errors: string[] = [];
		const previousHandler = errorHandler.getUnexpectedErrorHandler();
		setUnexpectedErrorHandler((error: Error) => errors.push(error.message));
		try {
			const expected = reference.getTokens('plaintext', 0, 'joined').getEncodedTokens();
			const firstErrors = errors.slice();
			errors.length = 0;
			const result = actual.getTokens('plaintext', 0, 'joined').getEncodedTokens();
			assert.deepStrictEqual({ result, errors }, { result: expected, errors: firstErrors });
		} finally { setUnexpectedErrorHandler(previousHandler); }
		const services = createModelServices(disposables);
		const languages = services.get(ILanguageService);
		const language = 'rust-token-store-lifetime';
		disposables.add(languages.registerLanguage({ id: language }));
		const metadata = languages.languageIdCodec.encodeLanguageId(language) | 0x02008400;
		const support: ITokenizationSupport = {
			backgroundTokenizerShouldOnlyVerifyTokens: true,
			getInitialState: () => NullState,
			tokenize: () => nullTokenize(language, NullState),
			tokenizeEncoded: (_line, _hasEOL, state) => new EncodedTokenizationResult(new Uint32Array([0, metadata]), [], state),
			createBackgroundTokenizer: (_model, store) => {
				backgroundCreated++;
				backgroundStores.push(store);
				return { requestTokens: () => { }, dispose: () => { backgroundDisposed++; } };
			}
		};
		disposables.add(TokenizationRegistry.register(language, support));
		disposables.add(registerRustTextBuffer({ ...rust, WasmContiguousTokensStore: CountedStore }));
		const model = disposables.add(instantiateTextModel(services, 'first\nnext', language));
		for (let index = 0; index < 20; index++) {
			model.setValue(`value${index}\nnext`);
			backgroundStores[backgroundStores.length - 1].setTokens([new ContiguousMultilineTokens(1, model.getLinesContent().map(line => new Uint32Array([line.length, metadata])))]);
			model.tokenization.forceTokenization(2);
			assert.strictEqual(created - freed, 2, 'Only current foreground and verification stores may remain live');
		}
		model.dispose();
		assert.deepStrictEqual({ created, freed, backgroundCreated, backgroundDisposed }, { created: backgroundCreated + 1, freed: created, backgroundCreated, backgroundDisposed: backgroundCreated });
	} finally { disposables.dispose(); }
});
