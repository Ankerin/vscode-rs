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
import { Position } from '../../src/vs/editor/common/core/position.js';
import { ResolvedLanguageConfiguration } from '../../src/vs/editor/common/languages/languageConfigurationRegistry.js';
import { AstNode, BracketAstNode, InvalidBracketAstNode, ListAstNode, PairAstNode, TextAstNode } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/ast.js';
import { BracketPairsTree } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/bracketPairsTree.js';
import { IRustBracketSearchModule, registerRustBracketSearch } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketSearch.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';
import { TextModel } from '../../src/vs/editor/common/model/textModel.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustBracketSearchModule = rust): T {
	const registration = registerRustBracketSearch(module);
	try { return compute(); } finally { registration.dispose(); }
}

function withTree<T>(text: string, compute: (tree: BracketPairsTree, model: TextModel, configuration: ResolvedLanguageConfiguration) => T): T {
	const disposables = new DisposableStore();
	try {
		const model = disposables.add(createTextModel(text, 'parity'));
		const configuration = new ResolvedLanguageConfiguration(model.getLanguageId(), { brackets: [['(', ')'], ['[', ']'], ['{', '}'], ['<', '>'], ['begin', 'end']] });
		const tree = disposables.add(new BracketPairsTree(model, () => configuration));
		return compute(tree, model, configuration);
	} finally { disposables.dispose(); }
}

test('Rust bracket searches preserve seeded nearest and unmatched queries at UTF-16 positions', () => {
	let seed = 1223;
	let finds = 0;
	let unmatched = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const fragments = ['(', ')', '[', ']', '{', '}', '<', '>', 'begin ', 'end ', 'x', '\n', '\t', '\uD83D\uDE00', '\uD800', '\uDC00'];
	const module: IRustBracketSearchModule = { ...rust, find_bracket: (...args) => { finds++; return rust.find_bracket(...args); }, has_unmatched_bracket: (...args) => { unmatched++; return rust.has_unmatched_bracket(...args); } };
	for (let trace = 0; trace < 128; trace++) {
		const text = Array.from({ length: 64 }, () => fragments[random(fragments.length)]).join('');
		const positions = Array.from({ length: 24 }, () => random(text.length + 1));
		const run = () => withTree(text, (tree, model, configuration) => positions.map(offset => {
			const position = model.getPositionAt(offset);
			return { before: tree.getFirstBracketBefore(position), after: tree.getFirstBracketAfter(position), unmatched: configuration.bracketsNew.openingBrackets.map(opening => tree.hasUnmatchedClosingBracketAfter(position, opening)) };
		}));
		assert.deepStrictEqual(withRust(run, module), run(), `Bracket search trace ${trace}`);
	}
	assert.ok(finds > 10000 && unmatched > 10000, 'Actual nearest and unmatched bracket queries execute in Rust');
	for (const text of ['', ') ] }', '(x)', '(\n[x]\n)', 'begin x end']) {
		const run = () => withTree(text, (tree, model) => Array.from({ length: text.length + 1 }, (_, offset) => {
			const position = model.getPositionAt(offset);
			return [tree.getFirstBracketBefore(position), tree.getFirstBracketAfter(position)];
		}));
		assert.deepStrictEqual(withRust(run), run());
	}
	withRust(() => withTree('(x)', (tree, model) => assert.strictEqual(tree.getFirstBracketAfter(new Position(1, 1))!.bracketInfo, tree.getBracketPairsInRange(model.getFullModelRange(), false).toArray()[0].openingBracketInfo)));
});

