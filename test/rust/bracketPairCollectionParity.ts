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
import { IRustBracketPairCollectionModule, registerRustBracketPairCollection } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketPairCollection.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';
import { BracketPairWithMinIndentationInfo } from '../../src/vs/editor/common/textModelBracketPairs.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustBracketPairCollectionModule = rust): T {
	const registration = registerRustBracketPairCollection(module);
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

function snapshot(item: BracketPairWithMinIndentationInfo): object {
	return { range: item.range, opening: item.openingBracketRange, closing: item.closingBracketRange, level: item.nestingLevel, equalLevel: item.nestingLevelOfEqualBracketType, indentation: item.minVisibleColumnIndentation };
}

test('Rust bracket pair collection preserves seeded windows, indentation, nesting, and AST identities', () => {
	let seed = 1193;
	let calls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const fragments = ['(', ')', '[', ']', '{', '}', '<', '>', 'begin ', 'end ', 'x', '\n', '\t', '  ', '\uD83D\uDE00'];
	const module: IRustBracketPairCollectionModule = { ...rust, collect_bracket_pairs: (...args) => { calls++; return rust.collect_bracket_pairs(...args); } };
	for (let trace = 0; trace < 128; trace++) {
		const text = Array.from({ length: 64 }, () => fragments[random(fragments.length)]).join('');
		const windows = Array.from({ length: 12 }, () => { const start = random(text.length + 1); return [start, start + random(text.length - start + 1)]; });
		const run = () => withTree(text, (tree, range, positionRange) => {
			const all = [false, true].map(indentation => tree.getBracketPairsInRange(range, indentation).toArray());
			const selected = windows.map(([start, end]) => [false, true].map(indentation => tree.getBracketPairsInRange(positionRange(start, end), indentation).toArray()));
			return { all, selected };
		});
		assert.deepStrictEqual(withRust(run, module), run(), `Bracket pair trace ${trace}`);
	}
	assert.ok(calls > 10000, 'Actual bracket pair collection executes in Rust');
	for (const text of ['('.repeat(256) + ')'.repeat(256), '(x', ')])', '(\n  {\n\tx\n  }\n)']) {
		const run = () => withTree(text, (tree, range) => [false, true].map(indentation => tree.getBracketPairsInRange(range, indentation).toArray()));
		assert.deepStrictEqual(withRust(run), run());
	}
	withRust(() => withTree('(x)', (tree, range) => {
		const first = tree.getBracketPairsInRange(range, true).toArray()[0];
		const second = tree.getBracketPairsInRange(range, true).toArray()[0];
		assert.strictEqual(Object.getOwnPropertyDescriptor(first, 'bracketPairNode')!.value, Object.getOwnPropertyDescriptor(second, 'bracketPairNode')!.value);
	}));
});

