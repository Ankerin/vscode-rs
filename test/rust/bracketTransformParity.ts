/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { LanguageBracketsConfiguration } from '../../src/vs/editor/common/languages/supports/languageBracketsConfiguration.js';
import { AstNode, BracketAstNode, ListAstNode, PairAstNode, TextAstNode } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/ast.js';
import { toLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/length.js';
import { IRustBracketTransformModule, registerRustBracketTransform } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketTransform.js';
import { SmallImmutableSet } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/smallImmutableSet.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustBracketTransformModule = rust): T {
	const registration = registerRustBracketTransform(module);
	try { return compute(); } finally { registration.dispose(); }
}

function snapshot(node: AstNode | null): object | null {
	if (!node) { return null; }
	return { kind: node.kind, height: node.listHeight, length: node.length, missing: node.missingOpeningBracketIds, type: node.constructor.name, children: Array.from({ length: node.childrenLength }, (_, index) => snapshot(node.getChild(index))) };
}

test('Rust bracket transforms preserve seeded clone/flatten classes, shallow copies, and leaf identities', () => {
	let seed = 1399;
	let calls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const module: IRustBracketTransformModule = { ...rust, transform_bracket_ast: (...args) => { calls++; return rust.transform_bracket_ast(...args); } };
	for (let trace = 0; trace < 256; trace++) {
		const lengths = Array.from({ length: 64 }, () => toLength(random(3), random(8)));
		for (const immutable of [false, true]) {
			const run = () => {
				let index = 0;
				const create = (depth: number): AstNode => depth === 0 ? new TextAstNode(lengths[index++ % lengths.length]) : ListAstNode.create23(create(depth - 1), create(depth - 1), create(depth - 1), immutable);
				const compact = create(3) as ListAstNode;
				const array = ListAstNode.create([compact, create(1)], immutable);
				const configuration = new LanguageBracketsConfiguration('parity', { brackets: [['(', ')']] });
				const opening = BracketAstNode.create(toLength(0, 1), configuration.getOpeningBracketInfo('(')!, SmallImmutableSet.getEmpty());
				const closing = BracketAstNode.create(toLength(0, 1), configuration.getClosingBracketInfo(')')!, SmallImmutableSet.getEmpty());
				const pair = PairAstNode.create(opening, array, trace % 2 ? closing : null);
				const mutableCompact = compact.toMutable();
				const mutableArray = array.toMutable();
				return { clone: snapshot(pair.deepClone()), flat: snapshot(pair.flattenLists()), compact: snapshot(mutableCompact), array: snapshot(mutableArray), sameCompact: mutableCompact === compact, sameArray: mutableArray === array, childShared: mutableArray.getChild(0) === array.getChild(0), leafShared: opening.deepClone() === opening && opening.flattenLists() === opening };
			};
			assert.deepStrictEqual(withRust(run, module), run(), `Bracket transform trace ${trace}/${immutable}`);
		}
	}
	assert.ok(calls > 10000, 'Actual clone, flatten, and shallow mutable operations execute in Rust');
});

test('Rust bracket transforms preserve receiver proxies, live clone-array growth, and pair factory lookup order', () => {
	const factory = Object.getOwnPropertyDescriptor(PairAstNode, 'create')!;
	const run = () => {
		const observations: string[] = [];
		const first = new TextAstNode(toLength(0, 1));
		const items: AstNode[] = [first, new TextAstNode(toLength(0, 2))];
		Object.defineProperty(first, 'deepClone', { value: () => { observations.push('clone:child'); if (items.length === 2) { items.push(new TextAstNode(toLength(0, 3))); } return first; } });
		const array = ListAstNode.create(items);
		const receiver = new Proxy(array, { get: (target, key, receiver) => { observations.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); } });
		const cloned = receiver.deepClone();
		const configuration = new LanguageBracketsConfiguration('parity', { brackets: [['(', ')']] });
		const opening = BracketAstNode.create(toLength(0, 1), configuration.getOpeningBracketInfo('(')!, SmallImmutableSet.getEmpty());
		const pair = PairAstNode.create(opening, first, null);
		Object.defineProperty(opening, 'flattenLists', { get: () => { observations.push('opening:method'); return () => opening; } });
		Object.defineProperty(PairAstNode, 'create', { configurable: true, get: () => { observations.push('factory:get'); return factory.value; } });
		try { return { cloned: snapshot(cloned), flat: snapshot(pair.flattenLists()), observations }; } finally { Object.defineProperty(PairAstNode, 'create', factory); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust bracket flattening preserves iterator steps and original body failures despite failing close', () => {
	const stepFailure = new Error('Original bracket flatten iterator failure');
	const bodyFailure = new Error('Original bracket flatten child failure');
	const closeFailure = new Error('Original bracket flatten close failure');
	for (const mode of ['complete', 'step', 'body', 'bodyClose'] as const) {
		const run = () => {
			const observations: string[] = [];
			const child = new TextAstNode(toLength(0, 1));
			const root = ListAstNode.create([child]);
			if (mode === 'body' || mode === 'bodyClose') { Object.defineProperty(child, 'flattenLists', { value: () => { observations.push('body'); throw bodyFailure; } }); }
			Object.defineProperty(root, 'children', {
				get: () => ({
					[Symbol.iterator]: () => {
						observations.push('iterator');
						let next = false;
						return {
							next: () => { observations.push('next'); if (mode === 'step') { throw stepFailure; } const done = next; next = true; return { done, value: child }; },
							return: () => { observations.push('close'); if (mode === 'bodyClose') { throw closeFailure; } return {}; }
						};
					}
				})
			});
			const flatten = () => root.flattenLists();
			let result: object | null = null;
			if (mode === 'step') { assert.throws(flatten, error => error === stepFailure); }
			else if (mode === 'body' || mode === 'bodyClose') { assert.throws(flatten, error => error === bodyFailure); }
			else { result = snapshot(flatten()); }
			return { result, observations };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust bracket transforms release scoped results and reject stale registrations atomically', () => {
	let frees = 0;
	const failure = new Error('Original bracket transform result consumption failure');
	const module: IRustBracketTransformModule = { ...rust, transform_bracket_ast: () => ({ take: () => { throw failure; }, free: () => { frees++; } }) };
	withRust(() => assert.throws(() => new TextAstNode(toLength(0, 1)).deepClone(), error => error === failure), module);
	assert.strictEqual(frees, 1);
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_transform_abi_version: () => 0 }), /AST transform contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketTransform(rust), /already registered/); } finally { registration.dispose(); }
});
