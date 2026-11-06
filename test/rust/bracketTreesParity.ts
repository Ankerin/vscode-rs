/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { AstNode, AstNodeKind, ListAstNode, TextAstNode } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/ast.js';
import { concat23Trees, concat23TreesOfSameHeight } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/concat23Trees.js';
import { toLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/length.js';
import { IRustBracketTreesModule, registerRustBracketTrees } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketTrees.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

interface INodeSnapshot {
	readonly kind: AstNodeKind;
	readonly height: number;
	readonly length: object;
	readonly type: string;
	readonly children: (INodeSnapshot | null)[];
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustBracketTreesModule = rust): T {
	const registration = registerRustBracketTrees(module);
	try { return compute(); } finally { registration.dispose(); }
}

function snapshot(node: AstNode | null): INodeSnapshot | null {
	if (!node) { return null; }
	return { kind: node.kind, height: node.listHeight, length: node.length, type: node.constructor.name, children: Array.from({ length: node.childrenLength }, (_, index) => snapshot(node.getChild(index))) };
}

test('Rust equal-height bracket trees preserve seeded in-place grouping, odd tails, immutable classes, and leaf identities', () => {
	let seed = 587;
	let calls = 0;
	let expectedCalls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const module: IRustBracketTreesModule = { ...rust, concat_bracket_trees_same_height: (...args) => { calls++; return rust.concat_bracket_trees_same_height(...args); } };
	for (let trace = 0; trace < 512; trace++) {
		const count = random(200);
		const height = random(3);
		for (const immutable of [false, true]) {
			if (count >= 2) { expectedCalls++; }
			const run = () => {
				const leaves: AstNode[] = [];
				const create = (height: number): AstNode => {
					if (height === 0) { const node = new TextAstNode(toLength(0, 1)); leaves.push(node); return node; }
					return ListAstNode.create23(create(height - 1), create(height - 1), null, immutable);
				};
				const items = Array.from({ length: count }, () => create(height));
				const original = items.slice();
				const node = concat23TreesOfSameHeight(items, immutable);
				const returnedLeaves: AstNode[] = [];
				const visit = (node: AstNode | null) => {
					if (!node) { return; }
					if (node.childrenLength === 0) { returnedLeaves.push(node); }
					for (let index = 0; index < node.childrenLength; index++) { visit(node.getChild(index)); }
				};
				visit(node);
				return { node: snapshot(node), items: items.map(snapshot), leaves: returnedLeaves.map((node, index) => node === leaves[index]), shortcut: count === 1 ? node === original[0] : node === null };
			};
			assert.deepStrictEqual(withRust(run, module), run(), `Bracket tree trace ${trace}/${immutable}`);
		}
	}
	assert.strictEqual(calls, expectedCalls, 'Every supported multi-node construction uses the integrated Rust grouping');
});

test('Rust equal-height bracket trees retain array proxy reads/writes and factory getter order', () => {
	const factory = Object.getOwnPropertyDescriptor(ListAstNode, 'create23')!;
	const run = () => {
		const observations: string[] = [];
		const items = Array.from({ length: 9 }, () => new TextAstNode(toLength(0, 1)));
		const proxy = new Proxy(items, {
			get: (target, key, receiver) => { observations.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); },
			set: (target, key, value, receiver) => { observations.push(`set:${String(key)}`); return Reflect.set(target, key, value, receiver); },
			getOwnPropertyDescriptor: (target, key) => { observations.push(`descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); }
		});
		Object.defineProperty(ListAstNode, 'create23', { configurable: true, get: () => { observations.push('factory'); return factory.value; } });
		try { return { node: snapshot(concat23TreesOfSameHeight(proxy)), items: items.map(snapshot), observations }; }
		finally { Object.defineProperty(ListAstNode, 'create23', factory); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust equal-height bracket trees retain original partial writes and factory exceptions without fallback replay', () => {
	const factory = Object.getOwnPropertyDescriptor(ListAstNode, 'create23')!;
	const failure = new Error('Original bracket node factory failure');
	const run = (throwFactory: boolean) => {
		const items = Array.from({ length: 8 }, () => new TextAstNode(toLength(0, 1)));
		let calls = 0;
		if (!throwFactory) { Object.defineProperty(items, '1', { writable: false }); }
		Object.defineProperty(ListAstNode, 'create23', {
			...factory, value: (...args: Parameters<typeof ListAstNode.create23>) => {
				calls++;
				if (throwFactory && calls === 2) { throw failure; }
				return Reflect.apply(factory.value, ListAstNode, args);
			}
		});
		try { assert.throws(() => concat23TreesOfSameHeight(items), error => throwFactory ? error === failure : error instanceof TypeError); }
		finally { Object.defineProperty(ListAstNode, 'create23', factory); }
		return { calls, items: items.map(snapshot) };
	};
	for (const throwFactory of [false, true]) { assert.deepStrictEqual(withRust(() => run(throwFactory)), run(throwFactory)); }
});

test('Rust equal-height bracket trees retain unsupported cached lengths and undefined factory return identity', () => {
	for (const numeric of [2.5, 4.5, Number.NaN]) {
		const run = () => {
			let reads = 0;
			const items = Array.from({ length: 5 }, () => new TextAstNode(toLength(0, 1)));
			const proxy = new Proxy(items, {
				get: (target, key, receiver) => {
					if (key === 'length') { reads++; return numeric; }
					return Reflect.get(target, key, receiver);
				}
			});
			return { node: snapshot(concat23TreesOfSameHeight(proxy)), reads, items: items.map(snapshot) };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
	const factory = Object.getOwnPropertyDescriptor(ListAstNode, 'create23')!;
	let calls = 0;
	Object.defineProperty(ListAstNode, 'create23', { ...factory, value: () => { calls++; return undefined; } });
	try {
		assert.strictEqual(withRust(() => concat23TreesOfSameHeight([new TextAstNode(toLength(0, 1)), new TextAstNode(toLength(0, 1))])), undefined);
		assert.strictEqual(calls, 1, 'An undefined original factory result never replays the construction');
	} finally { Object.defineProperty(ListAstNode, 'create23', factory); }
});

test('Rust bracket tree results release their scoped native handle and roll back stale core registrations', () => {
	let frees = 0;
	const node = new TextAstNode(toLength(0, 1));
	const module: IRustBracketTreesModule = { ...rust, concat_bracket_trees_same_height: () => ({ take: () => node, free: () => { frees++; } }) };
	assert.strictEqual(withRust(() => concat23TreesOfSameHeight([node, node]), module), node);
	assert.strictEqual(frees, 1);
	const failure = new Error('Original bracket tree result failure');
	assert.throws(() => withRust(() => concat23TreesOfSameHeight([node, node]), { ...module, concat_bracket_trees_same_height: () => ({ take: () => { throw failure; }, free: () => { frees++; } }) }), error => error === failure);
	assert.strictEqual(frees, 2);
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_trees_abi_version: () => 0 }), /tree construction contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketTrees(rust), /already registered/); } finally { registration.dispose(); }
});

test('Rust mixed-height bracket trees preserve grouping, append/prepend splits, mutable roots, and leaf order', () => {
	let seed = 179;
	let calls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const module: IRustBracketTreesModule = { ...rust, concat_bracket_trees: host => { calls++; return rust.concat_bracket_trees(host); } };
	for (let trace = 0; trace < 1024; trace++) {
		const heights = Array.from({ length: 2 + random(24) }, () => random(4));
		const immutable = trace % 2 === 0;
		const run = () => {
			const leaves: AstNode[] = [];
			const create = (height: number): AstNode => {
				if (height === 0) { const node = new TextAstNode(toLength(0, 1)); leaves.push(node); return node; }
				return ListAstNode.create23(create(height - 1), create(height - 1), create(height - 1), immutable);
			};
			const items = heights.map(create);
			const node = concat23Trees(items);
			const visited: AstNode[] = [];
			const visit = (node: AstNode | null) => {
				if (!node) { return; }
				if (node.childrenLength === 0) { visited.push(node); }
				for (let index = 0; index < node.childrenLength; index++) { visit(node.getChild(index)); }
			};
			visit(node);
			return { node: snapshot(node), items: items.map(snapshot), leaves: visited.map((node, index) => node === leaves[index]) };
		};
		assert.deepStrictEqual(withRust(run, module), run(), `Mixed bracket tree trace ${trace}`);
	}
	assert.strictEqual(calls, 1024, 'Every mixed-height concatenation executes in the integrated Rust core');
});

test('Rust mixed-height bracket trees preserve proxy, virtual method, factory, and live parent-stack observations', () => {
	const run = () => {
		const observations: string[] = [];
		const create = (height: number): AstNode => height === 0 ? new TextAstNode(toLength(0, 1)) : ListAstNode.create23(create(height - 1), create(height - 1), create(height - 1));
		const roots = [create(2), create(0), create(1), create(0), create(2)];
		const items = roots.map((root, index) => new Proxy(root, { get: (target, key, receiver) => { observations.push(`${index}:${String(key)}`); return Reflect.get(target, key, receiver); } }));
		const array = new Proxy(items, { get: (target, key, receiver) => { observations.push(`array:${String(key)}`); return Reflect.get(target, key, receiver); } });
		const factory = Object.getOwnPropertyDescriptor(ListAstNode, 'create23')!;
		const push = Object.getOwnPropertyDescriptor(Array.prototype, 'push')!;
		Object.defineProperty(ListAstNode, 'create23', { configurable: true, get: () => { observations.push('factory'); return factory.value; } });
		Object.defineProperty(Array.prototype, 'push', {
			...push, value: function (this: object[], ...nodes: object[]) {
				// Record only AST parent stacks; ordinary observation arrays do not recurse through this branch.
				if (nodes.length === 1 && nodes[0] instanceof ListAstNode) { Reflect.apply(push.value, observations, ['parent']); }
				return Reflect.apply(push.value, this, nodes);
			}
		});
		let node: AstNode | null;
		try { node = concat23Trees(array); }
		finally { Object.defineProperty(Array.prototype, 'push', push); Object.defineProperty(ListAstNode, 'create23', factory); }
		const recorded = observations.slice();
		return { node: snapshot(node), items: roots.map(snapshot), observations: recorded };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust mixed-height bracket trees retain virtual failure identity and partial mutations', () => {
	const failure = new Error('Original bracket balancing method failure');
	for (const tallFirst of [false, true]) {
		const run = () => {
			const leaf = () => new TextAstNode(toLength(0, 1));
			const branch = () => ListAstNode.create23(leaf(), leaf(), leaf());
			const root = ListAstNode.create23(branch(), branch(), branch());
			Object.defineProperty(root, tallFirst ? 'makeLastElementMutable' : 'makeFirstElementMutable', { value: () => { throw failure; } });
			const items = tallFirst ? [root, leaf()] : [leaf(), root];
			assert.throws(() => concat23Trees(items), error => error === failure);
			return { items: items.map(snapshot), root: snapshot(root) };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
});
