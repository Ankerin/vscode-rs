/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { OffsetRange } from '../../src/vs/editor/common/core/ranges/offsetRange.js';
import { LanguageIdCodec } from '../../src/vs/editor/common/services/languagesRegistry.js';
import { LineTokens, TokenArray, TokenArrayBuilder, TokenInfo } from '../../src/vs/editor/common/tokens/lineTokens.js';
import { IRustTokensModule, registerRustTokens, tryCreateRustLineTokens, tryReadRustTokenArray, trySliceRustTokenSequence } from '../../src/vs/editor/common/tokens/rustTokens.js';
import { TokenWithTextArray, TokenWithTextArrayBuilder, TokenWithTextInfo } from '../../src/vs/editor/common/tokens/tokenWithTextArray.js';

interface IRustModule extends IRustTokensModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });
const codec = new LanguageIdCodec();

function withRust<T>(compute: () => T, module: IRustTokensModule = rust): T {
	const registration = registerRustTokens(module);
	try { return compute(); } finally { registration.dispose(); }
}

function lineState(tokens: LineTokens) {
	return { text: tokens.getLineContent(), words: Array.from(tokens.getEncodedTokens()), count: tokens.getCount() };
}

function capture<T>(compute: () => T) {
	try { return { value: compute() }; } catch (error) {
		if (!(error instanceof Error)) { throw error; }
		return { error: { name: error.name, message: error.message } };
	}
}

test('Rust token sequence construction and slices preserve seeded Unicode, fractional lengths, zero tokens, and aliases', () => {
	let seed = 6571;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	for (let trace = 0; trace < 1024; trace++) {
		const data = Array.from({ length: random(64) }, () => ({
			text: ['', 'ab', '\uD800', '\uDC00', '\uD83D\uDE00', '\uFEFF\n'][random(6)],
			metadata: [Number.NaN, Number.POSITIVE_INFINITY, -1, 2 ** 40 + 31, random(2 ** 32), -random(2 ** 32) - 0.5][random(6)]
		}));
		const expected = LineTokens.createFromTextAndMetadata(data, codec);
		const actual = withRust(() => LineTokens.createFromTextAndMetadata(data, codec));
		assert.deepStrictEqual(lineState(actual), lineState(expected));
		const expectedLengths = TokenArray.fromLineTokens(expected);
		const actualLengths = withRust(() => TokenArray.fromLineTokens(actual));
		const expectedText = TokenWithTextArray.fromLineTokens(expected);
		const actualText = withRust(() => TokenWithTextArray.fromLineTokens(actual));
		const lengthState = (array: TokenArray) => array.map((range, token) => ({ start: range.start, end: range.endExclusive, length: token.length, metadata: token.metadata }));
		const textState = (array: TokenWithTextArray) => array.map((range, token) => ({ start: range.start, end: range.endExclusive, text: token.text, metadata: token.metadata }));
		for (let index = 0; index < 8; index++) {
			const first = random(128) / 2 - 16;
			const last = random(128) / 2 - 16;
			const range = new OffsetRange(Math.min(first, last), Math.max(first, last));
			assert.deepStrictEqual(withRust(() => lengthState(actualLengths.slice(range))), lengthState(expectedLengths.slice(range)));
			assert.deepStrictEqual(withRust(() => textState(actualText.slice(range))), textState(expectedText.slice(range)));
			assert.deepStrictEqual(withRust(() => lineState(actualLengths.slice(range).toLineTokens(actual.getLineContent(), codec))), lineState(expectedLengths.slice(range).toLineTokens(expected.getLineContent(), codec)));
			assert.deepStrictEqual(withRust(() => lineState(actualText.slice(range).toLineTokens(codec))), lineState(expectedText.slice(range).toLineTokens(codec)));
		}
		const info = data.map((token, index) => new TokenInfo(index % 5 / 2, token.metadata));
		const sequence = TokenArray.create(info);
		const range = new OffsetRange(1.5, 8.75);
		const before = sequence.slice(range);
		const nativeBefore = withRust(() => sequence.slice(range));
		info.splice(0, 2, new TokenInfo(3, 42));
		assert.deepStrictEqual(withRust(() => lengthState(sequence.slice(range))), lengthState(sequence.slice(range)));
		assert.deepStrictEqual(lengthState(nativeBefore), lengthState(before), 'Slices retain independent TokenInfo objects');
		assert.strictEqual(sequence.append(sequence).map((_range, token) => token)[0], info[0]);
	}
});

