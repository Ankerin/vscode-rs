/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { BeforeEditPositionMapper, TextEditInfo } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/beforeEditPositionMapper.js';
import { Length, toLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/length.js';
import { IRustBracketPositionMapperModule, registerRustBracketPositionMapper } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketPositionMapper.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustBracketPositionMapperModule = rust): T {
	const registration = registerRustBracketPositionMapper(module);
	try { return compute(); } finally { registration.dispose(); }
}

function state(mapper: BeforeEditPositionMapper): object {
	return Object.fromEntries(['nextEditIdx', 'deltaOldToNewLineCount', 'deltaOldToNewColumnCount', 'deltaLineIdxInOld'].map(name => [name, Object.getOwnPropertyDescriptor(mapper, name)!.value]));
}

test('Rust bracket position mapping preserves seeded multiline queries and live edit cursor transitions', () => {
	let seed = 499;
	let adjustments = 0;
	let translations = 0;
	let distances = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const module: IRustBracketPositionMapperModule = {
		...rust,
		adjust_bracket_position_mapper: (...args) => { adjustments++; return rust.adjust_bracket_position_mapper(...args); },
		translate_bracket_current_offset: (...args) => { translations++; return rust.translate_bracket_current_offset(...args); },
		distance_to_bracket_change: (...args) => { distances++; return rust.distance_to_bracket_change(...args); }
	};
	for (let trace = 0; trace < 512; trace++) {
		let endLine = 0;
		let endColumn = 0;
		const edits = Array.from({ length: random(16) }, () => {
			const startColumn = endColumn + random(5);
			const start = toLength(endLine, startColumn);
			endLine += random(2);
			endColumn = startColumn + random(7);
			const end = toLength(endLine, endColumn);
			return new TextEditInfo(start, end, toLength(random(3), random(8)));
		});
		const run = () => {
			const mapper = new BeforeEditPositionMapper(edits);
			return Array.from({ length: 128 }, (_, index) => {
				const offset = toLength(index >> 3, index & 7);
				const before = mapper.getOffsetBeforeChange(offset);
				const distance = mapper.getDistanceToNextChange(offset);
				return { before, distance, state: state(mapper) };
			});
		};
		assert.deepStrictEqual(withRust(run, module), run(), `Bracket position trace ${trace}`);
	}
	assert.deepStrictEqual({ adjustments, translations, distances }, { adjustments: 131072, translations: 65536, distances: 65536 });
});

test('Rust bracket position mapping preserves receiver/cache/coordinate proxies and virtual method read order', () => {
	const run = () => {
		const observations: string[] = [];
		const observe = <T extends object>(target: T, name: string): T => new Proxy(target, {
			get: (target, key, receiver) => { observations.push(`${name}:${String(key)}`); return Reflect.get(target, key, receiver); },
			set: (target, key, value, receiver) => { observations.push(`${name}:set:${String(key)}`); return Reflect.set(target, key, value, receiver); }
		});
		const target = new BeforeEditPositionMapper([
			new TextEditInfo(toLength(0, 2), toLength(0, 4), toLength(1, 1)),
			new TextEditInfo(toLength(0, 6), toLength(0, 7), toLength(0, 3))
		]);
		const descriptor = Object.getOwnPropertyDescriptor(target, 'edits')!;
		const caches = descriptor.value as object[];
		for (let index = 0; index < caches.length; index++) {
			for (const name of ['offsetObj', 'endOffsetBeforeObj', 'endOffsetAfterObj']) {
				const coordinate = Object.getOwnPropertyDescriptor(caches[index], name)!;
				Object.defineProperty(caches[index], name, { ...coordinate, value: observe(coordinate.value, `${index}:${name}`) });
			}
			caches[index] = observe(caches[index], `edit:${index}`);
		}
		Object.defineProperty(target, 'edits', { ...descriptor, value: observe(caches, 'edits') });
		const translate = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'translateOldToCur')!.value as (coordinate: object) => Length;
		Object.defineProperty(target, 'translateOldToCur', { get: () => { observations.push('translate:get'); return (coordinate: object) => Reflect.apply(translate, target, [coordinate]); } });
		const mapper = observe(target, 'mapper');
		const results = [toLength(0, 0), toLength(0, 3), toLength(1, 1), toLength(1, 3), toLength(1, 6), toLength(2, 0)].map(offset => [mapper.getDistanceToNextChange(offset), mapper.getOffsetBeforeChange(offset)]);
		return { results, observations, state: state(target) };
	};
	assert.deepStrictEqual(withRust(run), run());
	const overridden = () => {
		let calls = 0;
		const mapper = new BeforeEditPositionMapper([new TextEditInfo(toLength(0, 2), toLength(0, 4), toLength(0, 1))]);
		Object.defineProperty(mapper, 'adjustNextEdit', { value: () => { calls++; } });
		return { results: [mapper.getOffsetBeforeChange(toLength(0, 8)), mapper.getDistanceToNextChange(toLength(0, 8))], calls, state: state(mapper) };
	};
	assert.deepStrictEqual(withRust(overridden), overridden());
});

