/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { WordCharacterClass, WordCharacterClassifier } from '../../src/vs/editor/common/core/wordCharacterClassifier.js';
import { Searcher, isValidMatch } from '../../src/vs/editor/common/model/textModelSearch.js';
import { IRustTextSearchModule, registerRustTextSearch } from '../../src/vs/editor/common/model/rustTextSearch.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustTextSearchModule = rust): T {
	const registration = registerRustTextSearch(module);
	try { return compute(); } finally { registration.dispose(); }
}

function state(searcher: Searcher, regex: RegExp): object {
	return { start: Object.getOwnPropertyDescriptor(searcher, '_prevMatchStartIndex')!.value, length: Object.getOwnPropertyDescriptor(searcher, '_prevMatchLength')!.value, lastIndex: regex.lastIndex };
}

test('Rust Searcher preserves seeded regex captures, Unicode zero-width matches, word filtering, and resets', () => {
	const patterns = ['(?:)', '^|$', '\\b', '(?=x)', '.', '(?<word>\\w*)', 'x+', '(?:😀|\\uD800)', '[\\r\\n]+', '(?<=x)y'];
	const flags = ['g', 'gu', 'gy'];
	const alphabet = ['x', 'y', 'a', ' ', '\t', '\r', '\n', '😀', '\uD800', '\uDC00', '_', '-'];
	let seed = 1543;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const calls = { next: 0, reset: 0 };
	const module: IRustTextSearchModule = { ...rust, run_text_search: (host, reset) => { calls[reset ? 'reset' : 'next']++; return rust.run_text_search(host, reset); } };
	for (let trace = 0; trace < 256; trace++) {
		const text = Array.from({ length: random(32) }, () => alphabet[random(alphabet.length)]).join('');
		const pattern = patterns[random(patterns.length)];
		const flag = flags[random(flags.length)];
		const run = () => {
			const regex = new RegExp(pattern, flag);
			const searcher = new Searcher(trace % 2 ? new WordCharacterClassifier('_-', []) : null, regex);
			return [0, Math.floor(text.length / 2), text.length, 0].map(offset => {
				searcher.reset(offset);
				const matches: object[] = [];
				let match: RegExpExecArray | null;
				while ((match = searcher.next(text)) !== null) {
					matches.push({ index: match.index, values: [...match], input: match.input, groups: match.groups, state: state(searcher, regex) });
					if (matches.length > 128) { throw new Error('Unexpected search loop'); }
				}
				return { matches, state: state(searcher, regex) };
			});
		};
		assert.deepStrictEqual(withRust(run, module), run(), `Searcher trace ${trace}`);
	}
	assert.ok(calls.next > 1000 && calls.reset === 1024, 'Actual Searcher calls execute native control');
});

