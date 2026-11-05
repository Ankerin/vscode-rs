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
import { IRustTokensModule, registerRustTokens, tryMergeRustSemanticTokens } from '../../src/vs/editor/common/tokens/rustTokens.js';
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