test('Rust bracket position mapping preserves unusual numbers and coercing mutable state without early reads', () => {
	for (const offset of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, -1, 0.5]) {
		const run = () => {
			const mapper = new BeforeEditPositionMapper([new TextEditInfo(toLength(0, 2), toLength(0, 4), toLength(0, 1))]);
			return { before: mapper.getOffsetBeforeChange(offset as unknown as Length), distance: mapper.getDistanceToNextChange(offset as unknown as Length), state: state(mapper) };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
	for (const field of ['nextEditIdx', 'deltaOldToNewLineCount', 'deltaOldToNewColumnCount', 'deltaLineIdxInOld']) {
		for (const value of ['', '0', undefined, -0, 0.5, Number.NaN, 0n]) {
			const run = () => {
				const mapper = new BeforeEditPositionMapper([new TextEditInfo(toLength(0, 2), toLength(0, 4), toLength(0, 1))]);
				Object.defineProperty(mapper, field, { value });
				let result: object | undefined;
				let failure: string | undefined;
				try { result = { before: mapper.getOffsetBeforeChange(toLength(0, 3)), distance: mapper.getDistanceToNextChange(toLength(0, 3)) }; }
				catch (error) { if (!(error instanceof Error)) { throw error; } failure = error.message; }
				return { result, failure, state: state(mapper) };
			};
			assert.deepStrictEqual(withRust(run), run(), `${field} with ${String(value)}`);
		}
	}
	const coercing = () => {
		const calls: string[] = [];
		const mapper = new BeforeEditPositionMapper([]);
		Object.defineProperty(mapper, 'deltaOldToNewLineCount', { value: { [Symbol.toPrimitive]: (hint: string) => { calls.push(hint); return 1; } } });
		return { before: mapper.getOffsetBeforeChange(toLength(2, 3)), calls };
	};
	assert.deepStrictEqual(withRust(coercing), coercing());
});

test('Rust bracket position mapping preserves original failures and partially committed cursor and delta fields', () => {
	for (const field of ['nextEditIdx', 'deltaOldToNewLineCount', 'deltaOldToNewColumnCount', 'deltaLineIdxInOld']) {
		const run = () => {
			const mapper = new BeforeEditPositionMapper([new TextEditInfo(toLength(0, 2), toLength(0, 4), toLength(1, 1))]);
			Object.defineProperty(mapper, field, { writable: false });
			assert.throws(() => mapper.getOffsetBeforeChange(toLength(1, 2)), TypeError);
			return state(mapper);
		};
		assert.deepStrictEqual(withRust(run), run());
	}
	const failure = new Error('Original edit cache coordinate failure');
	for (const failAt of [1, 2, 3]) {
		const run = () => {
			let reads = 0;
			const mapper = new BeforeEditPositionMapper([new TextEditInfo(toLength(0, 2), toLength(0, 4), toLength(1, 1))]);
			const caches = Object.getOwnPropertyDescriptor(mapper, 'edits')!.value as object[];
			const descriptor = Object.getOwnPropertyDescriptor(caches[0], 'endOffsetBeforeObj')!;
			Object.defineProperty(caches[0], 'endOffsetBeforeObj', { get: () => { if (++reads === failAt) { throw failure; } return descriptor.value; } });
			assert.throws(() => mapper.getOffsetBeforeChange(toLength(1, 2)), error => error === failure);
			return { reads, state: state(mapper) };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust bracket position mapping releases result references and rolls back stale core registration', () => {
	let frees = 0;
	const failure = new Error('Original position result consumption failure');
	const module: IRustBracketPositionMapperModule = { ...rust, translate_bracket_current_offset: () => ({ take: () => { throw failure; }, free: () => { frees++; } }) };
	withRust(() => assert.throws(() => new BeforeEditPositionMapper([]).getOffsetBeforeChange(toLength(0, 0)), error => error === failure), module);
	assert.strictEqual(frees, 1);
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_position_mapper_abi_version: () => 0 }), /edit cursor contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketPositionMapper(rust), /already registered/); } finally { registration.dispose(); }
});