test('Rust Searcher retains receiver and match proxies, borrowed string callbacks, and original result identities', () => {
	const run = () => {
		const observations: string[] = [];
		const content = '😀xy';
		const text = {
			get length() { observations.push('text:length'); return content.length; },
			[Symbol.toPrimitive]: () => { observations.push('text:primitive'); return content; },
			charCodeAt: (offset: number) => { observations.push(`text:unit:${offset}`); return content.charCodeAt(offset); }
		};
		const regex = /(?:)/gu;
		const results: RegExpExecArray[] = [];
		regex.exec = value => {
			observations.push('regexp:exec');
			const matched = RegExp.prototype.exec.call(regex, value);
			if (!matched) { return null; }
			const result = new Proxy(matched, { get: (target, key, receiver) => { observations.push(`match:${String(key)}`); return Reflect.get(target, key, receiver); } });
			results.push(result);
			return result;
		};
		const target = new Searcher(null, regex);
		const searcher = new Proxy(target, {
			get: (target, key, receiver) => { observations.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); },
			set: (target, key, value, receiver) => { observations.push(`set:${String(key)}`); return Reflect.set(target, key, value, receiver); }
		});
		searcher.reset(0);
		const identities: number[] = [];
		let match: RegExpExecArray | null;
		while ((match = searcher.next(text as unknown as string)) !== null) { identities.push(results.indexOf(match)); }
		return { observations, identities, state: state(target, regex) };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust Searcher preserves exceptional state, coercion observations, non-global repeats, and readonly partial writes', () => {
	for (const value of [undefined, null, '0', 0n, Number.NaN, -0, Number.POSITIVE_INFINITY, -0.5]) {
		const run = () => {
			const regex = /x/g;
			const searcher = new Searcher(null, regex);
			Object.defineProperty(searcher, '_prevMatchStartIndex', { value });
			let failure: string | undefined;
			let index: number | undefined;
			try { index = searcher.next('ax')?.index; } catch (error) { failure = error instanceof Error ? error.name : 'non-error'; }
			return { failure, index, state: state(searcher, regex) };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
	for (const field of ['_prevMatchStartIndex', '_prevMatchLength']) {
		const run = () => {
			const regex = /x/;
			const searcher = new Searcher(null, regex);
			Object.defineProperty(searcher, field, { writable: false });
			assert.throws(() => searcher.next('ax'), TypeError);
			assert.throws(() => searcher.reset(3), TypeError);
			return state(searcher, regex);
		};
		assert.deepStrictEqual(withRust(run), run());
	}
	const run = () => {
		const observations: string[] = [];
		const regex = /x/;
		const searcher = new Searcher(null, regex);
		Object.defineProperty(searcher, '_prevMatchStartIndex', { value: { valueOf: () => { observations.push('previous:primitive'); return -1; } } });
		const first = searcher.next('ax');
		const second = searcher.next('ax');
		return { observations, first: first?.index, second, state: state(searcher, regex) };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust Searcher retains provider failure identity and cache commits before word filtering', () => {
	const failure = new Error('Original search word classification failure');
	const run = () => {
		const classifier = new WordCharacterClassifier('-', []);
		classifier.get = () => { throw failure; };
		const regex = /x/g;
		const searcher = new Searcher(classifier, regex);
		assert.throws(() => searcher.next('axb'), error => error === failure);
		return state(searcher, regex);
	};
	assert.deepStrictEqual(withRust(run), run());
	const regexFailure = () => {
		const regex = /x/g;
		regex.exec = () => { throw failure; };
		const searcher = new Searcher(null, regex);
		assert.throws(() => searcher.next('x'), error => error === failure);
		return state(searcher, regex);
	};
	assert.deepStrictEqual(withRust(regexFailure), regexFailure());
});

test('Rust Searcher releases failed result consumption and rejects stale registrations atomically', () => {
	let frees = 0;
	const failure = new Error('Original search result consumption failure');
	const module: IRustTextSearchModule = { ...rust, run_text_search: () => ({ take: () => { throw failure; }, free: () => { frees++; } }) };
	withRust(() => assert.throws(() => new Searcher(null, /x/g).next('x'), error => error === failure), module);
	assert.strictEqual(frees, 1);
	assert.throws(() => registerRustTextBuffer({ ...rust, text_search_abi_version: () => 0 }), /searcher control contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustTextSearch(rust), /already registered/); } finally { registration.dispose(); }
});

test('Rust search word boundaries preserve UTF-16 edges, internal separators, and empty matches', () => {
	const texts = ['', 'word', 'a-word-b', ' a ', '\rword\n', '\tword\t', '\uD83D\uDE00', '\uD800x\uDC00', 'a\r\nb'];
	let calls = 0;
	const module: IRustTextSearchModule = { ...rust, is_valid_text_search_match: (...args) => { calls++; return rust.is_valid_text_search_match(...args); } };
	for (const text of texts) {
		for (let start = -1; start <= text.length + 1; start++) {
			for (let length = -1; length <= text.length + 1; length++) {
				const run = () => isValidMatch(new WordCharacterClassifier('-_', []), text, text.length, start, length);
				assert.strictEqual(withRust(run, module), run(), `${JSON.stringify(text)} at ${start} length ${length}`);
			}
		}
	}
	assert.ok(calls > 400, 'Word validation executes native boundary control');
});

test('Rust search word boundaries retain dynamic methods, receiver identity, and exact short circuits', () => {
	for (const content of ['axb', 'a-b', '\rxb', 'ax\n', ' x ', 'a\r\nb']) {
		for (const length of [0, 1, 2]) {
			const run = () => {
				const observations: string[] = [];
				const text = {
					get charCodeAt() {
						observations.push('text:method');
						return (index: number) => { observations.push(`text:unit:${index}`); return content.charCodeAt(index); };
					}
				};
				const target = new WordCharacterClassifier('-', []);
				const classifier = new Proxy(target, {
					get: (target, key, receiver) => { observations.push(`classifier:${String(key)}`); return Reflect.get(target, key, receiver); }
				});
				const valid = isValidMatch(classifier, text as unknown as string, content.length, 1, length);
				return { valid, observations };
			};
			assert.deepStrictEqual(withRust(run), run());
		}
	}
});

test('Rust search word boundaries preserve exceptional numeric domains and ECMAScript coercion', () => {
	const values = [undefined, null, '1', 0n, Symbol('index'), Number.NaN, -0, -0.5, Number.POSITIVE_INFINITY];
	for (const slot of [0, 1, 2]) {
		for (const value of values) {
			const run = () => {
				const args = [3, 1, 1];
				args[slot] = value as unknown as number;
				try { return { valid: isValidMatch(new WordCharacterClassifier('-', []), 'a-b', args[0], args[1], args[2]) }; }
				catch (error) { return { error: error instanceof Error ? error.name : 'non-error' }; }
			};
			assert.deepStrictEqual(withRust(run), run());
		}
	}
	const run = () => {
		const observations: string[] = [];
		const start = { [Symbol.toPrimitive]: (hint: string) => { observations.push(`start:${hint}`); return 1; } };
		const length = { [Symbol.toPrimitive]: (hint: string) => { observations.push(`length:${hint}`); return 1; } };
		const classifier = new WordCharacterClassifier('-', []);
		const valid = isValidMatch(classifier, 'a-b', 3, start as unknown as number, length as unknown as number);
		return { valid, observations };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust search word boundaries retain classifier failure identity and unusual classification values', () => {
	const failure = new Error('Original word boundary failure');
	for (const failingCall of [1, 2, 3, 4]) {
		const run = () => {
			const observations: number[] = [];
			const classifier = new WordCharacterClassifier('-', []);
			classifier.get = value => { observations.push(value); if (observations.length === failingCall) { throw failure; } return value === 45 ? WordCharacterClass.WordSeparator : WordCharacterClass.Regular; };
			let caught = false;
			let valid: boolean | undefined;
			try { valid = isValidMatch(classifier, 'a-b', 3, 1, 1); } catch (error) { assert.strictEqual(error, failure); caught = true; }
			return { valid, caught, observations };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
	for (const value of [undefined, null, '0', 0n, {}, Number.NaN, -0, 2]) {
		const run = () => {
			const classifier = new WordCharacterClassifier('-', []);
			classifier.get = () => value as WordCharacterClass;
			return isValidMatch(classifier, 'axb', 3, 1, 1);
		};
		assert.strictEqual(withRust(run), run());
	}
});
