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
import { Length, lengthAdd, lengthCompare, lengthDiff, lengthDiffNonNegative, lengthEquals, lengthGetColumnCountIfZeroLineCount, lengthGetLineCount, lengthGreaterThanEqual, lengthHash, lengthIsZero, lengthLessThan, lengthLessThanEqual, lengthMax, lengthOfRange, lengthOfString, lengthOfStringObj, lengthsToRange, lengthToObj, lengthToPosition, positionToLength, sumLengths, toLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/length.js';
import { IRustBracketLengthsModule, registerRustBracketLengths, RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { tryCountRustEOL } from '../../src/vs/editor/common/core/rustTextShape.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustBracketLengthsModule = rust): T {
	const registration = registerRustBracketLengths(module);
	try { return compute(); } finally { registration.dispose(); }
}

function numericSnapshot(first: number, second: number, third: number, fourth: number): object {
	const a = first as unknown as Length;
	const b = second as unknown as Length;
	return {
		pack: toLength(first, second), difference: lengthDiff(first, second, third, fourth), add: lengthAdd(a, b), nonNegative: lengthDiffNonNegative(a, b),
		compare: lengthCompare(a, b), less: lengthLessThan(a, b), lessEqual: lengthLessThanEqual(a, b), greaterEqual: lengthGreaterThanEqual(a, b), equal: lengthEquals(a, b), zero: lengthIsZero(a), max: lengthMax(a, b),
		object: lengthToObj(a), line: lengthGetLineCount(a), column: lengthGetColumnCountIfZeroLineCount(a), hash: lengthHash(a), position: lengthToPosition(a), range: lengthsToRange(a, b)
	};
}

test('Rust packed lengths preserve arithmetic, coordinates, exceptional values, fractions, and signed zero', () => {
	let seed = 431;
	let calls = 0;
	let parts = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const values = [-Number.MAX_VALUE, -(2 ** 52), -67108865, -1, -0.5, -0, 0, 0.5, 1, 67108863, 67108864, 67108865, 2 ** 52, Number.MAX_VALUE, Number.MIN_VALUE, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
	const module: IRustBracketLengthsModule = {
		...rust,
		bracket_length: (...args) => { calls++; return rust.bracket_length(...args); },
		bracket_length_parts: length => { parts++; return rust.bracket_length_parts(length); }
	};
	for (let trace = 0; trace < 4096; trace++) {
		const [first, second, third, fourth] = Array.from({ length: 4 }, () => values[random(values.length)]);
		assert.deepStrictEqual(withRust(() => numericSnapshot(first, second, third, fourth), module), numericSnapshot(first, second, third, fourth), `Packed length trace ${trace}`);
	}
	assert.deepStrictEqual([calls, parts], [12 * 4096, 4 * 4096], 'Every applicable numeric operation and object coordinate conversion dispatches natively');
});

test('Rust packed lengths preserve original coercion, provider getter order, and callback reductions', () => {
	const run = () => {
		const reads: string[] = [];
		const firstValue = { valueOf: () => { reads.push('first'); return 67108866; } };
		const secondValue = { valueOf: () => { reads.push('second'); return 3; } };
		const first = firstValue as never;
		const second = secondValue as never;
		const values = [toLength(first, second), lengthAdd(first, second), lengthDiffNonNegative(first, second), lengthToObj(first), lengthsToRange(first, second), lengthCompare(first, second), lengthMax(first, second) === first];
		const position = { get lineNumber() { reads.push('line'); return 2; }, get column() { reads.push('column'); return 3; } };
		const range = {
			get startLineNumber() { reads.push('startLine'); return 2; }, get endLineNumber() { reads.push('endLine'); return 3; },
			get startColumn() { reads.push('startColumn'); return 4; }, get endColumn() { reads.push('endColumn'); return 5; }
		};
		values.push(positionToLength(position as never), lengthOfRange(range as never));
		values.push(sumLengths([1, 2, 3], value => { reads.push(`sum:${value}`); return value as never; }));
		return { values, reads };
	};
	assert.deepStrictEqual(withRust(run), run());
	for (const value of [undefined, null, '3', Object(4)]) {
		const run = () => [toLength(1, value as never), lengthDiff(1, 2, value as never, value as never)];
		assert.deepStrictEqual(withRust(run), run());
	}
	const failure = new Error('Original packed length floor failure');
	const floor = Object.getOwnPropertyDescriptor(Math, 'floor')!;
	Object.defineProperty(Math, 'floor', { configurable: true, get: () => { throw failure; } });
	try { assert.throws(() => withRust(() => lengthToObj(3 as never)), error => error === failure); }
	finally { Object.defineProperty(Math, 'floor', floor); }
});

test('Rust packed text lengths retain CR/LF/CRLF, Unicode, empty suffixes, and original split callbacks', () => {
	let seed = 967;
	let calls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const alphabet = ['a', '\r', '\n', '\r\n', '\uD800', '\uDC00', '\uD83D\uDE00', '\u2028', '\u2029'];
	const module = { ...rust, text_eol_count: (units: Uint16Array) => { calls++; return rust.text_eol_count(units); } };
	for (let trace = 0; trace < 2048; trace++) {
		const text = Array.from({ length: random(80) }, () => alphabet[random(alphabet.length)]).join('');
		const run = () => [lengthOfString(text), lengthOfStringObj(text)];
		const expected = run();
		const registration = registerRustTextBuffer(module);
		try { assert.deepStrictEqual(run(), expected); } finally { registration.dispose(); }
	}
	assert.strictEqual(calls, 4096, 'Packed text lengths reuse the integrated native EOL scanner');
	const failure = new Error('Original packed text split failure');
	for (const [target, name] of [[String.prototype, 'split'], [RegExp.prototype, Symbol.split], [RegExp.prototype, 'flags']] as const) {
		const original = Object.getOwnPropertyDescriptor(target, name)!;
		Object.defineProperty(target, name, { configurable: true, get: () => { throw failure; } });
		const registration = registerRustTextBuffer(rust);
		try { assert.throws(() => lengthOfString('a\r\nb'), error => error === failure); }
		finally { registration.dispose(); Object.defineProperty(target, name, original); }
	}
});

test('Rust packed lengths remain integrated beneath position mapping across seeded multiline edits and queries', () => {
	let seed = 113;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	for (let trace = 0; trace < 1024; trace++) {
		let offset = 0;
		const edits = Array.from({ length: 1 + random(16) }, () => {
			const start = offset + random(8);
			const end = start + random(8);
			offset = end;
			return new TextEditInfo(start as never, end as never, (random(3) * 67108864 + random(8)) as never);
		});
		const queries = Array.from({ length: 64 }, (_, index) => toLength(Math.floor(index / 8), index % 8));
		const run = () => {
			const mapper = new BeforeEditPositionMapper(edits);
			return queries.map(offset => [mapper.getOffsetBeforeChange(offset), mapper.getDistanceToNextChange(offset)]);
		};
		assert.deepStrictEqual(withRust(run), run(), `Packed mapper trace ${trace}`);
	}
});

test('Rust packed length registration rejects malformed bindings and rolls back the complete core lifetime', () => {
	assert.throws(() => withRust(() => toLength(1, 2), { ...rust, bracket_length: () => undefined }), /bracket length result/);
	assert.throws(() => withRust(() => lengthToObj(3 as never), { ...rust, bracket_length_parts: () => new Float64Array(1) }), /bracket length parts/);
	assert.strictEqual(rust.bracket_length(99, 1, 2, 3, 4), undefined);
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_lengths_abi_version: () => 0 }), /packed coordinate contract/);
	assert.strictEqual(tryCountRustEOL('a\nb'), undefined);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketLengths(rust), /already registered/); } finally { registration.dispose(); }
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
});
