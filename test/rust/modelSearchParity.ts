/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { IPosition, Position } from '../../src/vs/editor/common/core/position.js';
import { IRange, Range } from '../../src/vs/editor/common/core/range.js';
import { FindMatch, SearchData } from '../../src/vs/editor/common/model.js';
import { SearchParams, TextModelSearch } from '../../src/vs/editor/common/model/textModelSearch.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { IRustModelSearchModule, registerRustModelSearch, RustModelSearchOperation, tryRustModelSearch } from '../../src/vs/editor/common/model/rustModelSearch.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }
interface ISearchModel { findMatchesLineByLine(range: Range, data: SearchData, capture: boolean, limit: number): FindMatch[] }
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, core = false, module: IRustModelSearchModule = rust): T {
	const registration = core ? registerRustTextBuffer(rust) : registerRustModelSearch(module);
	try { return compute(); } finally { registration.dispose(); }
}

function outcome(compute: () => FindMatch[] | FindMatch | null): object | null {
	try {
		const value = compute();
		const snapshot = (match: FindMatch) => ({ range: { ...match.range }, matches: match.matches });
		return Array.isArray(value) ? value.map(snapshot) : value === null ? null : snapshot(value);
	} catch (error) {
		if (!(error instanceof Error)) { throw error; }
		return { error: error.name, message: error.message };
	}
}

test('Rust public model search preserves seeded scopes, navigation, captures, limits, and edits', () => {
	let seed = 87821;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const fixtures = Array.from({ length: 128 }, () => ({
		text: Array.from({ length: 1 + random(12) }, () => ['Alpha beta', 'alpha 😀 ALPHA', '', '\t(a) [b]', 'é a', 'beta'][random(6)]).join(random(2) ? '\r\n' : '\n'),
		ranges: Array.from({ length: 1 + random(5) }, () => new Range(random(15) - 2, random(25) - 2, random(15) - 2, random(25) - 2)),
		start: new Position(random(15) - 2, random(25) - 2),
		limit: random(6)
	}));
	const run = () => fixtures.map(fixture => {
		const model = createTextModel(fixture.text);
		try {
			const scopes = [null, true, false, fixture.ranges, fixture.ranges[0], [], [undefined as unknown as IRange]];
			const results = ['a', 'alpha', '(a)(l)', 'a\nb', '['].flatMap((source, index) => scopes.map(scope => outcome(() => model.findMatches(source, scope, index > 1, index % 2 === 0, index % 3 === 0 ? ' []()\t' : null, true, fixture.limit))));
			model.applyEdits([{ range: new Range(1, 1, 1, 1), text: 'alpha\n' }]);
			const navigation = ['alpha', '(a)', 'a\nb', '[', ''].flatMap((source, index) => [
				outcome(() => model.findNextMatch(source, fixture.start, index > 0, false, ' []()\t', true)),
				outcome(() => model.findPreviousMatch(source, fixture.start, index > 0, false, ' []()\t', true))
			]);
			return { results, navigation };
		} finally { model.dispose(); }
	});
	const expected = run();
	assert.deepStrictEqual(withRust(run), expected);
	assert.deepStrictEqual(withRust(run, true), expected);
});

