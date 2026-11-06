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
import { SearchParams, Searcher, TextModelSearch, createFindMatch, isMultilineRegexSource, isValidMatch } from '../../src/vs/editor/common/model/textModelSearch.js';
import { DefaultEndOfLine, FindMatch, SearchData } from '../../src/vs/editor/common/model.js';
import { TextModel } from '../../src/vs/editor/common/model/textModel.js';
import { Position } from '../../src/vs/editor/common/core/position.js';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
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

// Exercise the integrated private collection boundary independently of model validation.
const lineSearch = TextModelSearch as unknown as {
	_findMatchesInLine(searchData: SearchData, text: string, lineNumber: number, delta: number, count: number, result: FindMatch[], captures: boolean, limit: number): number;
};

interface ILineFeedCounter {
	_lineFeedsOffsets: number[];
	findLineFeedCountBeforeOffset(offset: number): number;
}
const multilineSearch = TextModelSearch as unknown as {
	_getMultilineMatchRange(model: TextModel, delta: number, text: string, counter: ILineFeedCounter | null, index: number, match: string): Range;
};
const navigationSearch = TextModelSearch as unknown as {
	_findFirstMatchInLine(searcher: Searcher, text: string, line: number, column: number, captures: boolean): FindMatch | null;
	_findLastMatchInLine(searcher: Searcher, text: string, line: number, captures: boolean): FindMatch | null;
	_doFindNextMatchLineByLine(model: TextModel, start: Position, searcher: Searcher, captures: boolean): FindMatch | null;
	_doFindPreviousMatchLineByLine(model: TextModel, start: Position, searcher: Searcher, captures: boolean): FindMatch | null;
};