test('Rust bracket searches preserve AST proxy reads and reverse children rereads', () => {
	const run = () => withTree('({x}[y]) <z> )', (tree, model, configuration) => {
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
		for (const key of ['initialAstWithoutTokens', 'astWithTokens']) {
			const descriptor = Object.getOwnPropertyDescriptor(tree, key)!;
			Object.defineProperty(tree, key, { ...descriptor, value: wrap(descriptor.value as AstNode) });
		}
		const results = [0, 1, 3, 7, 10, 12, 14].map(offset => {
			const position = model.getPositionAt(offset);
			return [tree.getFirstBracketBefore(position), tree.getFirstBracketAfter(position), configuration.bracketsNew.openingBrackets.map(opening => tree.hasUnmatchedClosingBracketAfter(position, opening))];
		});
		return { results, observations };
	});
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust bracket searches preserve custom iterators and normal versus thrown close precedence', () => {
	const stepFailure = new Error('Original bracket search step failure');
	const bodyFailure = new Error('Original bracket search body failure');
	const closeFailure = new Error('Original bracket search close failure');
	for (const before of [false, true]) {
		for (const mode of ['complete', 'step', 'body', 'close', 'bodyClose', 'invalidClose'] as const) {
			const run = () => withTree('(x) [y]', (tree, model) => {
				const observations: string[] = [];
				const root = Object.getOwnPropertyDescriptor(tree, 'initialAstWithoutTokens')!.value as AstNode;
				const children = root.children;
				const iterable = new Proxy(children, {
					get: (target, key, receiver) => {
						if (key !== Symbol.iterator) { return Reflect.get(target, key, receiver); }
						observations.push('iterator:get');
						return () => {
							observations.push('iterator:call');
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
									return () => { observations.push('return:call'); if (mode === 'close' || mode === 'bodyClose') { throw closeFailure; } return mode === 'invalidClose' ? 0 : {}; };
								}
							};
						};
					}
				});
				Object.defineProperty(root, 'children', { get: () => { observations.push('children'); return iterable; } });
				if (mode === 'body' || mode === 'bodyClose') { Object.defineProperty(children[0], 'length', { get: () => { observations.push('length:throw'); throw bodyFailure; } }); }
				const find = () => before ? tree.getFirstBracketBefore(model.getPositionAt(model.getValueLength())) : tree.getFirstBracketAfter(new Position(1, 1));
				let result: object | null = null;
				if (mode === 'step') { assert.throws(find, error => error === stepFailure); }
				else if (mode === 'body' || mode === 'bodyClose') { assert.throws(find, error => error === bodyFailure); }
				else if (!before && mode === 'close') { assert.throws(find, error => error === closeFailure); }
				else if (!before && mode === 'invalidClose') { assert.throws(find, TypeError); }
				else { result = find(); }
				return { result, observations };
			});
			assert.deepStrictEqual(withRust(run), run(), `Search iterator ${before}/${mode}`);
		}
	}
});

test('Rust unmatched bracket searches preserve provider failure identity and reentrant queries', () => {
	const failure = new Error('Original unmatched bracket set failure');
	const run = () => withTree('} text }', (tree, model, configuration) => {
		const root = Object.getOwnPropertyDescriptor(tree, 'astWithTokens')!.value as AstNode;
		const original = root.missingOpeningBracketIds;
		const observations: (object | boolean | null)[] = [];
		let nested = false;
		Object.defineProperty(root, 'missingOpeningBracketIds', {
			get: () => {
				if (!nested) { nested = true; observations.push(tree.getFirstBracketAfter(new Position(1, 1))); }
				return original;
			}
		});
		const opening = configuration.bracketsNew.getOpeningBracketInfo('{')!;
		observations.push(tree.hasUnmatchedClosingBracketAfter(new Position(1, 1), opening));
		const child = root.children[0];
		Object.defineProperty(child, 'missingOpeningBracketIds', { get: () => { throw failure; } });
		assert.throws(() => tree.hasUnmatchedClosingBracketAfter(model.getPositionAt(0), opening), error => error === failure);
		return observations;
	});
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust bracket searches release scoped results and reject incompatible bindings atomically', () => {
	let frees = 0;
	const failure = new Error('Original bracket search result consumption failure');
	const module: IRustBracketSearchModule = { ...rust, find_bracket: () => ({ take: () => { throw failure; }, free: () => { frees++; } }) };
	withRust(() => withTree('(x)', tree => assert.throws(() => tree.getFirstBracketAfter(new Position(1, 1)), error => error === failure)), module);
	assert.strictEqual(frees, 1);
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_search_abi_version: () => 0 }), /bracket search contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketSearch(rust), /already registered/); } finally { registration.dispose(); }
});
