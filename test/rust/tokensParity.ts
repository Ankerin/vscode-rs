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
import { IRustTokensModule, registerRustTokens, tryAppendRustContiguousTokens, tryEditRustSparseTokens, tryMergeRustSemanticTokens, tryRemoveRustSparseTokens, trySplitRustSparseTokens, tryUpdateRustContiguousTokens } from '../../src/vs/editor/common/tokens/rustTokens.js';
import { ContiguousTokensEditing, EMPTY_LINE_TOKENS, toUint32Array } from '../../src/vs/editor/common/tokens/contiguousTokensEditing.js';
import { ContiguousMultilineTokens } from '../../src/vs/editor/common/tokens/contiguousMultilineTokens.js';
import { SparseMultilineTokens } from '../../src/vs/editor/common/tokens/sparseMultilineTokens.js';
import { SparseTokensStore } from '../../src/vs/editor/common/tokens/sparseTokensStore.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';

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
			const reference = store.addSparseTokens(4, syntax);
			const actual = withRust(() => store.addSparseTokens(4, syntax));
			assert.deepStrictEqual({ tokens: actual.getEncodedTokens(), text: actual.getLineContent(), syntax: new Uint32Array(contiguous.buffer), sparse: new Uint32Array(semantic.buffer) }, { tokens: reference.getEncodedTokens(), text, syntax: beforeSyntax, sparse: beforeSemantic }, `Semantic overlay ${iteration}/${mask}`);
		}
	}
});

test('Rust semantic overlays preserve identity shortcuts, unsupported fallback, and atomic registration', () => {
	const syntax = new LineTokens(new Uint32Array([4, 0xFF010407]), 'text', new LanguageIdCodec());
	const sparse = new Uint32Array([0, 1, 3, 0x8028803F]);
	const store = createStore(sparse);
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