test('Rust scope processing preserves sparse arrays, species, overridden methods, and getter traces', () => {
	const run = () => {
		const model = createTextModel('alpha\nalpha\nalpha');
		const trace: string[] = [];
		class Scopes extends Array<IRange> {
			override every<S extends IRange>(predicate: (value: IRange, index: number, array: IRange[]) => value is S): this is S[];
			override every(predicate: (value: IRange, index: number, array: IRange[]) => unknown): boolean;
			override every(predicate: (value: IRange, index: number, array: IRange[]) => unknown): boolean {
				trace.push('every');
				super.every(predicate);
				const opaque = {};
				return opaque as boolean;
			}
			override map<U>(callback: (value: IRange, index: number, array: IRange[]) => U): U[] {
				trace.push('map');
				return super.map(callback);
			}
		}
		const scopes = new Scopes(3);
		const range = new Range(1, 1, 2, 3);
		scopes[0] = new Proxy(range, { get: (value, key, receiver) => { trace.push('range:' + String(key)); return Reflect.get(value, key, receiver); } });
		scopes[2] = new Range(2, 2, 3, 6);
		const validate = model.validateRange;
		model.validateRange = value => { trace.push('validate'); return validate.call(model, value); };
		try {
			return { result: outcome(() => model.findMatches('alpha', scopes, false, true, null, false)), trace, holes: Object.keys(scopes) };
		} finally { model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust merging retains overridden range identities, truthiness, and comparator coercion order', () => {
	const intersects = Range.areIntersecting;
	const run = () => {
		const model = createTextModel('alpha\nalpha\nalpha');
		const trace: string[] = [];
		const internal = model as unknown as ISearchModel;
		const inputs = [new Range(2, 1, 3, 6), new Range(1, 1, 2, 4)];
		const ranges = inputs.map((range, index) => new Proxy(range, {
			get: (value, key, receiver) => {
				trace.push(index + ':' + String(key));
				if (key === 'startLineNumber') { return { valueOf: () => { trace.push(index + ':coerce'); return value.startLineNumber; } }; }
				return Reflect.get(value, key, receiver);
			}
		}));
		model.validateRange = value => value as Range;
		const combined = new Range(1, 1, 3, 6);
		inputs[1].plusRange = () => { trace.push('plus'); return combined; };
		const opaque = {};
		Range.areIntersecting = () => { trace.push('intersects'); return opaque as boolean; };
		internal.findMatchesLineByLine = range => { trace.push(range === combined ? 'combined' : 'original'); return [new FindMatch(range, null)]; };
		try { return { result: outcome(() => model.findMatches('alpha', ranges, false, true, null, false)), trace }; }
		finally { Range.areIntersecting = intersects; model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust forward navigation retains the discarded provider call and its original failure', () => {
	const next = TextModelSearch.findNextMatch;
	const failure = new Error('Original discarded search failure');
	const run = () => {
		const model = createTextModel('alpha');
		const internal = model as unknown as ISearchModel;
		const trace: string[] = [];
		const matches = new Proxy([new FindMatch(new Range(1, 1, 1, 6), null)], { get: (value, key, receiver) => { trace.push('result:' + String(key)); return Reflect.get(value, key, receiver); } });
		internal.findMatchesLineByLine = () => { trace.push('line'); return matches; };
		TextModelSearch.findNextMatch = () => { trace.push('next'); throw failure; };
		try { assert.throws(() => model.findNextMatch('alpha', new Position(1, 1), false, false, '', false), error => error === failure); return trace; }
		finally { TextModelSearch.findNextMatch = next; model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust wrapped navigation captures max-column methods before start-coordinate getters', () => {
	const next = TextModelSearch.findNextMatch;
	const run = () => {
		const target = createTextModel('alpha\nalpha');
		const trace: string[] = [];
		const model = new Proxy(target, { get: (value, key, receiver) => { if (['_assertNotDisposed', 'validatePosition', 'getLineCount', 'getLineMaxColumn', 'findMatchesLineByLine'].includes(String(key))) { trace.push('model:' + String(key)); } return Reflect.get(value, key, receiver); } });
		const start = new Proxy(new Position(1, 3), { get: (value, key, receiver) => { trace.push('start:' + String(key)); return Reflect.get(value, key, receiver); } });
		model.validatePosition = () => start;
		let count = 0;
		(target as unknown as ISearchModel).findMatchesLineByLine = range => { trace.push('line'); return count++ === 0 ? [] : [new FindMatch(range, null)]; };
		TextModelSearch.findNextMatch = () => { trace.push('next'); return null; };
		const rawStart = {};
		try { return { result: outcome(() => model.findNextMatch('alpha', rawStart as IPosition, false, false, '', false)), trace }; }
		finally { TextModelSearch.findNextMatch = next; target.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust model search preserves request short circuits, disposal, and original parse failures', () => {
	const parse = SearchParams.prototype.parseSearchRequest;
	const failure = new Error('Original parse failure');
	const run = () => {
		const model = createTextModel('alpha');
		try {
			SearchParams.prototype.parseSearchRequest = () => { throw failure; };
			assert.throws(() => model.findMatches('alpha', null, false, false, null, false), error => error === failure);
			assert.throws(() => model.findNextMatch('alpha', new Position(1, 1), false, false, '', false), error => error === failure);
			model.dispose();
			return [outcome(() => model.findMatches('', [], false, false, null, false)), outcome(() => model.findPreviousMatch('a', new Position(1, 1), false, false, '', false))];
		} finally { SearchParams.prototype.parseSearchRequest = parse; model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust model search executes every public operation and rolls back stale core registration', () => {
	const calls = new Set<number>();
	const module: IRustModelSearchModule = { ...rust, run_model_search: (...args) => { calls.add(args[1]); return rust.run_model_search(...args); } };
	withRust(() => {
		const model = createTextModel('alpha');
		try { model.findMatches('a', null, false, false, null, false); model.findNextMatch('a', new Position(1, 1), false, false, '', false); model.findPreviousMatch('a', new Position(1, 1), false, false, '', false); }
		finally { model.dispose(); }
	}, false, module);
	assert.deepStrictEqual([...calls].sort(), [0, 1, 2]);
	assert.throws(() => registerRustTextBuffer({ ...rust, model_search_abi_version: () => 0 }), /scope contract/);
	assert.strictEqual(tryRustModelSearch(RustModelSearchOperation.Next, null, () => { throw new Error('Unavailable search must not create a host'); }), undefined);
	const registration = registerRustModelSearch(rust);
	try { assert.throws(() => registerRustModelSearch(rust), /already registered/); } finally { registration.dispose(); }
});
