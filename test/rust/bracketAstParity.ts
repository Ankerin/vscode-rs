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
import { AstNode, BracketAstNode, InvalidBracketAstNode, ListAstNode, PairAstNode, TextAstNode } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/ast.js';
import { toLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/length.js';
import { IRustBracketAstModule, registerRustBracketAst } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketAst.js';
import { identityKeyProvider, SmallImmutableSet } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/smallImmutableSet.js';
import { OpeningBracketId } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/tokenizer.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustBracketAstModule = rust): T {
	const registration = registerRustBracketAst(module);
	try { return compute(); } finally { registration.dispose(); }
}

function snapshot(node: AstNode | null | undefined): object | null {
	if (!node) { return null; }
	return { kind: node.kind, height: node.listHeight, length: node.length, missing: node.missingOpeningBracketIds, type: node.constructor.name, children: Array.from({ length: node.childrenLength }, (_, index) => snapshot(node.getChild(index))) };
}

test('Rust bracket AST algorithms preserve seeded factories, metadata, aliases, reuse, and mutable edges', () => {
	let seed = 1327;
	let calls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const module: IRustBracketAstModule = { ...rust, run_bracket_ast: (...args) => { calls++; return rust.run_bracket_ast(...args); } };
	for (let trace = 0; trace < 512; trace++) {
		const specs = Array.from({ length: 16 }, () => ({ kind: random(4), lines: random(3), columns: random(8), key: random(96), closed: random(2) === 0 }));
		for (const immutable of [false, true]) {
			const run = () => {
				const configuration = new LanguageBracketsConfiguration('parity', { brackets: [['(', ')']] });
				const empty = SmallImmutableSet.getEmpty<OpeningBracketId>();
				const items = specs.map(spec => {
					const ids = empty.add(spec.key as OpeningBracketId, identityKeyProvider);
					const length = toLength(spec.lines, spec.columns);
					if (spec.kind === 0) { return new TextAstNode(length); }
					if (spec.kind === 1) { return new InvalidBracketAstNode(ids, length); }
					const opening = BracketAstNode.create(toLength(0, 1), configuration.getOpeningBracketInfo('(')!, ids);
					if (spec.kind === 2) { return opening; }
					return PairAstNode.create(opening, new InvalidBracketAstNode(ids, length), spec.closed ? BracketAstNode.create(toLength(0, 1), configuration.getClosingBracketInfo(')')!, ids) : null);
				});
				const array = ListAstNode.create(items, immutable);
				const compact = ListAstNode.create23(items[0], items[1], items[2], immutable);
				const reuse = [empty, empty.add(0 as OpeningBracketId, identityKeyProvider), empty.add(40 as OpeningBracketId, identityKeyProvider)].map(ids => [...items, array, compact].map(node => node.canBeReused(ids)));
				const parent = ListAstNode.create23(compact, ListAstNode.create23(items[3], items[4], null, true), null);
				const oldFirst = parent.getChild(0);
				const oldLast = parent.getChild(1);
				const first = parent.makeFirstElementMutable();
				const last = parent.makeLastElementMutable();
				parent.handleChildrenChanged();
				return { array: snapshot(array), compact: snapshot(compact), parent: snapshot(parent), reuse, alias: array.children === items, firstSame: first === oldFirst, lastSame: last === oldLast };
			};
			assert.deepStrictEqual(withRust(run, module), run(), `Bracket AST trace ${trace}/${immutable}`);
		}
	}
	assert.ok(calls > 10000, 'Actual AST factories, metadata, reuse, and mutable edges execute in Rust');
});

