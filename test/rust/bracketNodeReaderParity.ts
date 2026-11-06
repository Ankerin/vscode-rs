/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { AstNode, ListAstNode, TextAstNode } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/ast.js';
import { NodeReader } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/nodeReader.js';
import { Length, toLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/length.js';
import { IRustBracketNodeReaderModule, registerRustBracketNodeReader } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketNodeReader.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustBracketNodeReaderModule = rust): T {
	const registration = registerRustBracketNodeReader(module);
	try { return compute(); } finally { registration.dispose(); }
}

function readerState(reader: NodeReader, ids: ReadonlyMap<AstNode, number>): object {
	const nodes = Object.getOwnPropertyDescriptor(reader, 'nextNodes')!.value as AstNode[];
	return {
		nodes: nodes.map(node => ids.get(node)),
		offsets: Object.getOwnPropertyDescriptor(reader, 'offsets')!.value,
		indices: Object.getOwnPropertyDescriptor(reader, 'idxs')!.value,
		last: Object.getOwnPropertyDescriptor(reader, 'lastOffset')!.value
	};
}

test('Rust bracket node readers preserve seeded longest-node results, predicates, and live traversal stacks', () => {
	let seed = 397;
	let reads = 0;
	let advances = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const module: IRustBracketNodeReaderModule = {
		...rust,
		read_longest_bracket_node: (...args) => { reads++; return rust.read_longest_bracket_node(...args); },
		advance_bracket_node: host => { advances++; return rust.advance_bracket_node(host); }
	};
	for (let trace = 0; trace < 512; trace++) {
		const height = random(4);
		const lengths = Array.from({ length: 27 }, () => toLength(random(2), random(9)));
		const run = () => {
			let leaf = 0;
			const ids = new Map<AstNode, number>();
			const create = (height: number): AstNode => {
				const node = height === 0 ? new TextAstNode(lengths[leaf++]) : ListAstNode.create23(create(height - 1), create(height - 1), create(height - 1));
				ids.set(node, ids.size);
				return node;
			};
			const reader = new NodeReader(create(height));
			return Array.from({ length: 192 }, (_, index) => {
				const calls: number[] = [];
				const node = reader.readLongestNodeAt(toLength(index >> 4, index & 15), node => { const id = ids.get(node)!; calls.push(id); return (id + trace) % 3 === 0; });
				// Copy the arrays while the reader continues advancing so each snapshot retains its own state.
				return { result: node ? ids.get(node) : undefined, calls, state: structuredClone(readerState(reader, ids)) };
			});
		};
		assert.deepStrictEqual(withRust(run, module), run(), `Bracket reader trace ${trace}`);
	}
	assert.strictEqual(reads, 98304, 'Every longest-node query executes in the integrated Rust core');
	assert.ok(advances > 1000, 'Actual reader advancement uses its native traversal kernel');
});

test('Rust bracket node readers preserve receiver/node/array proxy traps and overridden advancement callbacks', () => {
	const run = () => {
		const observations: string[] = [];
		const left = new TextAstNode(toLength(0, 2));
		const right = new TextAstNode(toLength(0, 3));
		const root = ListAstNode.create23(left, right, null);
		const node = new Proxy(root, { get: (target, key, receiver) => { observations.push(`node:${String(key)}`); return Reflect.get(target, key, receiver); } });
		const target = new NodeReader(node);
		for (const name of ['nextNodes', 'offsets', 'idxs']) {
			const descriptor = Object.getOwnPropertyDescriptor(target, name)!;
			Object.defineProperty(target, name, {
				...descriptor, value: new Proxy(descriptor.value, {
					get: (target, key, receiver) => { observations.push(`${name}:${String(key)}`); return Reflect.get(target, key, receiver); },
					set: (target, key, value, receiver) => { observations.push(`${name}:set:${String(key)}`); return Reflect.set(target, key, value, receiver); }
				})
			});
		}
		const reader = new Proxy(target, {
			get: (target, key, receiver) => { observations.push(`reader:${String(key)}`); return Reflect.get(target, key, receiver); },
			set: (target, key, value, receiver) => { observations.push(`reader:set:${String(key)}`); return Reflect.set(target, key, value, receiver); }
		});
		const results = [0, 1, 2, 3, 5, 6].map(offset => reader.readLongestNodeAt(toLength(0, offset), candidate => candidate !== node)?.length);
		return { results, observations };
	};
	assert.deepStrictEqual(withRust(run), run());
	const overridden = () => {
		let calls = 0;
		const node = new TextAstNode(toLength(0, 2));
		const reader = new NodeReader(node);
		Object.defineProperty(reader, 'nextNodeAfterCurrent', { value: () => { calls++; } });
		return { results: [reader.readLongestNodeAt(toLength(0, 0), () => true) === node, reader.readLongestNodeAt(toLength(0, 0), () => true) === node], calls };
	};
	assert.deepStrictEqual(withRust(overridden), overridden());
});