function captureLineFeedCounter(): ILineFeedCounter {
	const model = createTextModel('a\r\nb\r\nc', null, { defaultEOL: DefaultEndOfLine.CRLF });
	let counter: ILineFeedCounter | undefined;
	const original = multilineSearch._getMultilineMatchRange;
	multilineSearch._getMultilineMatchRange = (...args) => { counter = args[3] ?? undefined; return original(...args); };
	try {
		TextModelSearch.findMatches(model, new SearchParams('\\n', true, true, null), model.getFullModelRange(), false, 1);
		assert.ok(counter, 'Multiline search creates its real LF counter');
		return counter;
	} finally { multilineSearch._getMultilineMatchRange = original; model.dispose(); }
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

test('Rust line search collection preserves literal/regex results, captures, limits, and existing array entries', () => {
	let calls = 0;
	const module: IRustTextSearchModule = { ...rust, collect_text_search_matches: (...args) => { calls++; return rust.collect_text_search_matches(...args); } };
	for (const text of ['', 'x', 'x x x', 'axb x ax', '\uD83D\uDE00x\uD800', '\rx\nx']) {
		for (const pattern of ['x', '(?:)', '(?<word>x*)', '\\b', '.', '(?=x)']) {
			for (const captures of [false, true]) {
				for (const literal of [false, true]) {
					for (const limit of [0, 1, 2, 20]) {
						const run = () => {
							const regex = new RegExp(pattern, 'gu');
							const data = new SearchData(regex, new WordCharacterClassifier('-', []), literal ? 'x' : null);
							const result: FindMatch[] = [];
							const count = lineSearch._findMatchesInLine(data, text, 3, 7, 2, result, captures, limit);
							return { count, result, lastIndex: regex.lastIndex };
						};
						assert.deepStrictEqual(withRust(run, module), run());
					}
				}
			}
		}
	}
	assert.strictEqual(calls, 576, 'Line collection enters the native implementation');
});

test('Rust line search collection retains live source/data/result proxies and regex capture observations', () => {
	for (const literal of [true, false]) {
		const run = () => {
			const observations: string[] = [];
			const content = 'x x';
			const text = {
				get length() { observations.push('text:length'); return content.length; },
				get indexOf() { observations.push('text:indexOf'); return (search: string, index: number) => { observations.push(`find:${search}:${index}`); return content.indexOf(search, index); }; },
				[Symbol.toPrimitive]: () => { observations.push('text:primitive'); return content; }
			};
			const regex = /(?<word>x)/g;
			regex.exec = text => {
				observations.push('regex:exec');
				const match = RegExp.prototype.exec.call(regex, text);
				return match ? new Proxy(match, { get: (target, key, receiver) => { observations.push(`match:${String(key)}`); return Reflect.get(target, key, receiver); } }) : null;
			};
			const data = new Proxy(new SearchData(regex, null, literal ? 'x' : null), {
				get: (target, key, receiver) => { observations.push(`data:${String(key)}`); return Reflect.get(target, key, receiver); }
			});
			const result = new Proxy<FindMatch[]>([], { set: (target, key, value, receiver) => { observations.push(`result:${String(key)}`); return Reflect.set(target, key, value, receiver); } });
			const count = lineSearch._findMatchesInLine(data, text as unknown as string, 4, 2, 0, result, !literal, 10);
			return { count, result, observations };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust line search collection preserves numeric coercions, exceptional operands, and postfix result indices', () => {
	const values = [undefined, null, '1', 0n, Number.NaN, -0, -0.5, Number.POSITIVE_INFINITY, Symbol('operand')];
	for (const literal of [true, false]) {
		for (const slot of [0, 1, 2]) {
			for (const value of values) {
				const run = () => {
					const args = [0, 0, 10];
					args[slot] = value as unknown as number;
					const result: FindMatch[] = [];
					const regex = /x/g;
					let count: number | undefined;
					let error: string | undefined;
					try { count = lineSearch._findMatchesInLine(new SearchData(regex, null, literal ? 'x' : null), 'x x', 1, args[0], args[1], result, false, args[2]); }
					catch (failure) { error = failure instanceof Error ? failure.name : 'non-error'; }
					return { count, entries: Object.entries(result), keys: Object.keys(result), lastIndex: regex.lastIndex, error };
				};
				assert.deepStrictEqual(withRust(run), run());
			}
		}
	}
	const run = () => {
		const observations: string[] = [];
		const operand = (name: string, value: number) => {
			const dynamic = { [Symbol.toPrimitive]: (hint: string) => { observations.push(`${name}:${hint}`); return value; } };
			return dynamic as unknown as number;
		};
		const result: FindMatch[] = [];
		const count = lineSearch._findMatchesInLine(new SearchData(/x/g, null, 'x'), 'x x', 1, operand('delta', 2), operand('count', 0), result, false, operand('limit', 1));
		return { count, result, observations };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust line search collection preserves failure identities and partially written aliased results', () => {
	const failure = new Error('Original line search failure');
	for (const literal of [true, false]) {
		for (const mode of ['write', 'limit', 'exec', 'frozen']) {
			const run = () => {
				const regex = /x/g;
				let calls = 0;
				if (mode === 'exec') { regex.exec = text => { if (++calls === 2) { throw failure; } return RegExp.prototype.exec.call(regex, text); }; }
				const target: FindMatch[] = [];
				const result = mode === 'write' ? new Proxy(target, { set: (target, key, value, receiver) => { if (key === '1') { throw failure; } return Reflect.set(target, key, value, receiver); } }) : target;
				if (mode === 'frozen') { Object.freeze(target); }
				const dynamicLimit = { [Symbol.toPrimitive]: () => { throw failure; } };
				const limit = mode === 'limit' ? dynamicLimit as unknown as number : 10;
				let caught: string | undefined;
				try { lineSearch._findMatchesInLine(new SearchData(regex, null, literal ? 'x' : null), 'x x', 1, 0, 0, result, false, limit); }
				catch (error) { if (mode === 'frozen') { assert.ok(error instanceof TypeError); caught = 'TypeError'; } else { assert.strictEqual(error, failure); caught = 'original'; } }
				return { result, calls, lastIndex: regex.lastIndex, caught };
			};
			assert.deepStrictEqual(withRust(run), run());
		}
	}
});

test('Rust multiline offsets preserve public LF/CRLF results, surrogate coordinates, and navigation', () => {
	const calls = { scan: 0, count: 0, range: 0 };
	const module: IRustTextSearchModule = {
		...rust,
		scan_text_search_line_feeds: host => { calls.scan++; return rust.scan_text_search_line_feeds(host); },
		count_text_search_line_feeds: (host, target) => { calls.count++; return rust.count_text_search_line_feeds(host, target); },
		text_search_multiline_range: (...args) => { calls.range++; return rust.text_search_multiline_range(...args); }
	};
	for (const eol of ['\n', '\r\n']) {
		for (const lines of [['', '', ''], ['x', 'y', 'x'], ['\uD83D\uDE00', '\uD800x', '\uDC00'], ['axb', 'x', 'z']]) {
			for (const pattern of ['\\n', '^', 'x\\n', '[\\W]', '(?:x|\\n)+']) {
				const run = () => {
					const model = createTextModel(lines.join(eol));
					try {
						const params = new SearchParams(pattern, true, true, null);
						const range = model.getFullModelRange();
						return {
							all: TextModelSearch.findMatches(model, params, range, true, 30),
							next: TextModelSearch.findNextMatch(model, params, new Position(2, 1), true),
							previous: TextModelSearch.findPreviousMatch(model, params, new Position(2, 1), true)
						};
					} finally { model.dispose(); }
				};
				assert.deepStrictEqual(withRust(run, module), run());
			}
		}
	}
	assert.ok(calls.scan > 10 && calls.count > 20 && calls.range > 20, 'Public multiline search executes the native offset boundaries');
});

test('Rust LF queries retain live arrays, reordered offsets, target coercions, and original failures', () => {
	for (const offsets of [[], [0], [1, 3, 5], [5, 1, 3], [1, 1, 3]]) {
		for (const target of [-1, 0, 1, 2, 3, 5, 10, Number.NaN, Number.POSITIVE_INFINITY, '2', 0n, null]) {
			const run = () => {
				const counter = captureLineFeedCounter();
				const observations: string[] = [];
				counter._lineFeedsOffsets = new Proxy([...offsets], { get: (array, key, receiver) => { observations.push(String(key)); return Reflect.get(array, key, receiver); } });
				const count = counter.findLineFeedCountBeforeOffset(target as number);
				return { count, observations };
			};
			assert.deepStrictEqual(withRust(run), run());
		}
	}
	const failure = new Error('Original LF offset failure');
	const run = () => {
		const counter = captureLineFeedCounter();
		const observations: string[] = [];
		const target = { [Symbol.toPrimitive]: (hint: string) => { observations.push(`target:${hint}`); return 3; } };
		counter._lineFeedsOffsets = new Proxy([1, 3, 5], { get: (array, key, receiver) => { observations.push(String(key)); if (key === '1') { throw failure; } return Reflect.get(array, key, receiver); } });
		assert.throws(() => counter.findLineFeedCountBeforeOffset(target as unknown as number), error => error === failure);
		return observations;
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust multiline ranges retain repeated length reads, counter/provider order, and failure identity', () => {
	const failure = new Error('Original multiline range failure');
	for (const useCounter of [false, true]) {
		for (const failingPosition of [0, 1, 2]) {
			const run = () => {
				const observations: string[] = [];
				const model = createTextModel('x\r\ny');
				try {
					let positions = 0;
					model.getPositionAt = offset => {
						observations.push(`position:${offset}`);
						if (++positions === failingPosition) { throw failure; }
						return new Proxy(new Position(2, offset + 1), { get: (target, key, receiver) => { observations.push(`position:${String(key)}`); return Reflect.get(target, key, receiver); } });
					};
					const match = { get length() { observations.push('match:length'); return 2; } };
					const counter = { _lineFeedsOffsets: [], findLineFeedCountBeforeOffset: (index: number) => { observations.push(`counter:${index}`); return index < 3 ? 0 : 1; } };
					let range: Range | undefined;
					let caught = false;
					try { range = multilineSearch._getMultilineMatchRange(model, 4, '', useCounter ? counter : null, 1, match as unknown as string); }
					catch (error) { assert.strictEqual(error, failure); caught = true; }
					return { range, observations, caught };
				} finally { model.dispose(); }
			};
			assert.deepStrictEqual(withRust(run), run());
		}
	}
});

test('Rust LF offset arrays use native ownership and materialize original descriptors when frozen', () => {
	const registration = registerRustTextBuffer(rust);
	try {
		const counter = captureLineFeedCounter();
		const array = counter._lineFeedsOffsets;
		assert.deepStrictEqual([Array.isArray(array), [...array], Object.keys(array)], [true, [1, 3], ['0', '1']]);
		array[0] = 0;
		array.push(5);
		assert.strictEqual(counter.findLineFeedCountBeforeOffset(4), 2);
		const active = rust.bracket_number_array_live_count();
		Object.freeze(array);
		assert.deepStrictEqual([rust.bracket_number_array_live_count(), Object.getOwnPropertyDescriptor(array, '0'), counter.findLineFeedCountBeforeOffset(5)], [active - 1, { value: 0, writable: false, enumerable: true, configurable: false }, 2]);
	} finally { registration.dispose(); }
});

test('Rust LF scans retain borrowed text callbacks, strict character equality, and failure identity', () => {
	const failure = new Error('Original LF scan failure');
	for (const lineFeed of [10, '10', 10n, Symbol('line-feed')]) {
		for (const fail of [false, true]) {
			const run = () => {
				const observations: string[] = [];
				const model = createTextModel('a\r\nb\r\nc');
				const content = 'a\nb\nc';
				const text = {
					get length() { observations.push('text:length'); return content.length; },
					get charCodeAt() {
						observations.push('text:method');
						return (index: number) => { observations.push(`text:unit:${index}`); if (fail && index === 3) { throw failure; } return content[index] === '\n' ? lineFeed : content.charCodeAt(index); };
					},
					[Symbol.toPrimitive]: () => { observations.push('text:primitive'); return content; }
				};
				model.getValueInRange = () => text as unknown as string;
				try {
					let result: FindMatch[] | undefined;
					let caught = false;
					try { result = TextModelSearch.findMatches(model, new SearchParams('\\n', true, true, null), model.getFullModelRange(), false, 10); }
					catch (error) { assert.strictEqual(error, failure); caught = true; }
					return { result, observations, caught };
				} finally { model.dispose(); }
			};
			assert.deepStrictEqual(withRust(run), run());
		}
	}
});

test('Rust line navigation preserves public forward/backward wrapping, columns, captures, and empty matches', () => {
	const calls = [0, 0, 0, 0];
	const module: IRustTextSearchModule = { ...rust, run_text_search_navigation: (host, operation) => { calls[operation]++; return rust.run_text_search_navigation(host, operation); } };
	for (const text of ['', 'x\ny\nx', 'ax x\nxax\n', '\uD83D\uDE00x\n\uD800x\n\uDC00']) {
		for (const pattern of ['x', '(?:)', '(?<word>x*)', '.', '\\b']) {
			for (const captures of [false, true]) {
				const run = () => {
					const model = createTextModel(text);
					try {
						const params = new SearchParams(pattern, true, true, null);
						const results: object[] = [];
						for (let line = 1; line <= model.getLineCount(); line++) {
							for (let column = 1; column <= model.getLineMaxColumn(line); column++) {
								const position = new Position(line, column);
								results.push({ next: TextModelSearch.findNextMatch(model, params, position, captures), previous: TextModelSearch.findPreviousMatch(model, params, position, captures) });
							}
						}
						return results;
					} finally { model.dispose(); }
				};
				assert.deepStrictEqual(withRust(run, module), run());
			}
		}
	}
	assert.ok(calls.every(count => count > 100), 'All four integrated navigation operations execute Rust');
});

test('Rust line navigation retains virtual provider order, start-column reads, and original early-return identity', () => {
	for (const previous of [true, false]) {
		for (const succeed of [0, 1, 3]) {
			const run = () => {
				const observations: string[] = [];
				const target = createTextModel('a\nb\nc');
				const model = new Proxy(target, { get: (target, key, receiver) => { observations.push(`model:${String(key)}`); return Reflect.get(target, key, receiver); } });
				const start = new Proxy(new Position(2, 1), { get: (target, key, receiver) => { observations.push(`start:${String(key)}`); return Reflect.get(target, key, receiver); } });
				const match = new FindMatch(new Range(2, 1, 2, 2), null);
				let count = 0;
				const first = (_searcher: Searcher, text: string, line: number, column: number, captures: boolean) => { observations.push(`first:${text}:${line}:${column}:${captures}`); return ++count === succeed ? match : null; };
				const last = (_searcher: Searcher, text: string, line: number, captures: boolean) => { observations.push(`last:${text}:${line}:${captures}`); return ++count === succeed ? match : null; };
				const owner = new Proxy(TextModelSearch, {
					get: (target, key, receiver) => {
						observations.push(`owner:${String(key)}`);
						if (key === '_findFirstMatchInLine') { return first; }
						if (key === '_findLastMatchInLine') { return last; }
						return Reflect.get(target, key, receiver);
					}
				});
				try {
					const method = previous ? navigationSearch._doFindPreviousMatchLineByLine : navigationSearch._doFindNextMatchLineByLine;
					const result = Reflect.apply(method, owner, [model, start, new Searcher(null, /x/g), true]);
					return { identity: result === match, result, observations };
				} finally { target.dispose(); }
			};
			assert.deepStrictEqual(withRust(run), run());
		}
	}
});

test('Rust first/last line matches preserve searcher proxies, reset coercion, captures, and exceptions', () => {
	const failure = new Error('Original navigation match failure');
	for (const last of [true, false]) {
		for (const fail of [true, false]) {
			const run = () => {
				const observations: string[] = [];
				const regex = /(x)/g;
				regex.exec = text => {
					observations.push('regex:exec');
					const match = RegExp.prototype.exec.call(regex, text);
					return match ? new Proxy(match, { get: (target, key, receiver) => { observations.push(`match:${String(key)}`); if (fail && key === 'length') { throw failure; } return Reflect.get(target, key, receiver); } }) : null;
				};
				const target = new Searcher(null, regex);
				const searcher = new Proxy(target, { get: (target, key, receiver) => { observations.push(`searcher:${String(key)}`); return Reflect.get(target, key, receiver); } });
				const from = { [Symbol.toPrimitive]: (hint: string) => { observations.push(`column:${hint}`); return 1; } };
				let result: FindMatch | null | undefined;
				let caught = false;
				try { result = last ? navigationSearch._findLastMatchInLine(searcher, 'ax x', 3, true) : navigationSearch._findFirstMatchInLine(searcher, 'ax x', 3, from as unknown as number, true); }
				catch (error) { assert.strictEqual(error, failure); caught = true; }
				return { result, caught, observations, state: state(target, regex) };
			};
			assert.deepStrictEqual(withRust(run), run());
		}
	}
});

test('Rust navigation preserves provider failure identity and rejects stale navigation registration', () => {
	const failure = new Error('Original navigation line provider failure');
	for (const previous of [true, false]) {
		const run = () => {
			const model = createTextModel('a\nb');
			const observations: number[] = [];
			model.getLineContent = line => { observations.push(line); if (observations.length === 2) { throw failure; } return ''; };
			try {
				const method = previous ? navigationSearch._doFindPreviousMatchLineByLine : navigationSearch._doFindNextMatchLineByLine;
				assert.throws(() => Reflect.apply(method, TextModelSearch, [model, new Position(2, 1), new Searcher(null, /x/g), false]), error => error === failure);
				return observations;
			} finally { model.dispose(); }
		};
		assert.deepStrictEqual(withRust(run), run());
	}
	assert.throws(() => registerRustTextBuffer({ ...rust, text_search_abi_version: () => 4 }), /searcher control contract/);
});

test('Rust range collection preserves restricted lines, multiline CRLF ranges, captures, and unusual limits', () => {
	const calls = [0, 0];
	const module: IRustTextSearchModule = { ...rust, collect_text_search_range: (host, operation, limit) => { calls[operation]++; return rust.collect_text_search_range(host, operation, limit); } };
	for (const eol of ['\n', '\r\n']) {
		for (const captures of [true, false]) {
			for (const pattern of ['x', '\\n', '(?:x|\\n)+', '(?:)']) {
				for (const limit of [-1, 0, 1, 2, 10, Number.NaN, '2', null, 1n]) {
					const run = () => {
						const model = createTextModel(['x x', 'x xx', 'x x'].join(eol));
						try {
							const params = new SearchParams(pattern, true, true, null);
							return [new Range(1, 2, 1, 4), new Range(1, 2, 3, 2), new Range(2, 1, 3, 4)].map(range => TextModelSearch.findMatches(model, params, range, captures, limit as number));
						} finally { model.dispose(); }
					};
					assert.deepStrictEqual(withRust(run, module), run());
				}
			}
		}
	}
	assert.ok(calls.every(count => count > 100), 'Both model-range collectors execute Rust');
});

test('Rust line range collection retains virtual collector lookup, range getters, and original result aliases', () => {
	const collection = TextModelSearch as unknown as { _doFindMatchesLineByLine(model: TextModel, range: Range, data: SearchData, captures: boolean, limit: number): FindMatch[] };
	for (const single of [true, false]) {
		for (const limit of [0, 1, 2, 10]) {
			const run = () => {
				const observations: string[] = [];
				const target = createTextModel('ax\nbx\ncx');
				const model = new Proxy(target, { get: (target, key, receiver) => { observations.push(`model:${String(key)}`); return Reflect.get(target, key, receiver); } });
				const range = new Proxy(new Range(1, 2, single ? 1 : 3, 3), { get: (target, key, receiver) => { observations.push(`range:${String(key)}`); return Reflect.get(target, key, receiver); } });
				let alias: FindMatch[] | undefined;
				const collector = (_data: SearchData, text: string, line: number, delta: number, count: number, result: FindMatch[], captures: boolean, limit: number) => {
					observations.push(`collect:${text}:${line}:${delta}:${count}:${captures}:${limit}`);
					alias ??= result;
					assert.strictEqual(result, alias);
					result.push(new FindMatch(new Range(line, 1, line, 2), null));
					return count + 1;
				};
				const owner = new Proxy(TextModelSearch, { get: (target, key, receiver) => { observations.push(`owner:${String(key)}`); return key === '_findMatchesInLine' ? collector : Reflect.get(target, key, receiver); } });
				try {
					const result = Reflect.apply(collection._doFindMatchesLineByLine, owner, [model, range, new SearchData(/x/g, null, null), true, limit]);
					return { result, identity: result === alias, observations };
				} finally { target.dispose(); }
			};
			assert.deepStrictEqual(withRust(run), run());
		}
	}
});

test('Rust range collection retains partial result arrays and original provider/factory failure ordering', () => {
	const collection = TextModelSearch as unknown as { _doFindMatchesLineByLine(model: TextModel, range: Range, data: SearchData, captures: boolean, limit: number): FindMatch[] };
	const failure = new Error('Original range collector failure');
	for (const mode of ['getter', 'collector', 'frozen']) {
		const run = () => {
			const observations: string[] = [];
			const model = createTextModel('x\nx\nx');
			const original = model.getLineContent;
			model.getLineContent = line => { observations.push(`line:${line}`); return Reflect.apply(original, model, [line]); };
			let alias: FindMatch[] | undefined;
			let lookups = 0;
			let calls = 0;
			const collector = (_data: SearchData, _text: string, line: number, _delta: number, count: number, result: FindMatch[]) => {
				observations.push(`collect:${line}`);
				alias ??= result;
				if (++calls === 2 && mode === 'collector') { throw failure; }
				result.push(new FindMatch(new Range(line, 1, line, 2), null));
				if (mode === 'frozen') { Object.freeze(result); }
				return count + 1;
			};
			const owner = new Proxy(TextModelSearch, {
				get: (target, key, receiver) => {
					if (key === '_findMatchesInLine') { observations.push('collector:get'); if (++lookups === 2 && mode === 'getter') { throw failure; } return collector; }
					return Reflect.get(target, key, receiver);
				}
			});
			try {
				assert.throws(() => Reflect.apply(collection._doFindMatchesLineByLine, owner, [model, model.getFullModelRange(), new SearchData(/x/g, null, null), false, 10]), error => mode === 'frozen' ? error instanceof TypeError : error === failure);
				return { alias, observations };
			} finally { model.dispose(); }
		};
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust multiline range collection preserves post-write limit coercion and scoped match observations', () => {
	const failure = new Error('Original multiline collection limit failure');
	const run = () => {
		const observations: string[] = [];
		const target = createTextModel('x\r\nx\r\nx');
		const model = new Proxy(target, { get: (target, key, receiver) => { observations.push(`model:${String(key)}`); return Reflect.get(target, key, receiver); } });
		const dynamicLimit = { [Symbol.toPrimitive]: (hint: string) => { observations.push(`limit:${hint}`); throw failure; } };
		const owner = new Proxy(TextModelSearch, { get: (target, key, receiver) => { observations.push(`owner:${String(key)}`); return Reflect.get(target, key, receiver); } });
		try {
			assert.throws(() => Reflect.apply(TextModelSearch.findMatches, owner, [model, new SearchParams('\\n', true, true, null), model.getFullModelRange(), true, dynamicLimit]), error => error === failure);
			return observations;
		} finally { target.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust search source classification preserves seeded escapes, LF, and borrowed UTF-16 syntax', () => {
	let seed = 937;
	let calls = 0;
	const module: IRustTextSearchModule = { ...rust, is_text_search_multiline_source: host => { calls++; return rust.is_text_search_multiline_source(host); } };
	const alphabet = ['\\', 'n', 'r', 'W', 'w', '[', ']', '\n', '\r', 'x', '\uD800', '\uD83D\uDE00'];
	for (let trace = 0; trace < 1024; trace++) {
		const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
		const source = Array.from({ length: random(40) }, () => alphabet[random(alphabet.length)]).join('');
		assert.strictEqual(withRust(() => isMultilineRegexSource(source), module), isMultilineRegexSource(source), JSON.stringify(source));
	}
	assert.strictEqual(calls, 1024, 'Source classification executes Rust');
});

test('Rust search source classification retains dynamic lengths, strict character values, and original failures', () => {
	const failure = new Error('Original search source character failure');
	for (const length of [0, 2, '2', null, undefined, Number.NaN]) {
		for (const character of [110, '110', 110n, Symbol('code')]) {
			const run = () => {
				const observations: string[] = [];
				const source = {
					get length() { observations.push('length'); return length; },
					get charCodeAt() { observations.push('method'); return (index: number) => { observations.push(`code:${index}`); return index === 0 ? 92 : character; }; }
				};
				const multiline = isMultilineRegexSource(source as unknown as string);
				return { multiline, observations };
			};
			assert.deepStrictEqual(withRust(run), run());
		}
	}
	const run = () => {
		const observations: string[] = [];
		const source = { get length() { observations.push('length'); return 2; }, charCodeAt: (index: number) => { observations.push(`code:${index}`); if (index === 1) { throw failure; } return 92; } };
		assert.throws(() => isMultilineRegexSource(source as unknown as string), error => error === failure);
		return observations;
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust FindMatch creation preserves capture holes, raw slot identity, range identity, and no-capture shortcuts', () => {
	const first = { marker: 'original capture identity' };
	let calls = 0;
	const module: IRustTextSearchModule = { ...rust, create_text_search_match: host => { calls++; return rust.create_text_search_match(host); } };
	for (const captures of [false, true]) {
		const run = () => {
			const observations: string[] = [];
			const raw = ['x', first, undefined, '\uD800'];
			Reflect.deleteProperty(raw, '2');
			const match = new Proxy(raw, { get: (target, key, receiver) => { observations.push(String(key)); return Reflect.get(target, key, receiver); } });
			const range = new Range(2, 3, 2, 4);
			const result = createFindMatch(range, match as unknown as RegExpExecArray, captures);
			return { result, observations, rangeIdentity: result.range === range, slotIdentity: result.matches?.[1] === first as unknown as string };
		};
		assert.deepStrictEqual(withRust(run, module), run());
	}
	assert.strictEqual(calls, 2, 'FindMatch creation executes Rust');
});

test('Rust FindMatch creation retains array-like length coercion, slot failures, and original exception identity', () => {
	const failure = new Error('Original capture slot failure');
	for (const length of [undefined, null, '2', 1n, Number.NaN, Symbol('length')]) {
		for (const captures of [false, true]) {
			const run = () => {
				const observations: string[] = [];
				const source = { length, 0: 'a', 1: 'b' };
				const match = new Proxy(source, { get: (target, key, receiver) => { observations.push(String(key)); return Reflect.get(target, key, receiver); } });
				let result: FindMatch | undefined;
				let error: string | undefined;
				try { result = createFindMatch(new Range(1, 1, 1, 2), match as unknown as RegExpExecArray, captures); }
				catch (failure) { error = failure instanceof Error ? failure.name : 'non-error'; }
				return { result, error, observations };
			};
			assert.deepStrictEqual(withRust(run), run());
		}
	}
	const run = () => {
		const observations: string[] = [];
		const length = { [Symbol.toPrimitive]: (hint: string) => { observations.push(`length:${hint}`); return 2; } };
		const source = { length, 0: 'a', get 1() { observations.push('slot:1'); throw failure; } };
		assert.throws(() => createFindMatch(new Range(1, 1, 1, 2), source as unknown as RegExpExecArray, true), error => error === failure);
		return observations;
	};
	assert.deepStrictEqual(withRust(run), run());
});

function searchDataSnapshot(data: SearchData | null): object | null {
	return data ? { source: data.regex.source, flags: data.regex.flags, simple: data.simpleSearch, words: data.wordSeparators } : null;
}

test('Rust SearchParams preserves request modes, invalid regex handling, ECMAScript casing, and cached word maps', () => {
	let calls = 0;
	const module: IRustTextSearchModule = { ...rust, parse_text_search_request: host => { calls++; return rust.parse_text_search_request(host); } };
	for (const source of ['', '_', 'Hello', '123', 'x\ny', '\\n', '[', '(?<word>x)', '\uD800', '\uD83D\uDE00', 'Straße', 'İ']) {
		for (const regex of [false, true]) {
			for (const matchCase of [false, true]) {
				for (const words of [null, '-_']) {
					const run = () => searchDataSnapshot(new SearchParams(source, regex, matchCase, words).parseSearchRequest());
					assert.deepStrictEqual(withRust(run, module), run());
				}
			}
		}
	}
	assert.strictEqual(calls, 96, 'SearchParams parsing executes Rust');
});

test('Rust SearchParams preserves repeated live field reads, changing source values, and proxy receivers', () => {
	for (const regex of [false, true]) {
		const run = () => {
			const observations: string[] = [];
			let reads = 0;
			const sources = ['Hello', 'x', '_', 'Straße'];
			const target = new SearchParams('x', regex, true, '-');
			const params = new Proxy(target, {
				get: (target, key, receiver) => {
					observations.push(String(key));
					if (key === 'searchString') { return sources[reads++ % sources.length]; }
					return Reflect.get(target, key, receiver);
				}
			});
			const data = params.parseSearchRequest();
			return { data: searchDataSnapshot(data), observations };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust SearchParams catches failures only within the original regex construction scope', () => {
	const failure = new Error('Original search request field failure');
	for (let failingRead = 1; failingRead <= 14; failingRead++) {
		const run = () => {
			const observations: string[] = [];
			let reads = 0;
			const params = new Proxy(new SearchParams('Hello', false, true, '-'), {
				get: (target, key, receiver) => {
					if (key !== 'parseSearchRequest') { observations.push(String(key)); if (++reads === failingRead) { throw failure; } }
					return Reflect.get(target, key, receiver);
				}
			});
			let data: SearchData | null | undefined;
			let caught = false;
			try { data = params.parseSearchRequest(); } catch (error) { assert.strictEqual(error, failure); caught = true; }
			return { data: data === undefined ? undefined : searchDataSnapshot(data), caught, observations };
		};
		assert.deepStrictEqual(withRust(run), run(), `Request field failure ${failingRead}`);
	}
});

test('Rust SearchParams preserves unusual runtime property values and original exception domains', () => {
	for (const field of ['searchString', 'isRegex', 'matchCase', 'wordSeparators']) {
		for (const value of [undefined, null, 0, 1, 'false', {}, Symbol('request value'), 0n]) {
			const run = () => {
				const params = new SearchParams('x', false, false, null);
				Object.defineProperty(params, field, { value });
				try { return { data: searchDataSnapshot(params.parseSearchRequest()) }; }
				catch (error) { return { error: error instanceof Error ? error.name : 'non-error' }; }
			};
			assert.deepStrictEqual(withRust(run), run());
		}
	}
});