test('Rust bracket AST factories preserve array/node/set proxy reads and merge method lookup order', () => {
	const run = () => {
		const observations: string[] = [];
		const set = SmallImmutableSet.getEmpty<OpeningBracketId>().add(40 as OpeningBracketId, identityKeyProvider);
		const ids = new Proxy(set, { get: (target, key, receiver) => { observations.push(`set:${String(key)}`); return Reflect.get(target, key, receiver); } });
		const first = new InvalidBracketAstNode(ids, toLength(0, 1));
		const second = new InvalidBracketAstNode(SmallImmutableSet.getEmpty<OpeningBracketId>().add(50 as OpeningBracketId, identityKeyProvider), toLength(1, 2));
		const wrap = (node: AstNode) => new Proxy(node, { get: (target, key, receiver) => { observations.push(`node:${String(key)}`); return Reflect.get(target, key, receiver); } });
		const items = new Proxy([wrap(first), wrap(second)], { get: (target, key, receiver) => { observations.push(`array:${String(key)}`); return Reflect.get(target, key, receiver); } });
		const list = ListAstNode.create(items);
		const compact = ListAstNode.create23(items[0], items[1], null);
		const result = { lengths: [list.length, compact.length], heights: [list.listHeight, compact.listHeight], same: list.children === items };
		return { result, observations };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust bracket AST metadata and mutable edges preserve receiver proxies and partial setter failures', () => {
	for (const fail of ['none', '_length', '_missingOpeningBracketIds', 'cachedMinIndentation'] as const) {
		const run = () => {
			const observations: string[] = [];
			const node = ListAstNode.create23(new TextAstNode(toLength(0, 1)), new TextAstNode(toLength(0, 2)), null);
			Object.defineProperty(node, 'cachedMinIndentation', { value: 5 });
			if (fail !== 'none') { Object.defineProperty(node, fail, { writable: false }); }
			const receiver = new Proxy(node, {
				get: (target, key, receiver) => { observations.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); },
				set: (target, key, value, receiver) => { observations.push(`set:${String(key)}`); return Reflect.set(target, key, value, receiver); }
			});
			if (fail === 'none') { receiver.handleChildrenChanged(); } else { assert.throws(() => receiver.handleChildrenChanged(), TypeError); }
			return { observations, length: node.length, missing: node.missingOpeningBracketIds, cached: Object.getOwnPropertyDescriptor(node, 'cachedMinIndentation')!.value };
		};
		assert.deepStrictEqual(withRust(run), run(), `Metadata partial setter ${fail}`);
	}
	const run = () => {
		const child = ListAstNode.create23(new TextAstNode(toLength(0, 1)), new TextAstNode(toLength(0, 1)), null, true);
		const root = ListAstNode.create23(child, child, null);
		const observations: string[] = [];
		const receiver = new Proxy(root, { get: (target, key, receiver) => { observations.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); }, set: (target, key, value, receiver) => { observations.push(`set:${String(key)}`); return Reflect.set(target, key, value, receiver); } });
		receiver.makeFirstElementMutable();
		receiver.makeLastElementMutable();
		return { observations, node: snapshot(root) };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust bracket AST retains invalid heights, nested empty lists, immutable errors, and leaf callback values', () => {
	const run = () => {
		const text = new TextAstNode(toLength(0, 1));
		const empty = SmallImmutableSet.getEmpty<OpeningBracketId>();
		const nested = ListAstNode.create([ListAstNode.getEmpty()]);
		assert.throws(() => nested.canBeReused(empty));
		assert.throws(() => ListAstNode.create23(text, ListAstNode.create([text]), null), /Invalid list heights/);
		const immutable = ListAstNode.create23(text, text, null, true);
		for (const action of [() => immutable.makeFirstElementMutable(), () => immutable.makeLastElementMutable(), () => immutable.handleChildrenChanged()]) { assert.throws(action, /immutable/); }
		const list = ListAstNode.create([text]);
		Object.defineProperty(text, 'canBeReused', { value: () => undefined });
		const result = list.canBeReused(empty);
		return { result, emptyReuse: ListAstNode.getEmpty().canBeReused(empty) };
	};
	assert.deepStrictEqual(withRust(run), run());
	const failure = new Error('Original AST set provider failure');
	for (const native of [false, true]) {
		const run = () => {
			const node = new TextAstNode(toLength(0, 1));
			Object.defineProperty(node, 'missingOpeningBracketIds', { get: () => { throw failure; } });
			assert.throws(() => ListAstNode.create([node]), error => error === failure);
		};
		if (native) { withRust(run); } else { run(); }
	}
});

test('Rust bracket AST releases scoped results and rejects incompatible registration atomically', () => {
	let frees = 0;
	const failure = new Error('Original bracket AST result consumption failure');
	const module: IRustBracketAstModule = { ...rust, run_bracket_ast: () => ({ take: () => { throw failure; }, free: () => { frees++; } }) };
	withRust(() => assert.throws(() => ListAstNode.create([new TextAstNode(toLength(0, 1))]), error => error === failure), module);
	assert.strictEqual(frees, 1);
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_ast_abi_version: () => 0 }), /AST algorithm contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketAst(rust), /already registered/); } finally { registration.dispose(); }
});
