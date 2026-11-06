/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { ListAstNode, TextAstNode } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/ast.js';
import { toLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/length.js';
import { NodeReader } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/nodeReader.js';
import { IRustBracketNumberArrayModule, ownRustBracketNumberArray, registerRustBracketNumberArray } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketNumberArray.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustBracketNumberArrayModule = rust): T {
	const registration = registerRustBracketNumberArray(module);
	try { return compute(); } finally { registration.dispose(); }
}

function snapshot(array: readonly number[]): object {
	const keys = Reflect.ownKeys(array);
	return { values: Array.from(array), keys, descriptors: keys.map(key => { const descriptor = Object.getOwnPropertyDescriptor(array, key)!; return { ...descriptor, get: typeof descriptor.get, set: typeof descriptor.set }; }) };
}

test('Rust owning bracket arrays preserve seeded stack edits, holes, attributes, aliases, and partial failures', () => {
	let seed = 1481;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	for (let trace = 0; trace < 256; trace++) {
		const operations = Array.from({ length: 32 }, () => [random(9), random(12), random(12), random(32)]);
		const run = () => {
			const array = ownRustBracketNumberArray([0, -0, Number.NaN, Number.POSITIVE_INFINITY]);
			const alias = array;
			return operations.map(([operation, first, second, value]) => {
				let result: object | number | undefined;
				let failure: string | undefined;
				try {
					switch (operation) {
						case 0: result = array.push(value); break;
						case 1: result = array.pop(); break;
						case 2: result = array.unshift(value); break;
						case 3: result = array.shift(); break;
						case 4: result = array.splice(first, second % 3, value); break;
						case 5: array.copyWithin(first, second); break;
						case 6: array.reverse(); break;
						case 7: Object.defineProperty(array, String(first), { value, writable: !!(second % 2), configurable: true, enumerable: true }); break;
						default: Reflect.deleteProperty(array, String(first));
					}
				} catch (error) { failure = error instanceof Error ? error.name : 'non-error'; }
				return { result, failure, same: alias === array, state: snapshot(array), array: Array.isArray(array), prototype: Object.getPrototypeOf(array) === Array.prototype };
			});
		};
		assert.deepStrictEqual(withRust(run), run(), `Owning numeric array trace ${trace}`);
	}
});

test('Rust bracket arrays preserve length reduction, nonconfigurable barriers, receiver traps, and accessor fallback', () => {
	const run = () => {
		const observations: string[] = [];
		const array = ownRustBracketNumberArray([1, 2, 3, 4, 5]);
		const receiver = new Proxy(array, {
			get: (target, key, receiver) => { observations.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); },
			set: (target, key, value, receiver) => { observations.push(`set:${String(key)}`); return Reflect.set(target, key, value, receiver); },
			getOwnPropertyDescriptor: (target, key) => { observations.push(`descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
			defineProperty: (target, key, descriptor) => { observations.push(`define:${String(key)}`); return Reflect.defineProperty(target, key, descriptor); },
			deleteProperty: (target, key) => { observations.push(`delete:${String(key)}`); return Reflect.deleteProperty(target, key); }
		});
		Object.defineProperty(receiver, '2', { configurable: false, writable: false });
		assert.throws(() => Object.defineProperty(receiver, 'length', { value: 1 }), TypeError);
		Object.defineProperty(receiver, '1', { get: () => { observations.push('value:get'); return 7; }, configurable: true });
		const other = {};
		const assigned = Reflect.set(receiver, '0', 9, other);
		Object.defineProperty(receiver, 'length', { writable: false });
		assert.throws(() => receiver.push(8), TypeError);
		return { observations, other, assigned, state: snapshot(receiver), extensible: Object.isExtensible(receiver) };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust number arrays are used by live NodeReader stacks and retain held aliases after registration disposal', () => {
	const before = rust.bracket_number_array_live_count();
	const reader = withRust(() => new NodeReader(ListAstNode.create23(new TextAstNode(toLength(0, 2)), new TextAstNode(toLength(0, 3)), new TextAstNode(toLength(0, 5)))));
	const offsets = Object.getOwnPropertyDescriptor(reader, 'offsets')!.value as number[];
	const indices = Object.getOwnPropertyDescriptor(reader, 'idxs')!.value as number[];
	assert.strictEqual(rust.bracket_number_array_live_count(), before + 2);
	const matches = [1, 2, 4, 5, 9, 10].map(offset => reader.readLongestNodeAt(toLength(0, offset), () => true)?.length);
	assert.deepStrictEqual({ matches, offsets, indices, held: Object.getOwnPropertyDescriptor(reader, 'offsets')!.value === offsets }, { matches: [undefined, toLength(0, 3), undefined, toLength(0, 5), undefined, undefined], offsets: [], indices: [], held: true });
	Object.freeze(offsets);
	Object.freeze(indices);
	assert.strictEqual(rust.bracket_number_array_live_count(), before);
});

test('Rust array preflight failures retain source values and stale registrations roll back atomically', () => {
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_number_array_abi_version: () => 0 }), /owning stack contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	let frees = 0;
	const failure = new Error('Original native numeric array allocation failure');
	const source = [1, 2];
	const module: IRustBracketNumberArrayModule = {
		...rust, WasmBracketNumberArray: class extends rust.WasmBracketNumberArray {
			override prepare(): boolean { throw failure; }
			override free(): void { frees++; super.free(); }
		}
	};
	withRust(() => assert.throws(() => ownRustBracketNumberArray(source), error => error === failure), module);
	assert.deepStrictEqual({ source, frees }, { source: [1, 2], frees: 1 });
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketNumberArray(rust), /already registered/); } finally { registration.dispose(); }
});

test('Rust numeric array ownership releases unreachable and cyclic array facades', async () => {
	assert.ok(global.gc, 'The compatibility runner exposes garbage collection');
	withRust(() => {
		for (let index = 0; index < 256; index++) {
			const array = ownRustBracketNumberArray([1, 2]);
			Object.defineProperty(array, '1', { value: array });
		}
	});
	for (let attempt = 0; attempt < 100 && rust.bracket_number_array_live_count() > 0; attempt++) { global.gc(); await setTimeout(10); }
	assert.strictEqual(rust.bracket_number_array_live_count(), 0);
});