test('Rust bracket pair collection preserves proxy reads and indentation factory order', () => {
	const run = () => withTree('({\n  x\n}[y]) <z>', (tree, range, positionRange) => {
		const observations: string[] = [];
		const proxies = new Map<AstNode, AstNode>();
		const wrap = (node: AstNode): AstNode => {
			const existing = proxies.get(node);
			if (existing) { return existing; }
			const proxy = new Proxy(node, {
				get: (target, key, receiver) => {
					observations.push(`node:${String(key)}`);
					const value = Reflect.get(target, key, receiver);
					if (value instanceof PairAstNode || value instanceof ListAstNode || value instanceof BracketAstNode || value instanceof InvalidBracketAstNode || value instanceof TextAstNode) { return wrap(value); }
					if (key === 'children') { return (value as AstNode[]).map(wrap); }
					return value;
				}
			});
			proxies.set(node, proxy);
			return proxy;
		};
		const descriptor = Object.getOwnPropertyDescriptor(tree, 'initialAstWithoutTokens')!;
		Object.defineProperty(tree, 'initialAstWithoutTokens', { ...descriptor, value: wrap(descriptor.value as AstNode) });
		const results = [range, positionRange(1, 3), positionRange(3, 7)].map(range => [false, true].map(indentation => tree.getBracketPairsInRange(range, indentation).toArray().map(snapshot)));
		return { results, observations };
	});
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust bracket pair collection preserves custom iterator steps, normal stops, and thrown closing', () => {
	const bodyFailure = new Error('Original pair callback failure');
	const stepFailure = new Error('Original pair iterator step failure');
	const closeFailure = new Error('Original pair iterator close failure');
	for (const mode of ['complete', 'stop', 'throw', 'step', 'close', 'throwClose', 'invalidClose'] as const) {
		const run = () => withTree('(x) [y]', (tree, range) => {
			const observations: string[] = [];
			const root = Object.getOwnPropertyDescriptor(tree, 'initialAstWithoutTokens')!.value as AstNode;
			const children = root.children;
			Object.defineProperty(root, 'children', {
				get: () => {
					observations.push('children');
					return {
						[Symbol.iterator]: () => {
							observations.push('iterator');
							let index = 0;
							return {
								get next() {
									observations.push('next:get');
									return () => {
										observations.push('next:call');
										if (mode === 'step') { throw stepFailure; }
										const current = index++;
										return { get done() { observations.push('done'); return current >= children.length; }, get value() { observations.push('value'); return children[current]; } };
									};
								},
								get return() {
									observations.push('return:get');
									return () => { observations.push('return:call'); if (mode === 'close' || mode === 'throwClose') { throw closeFailure; } return mode === 'invalidClose' ? 0 : {}; };
								}
							};
						}
					};
				}
			});
			const items: object[] = [];
			const collect = () => tree.getBracketPairsInRange(range, false).iterate(item => {
				items.push(snapshot(item));
				if (mode === 'throw' || mode === 'throwClose') { throw bodyFailure; }
				return mode === 'complete';
			});
			if (mode === 'throw' || mode === 'throwClose') { assert.throws(collect, error => error === bodyFailure); }
			else if (mode === 'step') { assert.throws(collect, error => error === stepFailure); }
			else if (mode === 'close') { assert.throws(collect, error => error === closeFailure); }
			else if (mode === 'invalidClose') { assert.throws(collect, TypeError); }
			else { collect(); }
			return { observations, items };
		});
		assert.deepStrictEqual(withRust(run), run(), `Iterator completion ${mode}`);
	}
});

test('Rust bracket pair collection preserves reentrancy, falsy stops, and callback failure identity', () => {
	const failure = new Error('Original bracket pair callback failure');
	for (const stop of [false, undefined, 0, '']) {
		const run = () => withTree('({x}[y])', (tree, range) => {
			const items: object[] = [];
			tree.getBracketPairsInRange(range, true).iterate(item => { items.push(snapshot(item)); return stop as boolean; });
			return items;
		});
		assert.deepStrictEqual(withRust(run), run());
	}
	const reentrant = () => withTree('({x}[y])', (tree, range) => {
		const observations: object[] = [];
		let nested = false;
		tree.getBracketPairsInRange(range, true).iterate(item => { observations.push(snapshot(item)); if (!nested) { nested = true; observations.push(tree.getBracketPairsInRange(range, true).toArray().map(snapshot)); } return true; });
		return observations;
	});
	assert.deepStrictEqual(withRust(reentrant), reentrant());
	for (const failAt of [1, 2, 3]) {
		const run = () => withTree('({x}[y])', (tree, range) => {
			const items: object[] = [];
			assert.throws(() => tree.getBracketPairsInRange(range, true).iterate(item => { items.push(snapshot(item)); if (items.length === failAt) { throw failure; } return true; }), error => error === failure);
			return { items, next: tree.getBracketPairsInRange(range, true).toArray().map(snapshot) };
		});
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust bracket pair collection releases results and rolls back incompatible registration', () => {
	let frees = 0;
	const failure = new Error('Original bracket pair result consumption failure');
	const module: IRustBracketPairCollectionModule = { ...rust, collect_bracket_pairs: () => ({ take: () => { throw failure; }, free: () => { frees++; } }) };
	withRust(() => withTree('(x)', (tree, range) => assert.throws(() => tree.getBracketPairsInRange(range, false).toArray(), error => error === failure)), module);
	assert.strictEqual(frees, 1);
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_pair_collection_abi_version: () => 0 }), /pair range contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketPairCollection(rust), /already registered/); } finally { registration.dispose(); }
});
