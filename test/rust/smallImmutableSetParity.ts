/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { DenseKeyProvider, identityKeyProvider, SmallImmutableSet } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/smallImmutableSet.js';
import { IRustSmallSetModule, registerRustSmallSet } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustSmallImmutableSet.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustSmallSetModule = rust): T {
	const registration = registerRustSmallSet(module);
	try { return compute(); } finally { registration.dispose(); }
}

test('Rust bracket identifier sets preserve seeded additions, merges, membership, exact equality, and cache identities', () => {
	let seed = 691;
	let additions = 0;
	let merges = 0;
	let queries = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const module: IRustSmallSetModule = {
		...rust,
		small_set_add: (...args) => { additions++; return rust.small_set_add(...args); },
		small_set_merge: (...args) => { merges++; return rust.small_set_merge(...args); },
		small_set_query: (...args) => { queries++; return rust.small_set_query(...args); }
	};
	for (let trace = 0; trace < 1024; trace++) {
		const operations = Array.from({ length: 64 }, () => [random(4), random(4), random(160)]);
		const run = () => {
			const sets = Array.from({ length: 4 }, () => SmallImmutableSet.getEmpty<number>());
			return operations.map(([first, second, key], index) => {
				const previous = sets[first];
				const other = sets[second];
				const next = index % 4 === 0 ? previous.merge(other) : previous.add(key, identityKeyProvider);
				sets[first] = next;
				return { set: next, same: next === previous, other: next === other, has: next.has(key, identityKeyProvider), equal: next.equals(other), intersects: next.intersects(other) };
			});
		};
		assert.deepStrictEqual(withRust(run, module), run(), `Bracket identifier trace ${trace}`);
	}
	assert.deepStrictEqual([additions, merges, queries], [49152, 16384, 196608], 'Every supported set operation uses the integrated native kernel');
});

test('Rust bracket identifier sets retain numeric key coercion, signed shifts, high-key copies, and provider read order', () => {
	for (const key of [-64, -1, -0, 0.5, 1, 31, 32, 63, 64, 129, 4096, 2 ** 32, 2 ** 32 + 31, Number.NaN, Number.POSITIVE_INFINITY]) {
		const run = () => {
			const initial = SmallImmutableSet.getEmpty<number>().add(31, identityKeyProvider).add(32, identityKeyProvider);
			const next = initial.add(key, identityKeyProvider);
			return { next, same: next === initial, has: next.has(key, identityKeyProvider), previous: initial.has(key, identityKeyProvider), equal: next.equals(initial) };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
	const run = () => {
		const reads: string[] = [];
		const key = { valueOf: () => { reads.push('coerce'); return 32; } };
		const provider = { getKey: (value: string) => { reads.push(`key:${value}`); return key as never; } };
		const set = SmallImmutableSet.getEmpty<string>().add('bracket', provider);
		return { set, present: set.has('bracket', provider), reads };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust bracket identifier sets retain dense provider reverse lookup and original provider failures', () => {
	const run = () => {
		const provider = new DenseKeyProvider<object>();
		const values = Array.from({ length: 96 }, (_, index) => ({ index }));
		let set = SmallImmutableSet.getEmpty<object>();
		for (const value of values) {
			provider.getKey(value);
			if (value.index % 3 === 0) { set = set.add(value, provider); }
		}
		return { keys: [...provider.keys()], reverse: values.map((_, index) => provider.reverseLookup(index)), selected: provider.reverseLookupSet(set) };
	};
	assert.deepStrictEqual(withRust(run), run());
	const failure = new Error('Original bracket key provider failure');
	const provider = { getKey: () => { throw failure; } };
	assert.throws(() => withRust(() => SmallImmutableSet.getEmpty().add('bracket', provider)), error => error === failure);
});

test('Rust bracket identifier sets retain proxy/accessor traps, mutable word aliases, sparse holes, and equality tails', () => {
	const run = () => {
		const observations: string[] = [];
		const original = SmallImmutableSet.getEmpty<number>().add(31, identityKeyProvider).add(64, identityKeyProvider);
		const proxy = new Proxy(original, {
			get: (target, key, receiver) => { observations.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); },
			getOwnPropertyDescriptor: (target, key) => { observations.push(`descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
			getPrototypeOf: target => { observations.push('prototype'); return Reflect.getPrototypeOf(target); }
		});
		const next = proxy.add(96, identityKeyProvider);
		const queries = [proxy.has(64, identityKeyProvider), proxy.intersects(next), proxy.equals(next)];
		const items = Object.getOwnPropertyDescriptor(original, 'additionalItems')!.value as number[];
		items[0] = Number.NaN;
		delete items[1];
		const changed = original.add(96, identityKeyProvider);
		return { observations, next, queries, changed, equal: original.equals(changed), merged: original.merge(changed) };
	};
	assert.deepStrictEqual(withRust(run), run());
	const accessorRun = () => {
		const set = SmallImmutableSet.getEmpty<number>().add(31, identityKeyProvider).add(64, identityKeyProvider);
		const source = Object.getOwnPropertyDescriptor(set, 'additionalItems')!.value as number[];
		const observations: string[] = [];
		Object.defineProperty(source, '1', { configurable: true, get: () => { observations.push('word'); return 1; } });
		return { present: set.has(64, identityKeyProvider), changed: set.add(96, identityKeyProvider), observations };
	};
	assert.deepStrictEqual(withRust(accessorRun), accessorRun());
});

test('Rust bracket identifier bindings retain short-circuit reads and reject malformed results atomically', () => {
	const set = SmallImmutableSet.getEmpty<number>().add(0, identityKeyProvider);
	let reads = 0;
	const query = rust.small_set_query(1, 1, 1, 0, 262144, 262144, () => { reads++; return 0; });
	assert.deepStrictEqual([query, reads], [true, 0], 'A low-word intersection never reads additional words');
	assert.throws(() => withRust(() => set.add(1, identityKeyProvider), { ...rust, small_set_add: () => new Float64Array(2) }), /small set add result/);
	assert.throws(() => withRust(() => set.merge(set), { ...rust, small_set_merge: () => new Float64Array(0) }), /small set merge result/);
	assert.throws(() => registerRustTextBuffer({ ...rust, small_set_abi_version: () => 0 }), /bracket identifier contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustSmallSet(rust), /already registered/); } finally { registration.dispose(); }
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
});
