/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { DisposableStore } from '../../src/vs/base/common/lifecycle.js';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { ResolvedLanguageConfiguration } from '../../src/vs/editor/common/languages/languageConfigurationRegistry.js';
import { AstNode, BracketAstNode, InvalidBracketAstNode, ListAstNode, PairAstNode, TextAstNode } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/ast.js';
import { BracketPairsTree } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/bracketPairsTree.js';
import { IRustBracketCollectionModule, registerRustBracketCollection } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketCollection.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustBracketCollectionModule = rust): T {
	const registration = registerRustBracketCollection(module);
	try { return compute(); } finally { registration.dispose(); }
}

function withTree<T>(text: string, compute: (tree: BracketPairsTree, range: Range, positionRange: (start: number, end: number) => Range) => T): T {
	const disposables = new DisposableStore();
	try {
		const model = disposables.add(createTextModel(text, 'parity'));
		const tree = disposables.add(new BracketPairsTree(model, language => new ResolvedLanguageConfiguration(language, { brackets: [['(', ')'], ['[', ']'], ['{', '}'], ['<', '>'], ['begin', 'end']] })));
		return compute(tree, model.getFullModelRange(), (start, end) => Range.fromPositions(model.getPositionAt(start), model.getPositionAt(end)));
	} finally { disposables.dispose(); }
}

test('Rust bracket range collection preserves seeded windows, colorization, nesting, and callback stop order', () => {
	let seed = 1153;
	let calls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const fragments = ['(', ')', '[', ']', '{', '}', '<', '>', 'begin ', 'end ', 'x', '\n', '😀'];
	const module: IRustBracketCollectionModule = { ...rust, collect_brackets: (...args) => { calls++; return rust.collect_brackets(...args); } };
	for (let trace = 0; trace < 256; trace++) {
		const text = Array.from({ length: 64 }, () => fragments[random(fragments.length)]).join('');
		const windows = Array.from({ length: 16 }, () => {
			const start = random(text.length + 1);
			return [start, start + random(text.length - start + 1)];
		});
		const run = () => withTree(text, (tree, range, positionRange) => {
			const all = [false, true].map(colorized => tree.getBracketsInRange(range, colorized).toArray());
			const selected = windows.map(([start, end]) => [false, true].map(colorized => tree.getBracketsInRange(positionRange(start, end), colorized).toArray()));
			const stopped = [1, 2, 5].map(limit => {
				const items: object[] = [];
				tree.getBracketsInRange(range, true).iterate(item => { items.push(item); return items.length < limit; });
				return items;
			});
			return { all, selected, stopped };
		});
		assert.deepStrictEqual(withRust(run, module), run(), `Bracket collection trace ${trace}`);
	}
	assert.ok(calls > 10000, 'Actual bracket range collection executes in Rust');
	for (const text of ['('.repeat(256) + ')'.repeat(256), '<x(y)>', '(x', ')])', '({[]}())']) {
		const run = () => withTree(text, (tree, range) => [false, true].map(colorized => tree.getBracketsInRange(range, colorized).toArray()));
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust bracket range collection preserves AST proxy observations, sparse children, and tail descent', () => {
	const run = () => withTree('({x}[y]) <z> )', (tree, range, positionRange) => {
		const observations: string[] = [];
		const proxies = new Map<AstNode, AstNode>();
		const isNode = (value: object): value is AstNode => value instanceof PairAstNode || value instanceof ListAstNode || value instanceof BracketAstNode || value instanceof InvalidBracketAstNode || value instanceof TextAstNode;
		const wrap = (node: AstNode): AstNode => {
			const existing = proxies.get(node);
			if (existing) { return existing; }
			const proxy = new Proxy(node, {
				get: (target, key, receiver) => {
					observations.push(`node:${String(key)}`);
					const value = Reflect.get(target, key, receiver);
					return value && typeof value === 'object' && isNode(value) ? wrap(value) : value;
				}
			});
			proxies.set(node, proxy);
			return proxy;
		};
		const descriptor = Object.getOwnPropertyDescriptor(tree, 'initialAstWithoutTokens')!;
		Object.defineProperty(tree, 'initialAstWithoutTokens', { ...descriptor, value: wrap(descriptor.value as AstNode) });
		const results = [range, positionRange(1, 3), positionRange(3, 7), positionRange(8, 12)].map(range => tree.getBracketsInRange(range, true).toArray());
		return { results, observations };
	});
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust bracket range collection preserves reentrant callbacks, falsy stops, and original callback failures', () => {
	const failure = new Error('Original bracket range callback failure');
	for (const stop of [false, undefined, 0, '']) {
		const run = () => withTree('({x}[y])', (tree, range) => {
			const items: object[] = [];
			tree.getBracketsInRange(range, true).iterate(item => { items.push(item); return stop as boolean; });
			return items;
		});
		assert.deepStrictEqual(withRust(run), run());
	}
	const reentrant = () => withTree('({x}[y])', (tree, range) => {
		const observations: object[] = [];
		let nested = false;
		tree.getBracketsInRange(range, true).iterate(item => {
			observations.push(item);
			if (!nested) { nested = true; observations.push(tree.getBracketsInRange(range, true).toArray()); }
			return true;
		});
		return observations;
	});
	assert.deepStrictEqual(withRust(reentrant), reentrant());
	for (const failAt of [1, 2, 3]) {
		const run = () => withTree('({x}[y])', (tree, range) => {
			const items: object[] = [];
			assert.throws(() => tree.getBracketsInRange(range, true).iterate(item => { items.push(item); if (items.length === failAt) { throw failure; } return true; }), error => error === failure);
			return { items, next: tree.getBracketsInRange(range, true).toArray() };
		});
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust bracket range collection releases scoped results and rejects stale registrations atomically', () => {
	let frees = 0;
	const failure = new Error('Original bracket range result consumption failure');
	const module: IRustBracketCollectionModule = { ...rust, collect_brackets: () => ({ take: () => { throw failure; }, free: () => { frees++; } }) };
	withRust(() => withTree('(x)', (tree, range) => assert.throws(() => tree.getBracketsInRange(range, true).toArray(), error => error === failure)), module);
	assert.strictEqual(frees, 1);
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_collection_abi_version: () => 0 }), /colorized range contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketCollection(rust), /already registered/); } finally { registration.dispose(); }
});