test('Rust bracket node readers preserve reentrant predicate mutations, exception identity, and partial stack writes', () => {
	const run = (freeze: boolean) => {
		const left = new TextAstNode(toLength(0, 2));
		const right = new TextAstNode(toLength(0, 3));
		const root = ListAstNode.create23(left, right, null);
		const ids = new Map<AstNode, number>([[root, 0], [left, 1], [right, 2]]);
		const reader = new NodeReader(root);
		if (freeze) {
			Object.freeze(Object.getOwnPropertyDescriptor(reader, 'offsets')!.value);
			assert.throws(() => reader.readLongestNodeAt(toLength(0, 0), () => false), TypeError);
			return { result: undefined, state: readerState(reader, ids) };
		}
		let reentered = false;
		const result = reader.readLongestNodeAt(toLength(0, 0), () => {
			if (!reentered) { reentered = true; reader.readLongestNodeAt(toLength(0, 0), () => false); }
			return true;
		});
		return { result: result ? ids.get(result) : undefined, state: readerState(reader, ids) };
	};
	for (const freeze of [false, true]) { assert.deepStrictEqual(withRust(() => run(freeze)), run(freeze)); }
	const failure = new Error('Original bracket cache predicate failure');
	const failureRun = () => {
		const node = new TextAstNode(toLength(0, 2));
		const reader = new NodeReader(node);
		assert.throws(() => reader.readLongestNodeAt(toLength(0, 0), () => { throw failure; }), error => error === failure);
		return readerState(reader, new Map([[node, 0]]));
	};
	assert.deepStrictEqual(withRust(failureRun), failureRun());
});

test('Rust bracket node readers preserve monotonic errors, unusual offsets, and coercing child index state', () => {
	for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0, 0.5]) {
		const run = () => {
			const node = new TextAstNode(toLength(0, 2));
			const reader = new NodeReader(node);
			return { result: reader.readLongestNodeAt(value as unknown as Length, () => true)?.length, state: readerState(reader, new Map([[node, 0]])) };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
	for (const index of [0n, undefined, -2]) {
		const run = () => {
			const left = new TextAstNode(toLength(0, 2));
			const right = new TextAstNode(toLength(0, 3));
			const root = ListAstNode.create23(left, right, null);
			const reader = new NodeReader(root);
			reader.readLongestNodeAt(toLength(0, 0), () => false);
			const indices = Object.getOwnPropertyDescriptor(reader, 'idxs')!.value as number[];
			Reflect.set(indices, '0', index);
			let result: AstNode | undefined;
			let failure: string | undefined;
			try { result = reader.readLongestNodeAt(toLength(0, 2), () => true); }
			catch (error) { if (!(error instanceof Error)) { throw error; } failure = error.message; }
			return { result: result?.length, failure, state: readerState(reader, new Map<AstNode, number>([[root, 0], [left, 1], [right, 2]])) };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
	const reader = new NodeReader(new TextAstNode(toLength(0, 2)));
	withRust(() => { reader.readLongestNodeAt(toLength(0, 2), () => true); assert.throws(() => reader.readLongestNodeAt(toLength(0, 1), () => true), /Invalid offset/); });
});

test('Rust bracket node readers release scoped results and reject stale core registrations atomically', () => {
	const node = new TextAstNode(toLength(0, 2));
	let frees = 0;
	const module: IRustBracketNodeReaderModule = { ...rust, read_longest_bracket_node: () => ({ take: () => node, free: () => { frees++; } }) };
	assert.strictEqual(withRust(() => new NodeReader(node).readLongestNodeAt(toLength(0, 0), () => true), module), node);
	assert.strictEqual(frees, 1);
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_node_reader_abi_version: () => 0 }), /cache traversal contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketNodeReader(rust), /already registered/); } finally { registration.dispose(); }
});