test('Rust token sequence slicing retains floating-point exceptional values, negative lengths, and substring swapping', () => {
	const numeric = [0, -0, 0.5, -2, 4, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
	for (const first of numeric) {
		for (const second of numeric) {
			const items = [new TokenInfo(first, 7), new TokenInfo(second, 9), new TokenInfo(3, 11)];
			const array = TokenArray.create(items);
			for (const start of numeric) {
				const end = Number.isNaN(start) ? 8 : Math.max(start, 8);
				const range = new OffsetRange(start, end);
				const read = () => array.slice(range).map((range, token) => ({ range, token }));
				assert.deepStrictEqual(withRust(() => capture(read)), capture(read));
			}
		}
	}
	const words = new Uint32Array([5, 1, 2, 3, 0, 5, 8, 7]);
	const line = new LineTokens(words, 'a\uD800x\uDC00\uD83D\uDE00yz', codec);
	assert.deepStrictEqual(withRust(() => TokenArray.fromLineTokens(line).slice(new OffsetRange(0, 6))), TokenArray.fromLineTokens(line).slice(new OffsetRange(0, 6)));
	assert.deepStrictEqual(withRust(() => lineState(TokenWithTextArray.fromLineTokens(line).toLineTokens(codec))), lineState(TokenWithTextArray.fromLineTokens(line).toLineTokens(codec)));
});

test('Rust token sequence transforms retain provider callbacks, custom iterators, range getters, and builder sharing', () => {
	const failure = new Error('Original token sequence provider failure');
	class CustomTokens extends LineTokens {
		public override getTokenText(): string { throw failure; }
		public override getEndOffset(): number { throw failure; }
	}
	const custom = new CustomTokens(new Uint32Array([3, 7]), 'abc', codec);
	assert.throws(() => withRust(() => TokenArray.fromLineTokens(custom)), error => error === failure);
	assert.throws(() => withRust(() => TokenWithTextArray.fromLineTokens(custom)), error => error === failure);
	let reads = 0;
	const data = [{ get text() { reads++; return 'x\uD800'; }, metadata: 7 }];
	const expected = LineTokens.createFromTextAndMetadata(data, codec);
	const count = reads; reads = 0;
	assert.deepStrictEqual(withRust(() => ({ state: lineState(LineTokens.createFromTextAndMetadata(data, codec)), reads })), { state: lineState(expected), reads: count });
	const items = [new TokenInfo(3, 7), new TokenInfo(4, 9)];
	Object.defineProperty(items, Symbol.iterator, { value: function* () { yield new TokenInfo(2, 42); yield items[0]; } });
	const array = TokenArray.create(items);
	assert.deepStrictEqual(withRust(() => array.slice(new OffsetRange(1, 4))), array.slice(new OffsetRange(1, 4)));
	const range = new OffsetRange(0, 4);
	Object.defineProperty(range, 'start', { get: () => { reads++; return 1; } });
	reads = 0;
	const reference = array.slice(range);
	const referenceReads = reads; reads = 0;
	assert.deepStrictEqual(withRust(() => ({ value: array.slice(range), reads })), { value: reference, reads: referenceReads });
	const builder = new TokenArrayBuilder();
	builder.add(1, 2);
	const held = builder.build();
	builder.add(3, 4);
	assert.deepStrictEqual(withRust(() => held.slice(new OffsetRange(0, 4))), held.slice(new OffsetRange(0, 4)));
	const textBuilder = new TokenWithTextArrayBuilder();
	textBuilder.add('\uD800', 7);
	const textHeld = textBuilder.build();
	textBuilder.add('\uDC00', 9);
	assert.deepStrictEqual(withRust(() => lineState(textHeld.toLineTokens(codec))), lineState(textHeld.toLineTokens(codec)));
	const detached = new Uint32Array([3, 7]);
	const source = new LineTokens(detached, 'abc', codec);
	structuredClone(detached.buffer, { transfer: [detached.buffer] });
	assert.deepStrictEqual(withRust(() => TokenArray.fromLineTokens(source)), TokenArray.fromLineTokens(source));
	assert.deepStrictEqual(withRust(() => TokenWithTextArray.fromLineTokens(source)), TokenWithTextArray.fromLineTokens(source));
});

test('Rust token sequence bindings validate results and retain oversized and unsupported states before mutation', () => {
	const items = [new TokenWithTextInfo('abc', 7)];
	const range = new OffsetRange(0, 3);
	const source = LineTokens.createFromTextAndMetadata(items, codec);
	withRust(() => {
		assert.strictEqual(tryCreateRustLineTokens([{ text: 'a'.repeat(4 * 1024 * 1024 + 1), metadata: 7 }]), undefined);
		assert.strictEqual(trySliceRustTokenSequence(new Array<TokenInfo>(262145), range, false), undefined);
		assert.strictEqual(tryReadRustTokenArray(source, LineTokens.prototype, false)?.length, 2);
	});
	assert.strictEqual(rust.slice_token_array(new Float64Array(262145), 0, 3), undefined);
	assert.strictEqual(rust.line_token_array(new Uint32Array([3]), 3, false), undefined);
	withRust(() => assert.throws(() => trySliceRustTokenSequence(items, range, true), /token slice/), { ...rust, slice_token_array: () => new Float64Array([1, 0, 0, 3]) });
	withRust(() => assert.throws(() => tryReadRustTokenArray(source, LineTokens.prototype, false), /token sequence/), { ...rust, line_token_array: () => new Float64Array([3]) });
	withRust(() => assert.throws(() => tryCreateRustLineTokens(items), /token construction/), { ...rust, create_line_tokens: () => [new Uint32Array([2, 7]), 'abc'] });
	assert.throws(() => registerRustTokens({ ...rust, tokens_abi_version: () => 8 }), /metadata contract/);
});

test('Rust token callback traversal preserves seeded live array mutations, callback values, and second length reads', () => {
	let calls = 0;
	const module: IRustTokensModule = {
		...rust,
		walk_token_array<T, U>(iterator: Iterator<T>, next: Iterator<T>['next'], readLength: (token: T) => number, visit: (start: number, end: number, token: T) => U, coercingAdd: (first: number, second: number) => number, mapping: boolean): U[] | true {
			calls++;
			return rust.walk_token_array(iterator, next, readLength, visit, coercingAdd, mapping);
		}
	};
	for (let trace = 0; trace < 512; trace++) {
		for (const text of [false, true]) {
			for (const mapping of [false, true]) {
				const run = () => {
					const initial = Array.from({ length: 1 + trace % 8 }, (_, index) => text ? new TokenWithTextInfo('a\uD800'.repeat(index % 3), index) : new TokenInfo(index % 4 / 2, index));
					const array = text ? TokenWithTextArray.create(initial as TokenWithTextInfo[]) : TokenArray.create(initial as TokenInfo[]);
					const visited: { start: number; end: number; metadata: number; identity: number }[] = [];
					const readLog: string[] = [];
					const returns: object[] = [];
					const callback = (range: OffsetRange, token: TokenInfo | TokenWithTextInfo) => {
						const index = visited.length;
						visited.push({ start: range.start, end: range.endExclusive, metadata: token.metadata, identity: initial.indexOf(token) });
						if (index === 0) {
							const property = text ? 'text' : 'length';
							Object.defineProperty(token, property, { configurable: true, get: () => { readLog.push('current'); return text ? '\uDC00\uD83D\uDE00' : trace % 7 / 2; } });
							if (trace % 3 === 0) { initial.push(text ? new TokenWithTextInfo('z', 42) : new TokenInfo(3, 42)); }
							if (trace % 3 === 1) { initial.splice(1, 1); }
							if (initial.length > 1) { Object.defineProperty(initial[1], property, { configurable: true, get: () => { readLog.push('next'); return text ? 'x\uD800' : 2.5; } }); }
						}
						const value = { token, index, range };
						returns.push(value);
						return value;
					};
					const result = mapping ? array.map(callback) : array.forEach(callback);
					return { visited, readLog, resultCount: result?.length, returnIdentity: result?.every((value, index) => value === returns[index]) };
				};
				assert.deepStrictEqual(withRust(run, module), run());
			}
		}
	}
	assert.strictEqual(calls, 2048, 'Every initially supported traversal uses the native implementation');
});

test('Rust token traversal preserves callback-installed coercion, failures, recursion, and initial accessor fallback', () => {
	const values = [0, -0, 2.5, -2, Number.NaN, Number.POSITIVE_INFINITY, '2', undefined, null, Symbol('length')];
	for (const value of values) {
		const run = () => {
			const items = [new TokenInfo(3, 7), new TokenInfo(4, 9)];
			const array = TokenArray.create(items);
			const visited: { start: number; end: number }[] = [];
			return {
				result: capture(() => array.map((range, token) => {
					visited.push({ start: range.start, end: range.endExclusive });
					if (token === items[0]) { Object.defineProperty(token, 'length', { value }); }
					return token;
				})), visited
			};
		};
		assert.deepStrictEqual(withRust(run), run());
	}
	const failure = new Error('Original token traversal callback failure');
	const items = [new TokenInfo(3, 7), new TokenInfo(4, 9)];
	const array = TokenArray.create(items);
	assert.throws(() => withRust(() => array.map(() => { throw failure; })), error => error === failure);
	const run = () => array.map((_range, token) => array.map((_range, nested) => nested.metadata + token.metadata));
	assert.deepStrictEqual(withRust(run), run());
	let reads = 0;
	Object.defineProperty(items[0], 'length', { get: () => { reads++; return 3; } });
	const expected = array.map((range, token) => ({ range, token }));
	const count = reads; reads = 0;
	assert.deepStrictEqual(withRust(() => ({ value: array.map((range, token) => ({ range, token })), reads })), { value: expected, reads: count });
});

test('Rust token iterator kernels preserve abrupt completion and iterator closing without masking original exceptions', () => {
	const failure = new Error('Original token iterator failure');
	for (const phase of ['next', 'done', 'value', 'before', 'callback', 'after', 'coercion']) {
		for (const close of ['normal', 'getter', 'method', 'primitive']) {
			const run = (native: boolean) => {
				const log: string[] = [];
				const token = new TokenInfo(3, 7);
				let reads = 0;
				const iterator: Iterator<TokenInfo> = {
					next: () => {
						log.push('next');
						if (phase === 'next') { throw failure; }
						return {
							get done() { log.push('done'); if (phase === 'done') { throw failure; } return false; },
							get value() { log.push('value'); if (phase === 'value') { throw failure; } return token; }
						};
					}
				};
				Object.defineProperty(iterator, 'return', {
					get: () => {
						log.push('return getter');
						if (close === 'getter') { throw new Error('Ignored close getter failure'); }
						return () => { log.push('return method'); if (close === 'method') { throw new Error('Ignored close method failure'); } return close === 'primitive' ? 1 : { done: true }; };
					}
				});
				Object.defineProperty(token, 'length', {
					get: () => {
						log.push('length'); reads++;
						if ((phase === 'before' && reads === 1) || (phase === 'after' && reads === 2)) { throw failure; }
						return phase === 'coercion' ? { valueOf: () => { log.push('coercion'); throw failure; } } : 3;
					}
				});
				const visit = (range: OffsetRange) => { log.push('callback'); if (phase === 'callback') { throw failure; } return range; };
				const execute = () => {
					if (native) { return rust.walk_token_array(iterator, iterator.next, token => token.length, (start, end) => visit(new OffsetRange(start, end)), (first, second) => first + second, true); }
					const items = [token];
					Object.defineProperty(items, Symbol.iterator, { value: () => iterator });
					return TokenArray.create(items).map(visit);
				};
				assert.throws(execute, error => error === failure);
				return log;
			};
			assert.deepStrictEqual(run(true), run(false), `${phase}/${close}`);
		}
	}
	const iterator = [new TokenInfo(3, 7)][Symbol.iterator]();
	assert.throws(() => rust.walk_token_array(iterator, () => 1 as never, token => token.length, () => undefined, (first, second) => first + second, false), /iterator result/);
	withRust(() => assert.throws(() => TokenArray.create([new TokenInfo(3, 7)]).map((_range, token) => token), /token traversal/), { ...rust, walk_token_array: () => true });
	assert.throws(() => registerRustTokens({ ...rust, tokens_abi_version: () => 9 }), /metadata contract/);
});
