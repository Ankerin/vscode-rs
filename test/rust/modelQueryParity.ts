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
import { Range } from '../../src/vs/editor/common/core/range.js';
import { EndOfLinePreference, ITextBuffer, ITextSnapshot } from '../../src/vs/editor/common/model.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { IRustModelQueryModule, registerRustModelQuery, RustModelQueryOperation, tryRustModelQuery } from '../../src/vs/editor/common/model/rustModelQuery.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }
interface IQueryModel {
	_buffer: ITextBuffer;
	_validatePosition(line: number, column: number, type: number): Position;
}
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, core = false, module: IRustModelQueryModule = rust): T {
	const registration = core ? registerRustTextBuffer(rust) : registerRustModelQuery(module);
	try { return compute(); } finally { registration.dispose(); }
}

function readSnapshot(snapshot: ITextSnapshot): string[] {
	const values: string[] = [];
	let value: string | null;
	while ((value = snapshot.read()) !== null) { values.push(value); }
	return values;
}

test('Rust model reads preserve seeded text, BOM/EOL, line queries, offsets, snapshots, and version changes', () => {
	let seed = 8191;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const alphabet = ['x', ' ', '\t', '\uD800', '\uDC00', '\u05D0', '\u2028'];
	const texts = Array.from({ length: 128 }, (_, index) => (index % 3 ? '' : '\uFEFF') + Array.from({ length: 1 + random(8) }, () => Array.from({ length: random(24) }, () => alphabet[random(alphabet.length)]).join('')).join(index % 2 ? '\n' : '\r\n'));
	const run = () => texts.map(text => {
		const model = createTextModel(text);
		try {
			const range = new Range(0, 0, 999, 999);
			const positions = [new Position(0, 0), new Position(1.9, 3.8), new Position(999, 999)];
			const values = {
				value: [undefined, EndOfLinePreference.LF, EndOfLinePreference.CRLF].map(eol => [false, true].map(bom => [model.getValue(eol, bom), model.getValueLength(eol, bom), model.getValueInRange(range, eol), model.getValueLengthInRange(range, eol), model.getCharacterCountInRange(range, eol)])),
				lines: model.getLinesContent().map((text, index) => [text, model.getLineContent(index + 1), model.getLineLength(index + 1), model.getLineMinColumn(index + 1), model.getLineMaxColumn(index + 1), model.getLineFirstNonWhitespaceColumn(index + 1), model.getLineLastNonWhitespaceColumn(index + 1)]),
				eol: [model.getEOL(), model.getEndOfLineSequence()],
				fullRange: model.getFullModelRange(),
				positions: positions.map(position => [model.getOffsetAt(position), model.modifyPosition(position, -3), model.modifyPosition(position, 7)]),
				offsets: [-Infinity, -3, -0, 0.2, 2.8, 999, Infinity].map(offset => model.getPositionAt(offset)),
				snapshots: [readSnapshot(model.createSnapshot()), readSnapshot(model.createSnapshot(true))],
				flags: [model.mightContainRTL(), model.mightContainUnusualLineTerminators(), model.mightContainNonBasicASCII(), model.isDominatedByLongLines()],
				version: [model.getVersionId(), model.getAlternativeVersionId(), model.getInitialUndoRedoSnapshot()]
			};
			model.applyEdits([{ range: new Range(1, 1, 1, 1), text: 'z' }]);
			return { values, changed: [model.getVersionId(), model.getAlternativeVersionId(), model.getValue()] };
		} finally { model.dispose(); }
	});
	const expected = run();
	assert.deepStrictEqual(withRust(run), expected);
	assert.deepStrictEqual(withRust(run, true), expected);
});

test('Rust reads retain model/buffer method, argument getter, and call arity observations', () => {
	const run = () => {
		const observations: string[] = [];
		const target = createTextModel('\uFEFFa\uD800x\nb');
		const internal = target as unknown as IQueryModel;
		internal._buffer = new Proxy(internal._buffer, {
			get: (buffer, key, receiver) => {
				if (typeof key === 'string' && key.startsWith('get')) { observations.push('buffer:' + key); }
				return Reflect.get(buffer, key, receiver);
			}
		});
		const model = new Proxy(target, {
			get: (owner, key, receiver) => {
				if (['_assertNotDisposed', '_validatePosition', 'validateRange', 'getFullModelRange', 'getValueInRange', 'getValueLengthInRange', 'getLineCount', 'getLineMaxColumn', 'getOffsetAt', 'getPositionAt'].includes(String(key))) { observations.push('model:' + String(key)); }
				return Reflect.get(owner, key, receiver);
			}
		});
		const position = new Proxy(new Position(1, 3), {
			get: (value, key, receiver) => { observations.push('position:' + String(key)); return Reflect.get(value, key, receiver); }
		});
		try {
			const values = [model.getOffsetAt(position), model.getPositionAt(3), model.modifyPosition(position, 1), model.getValue(undefined, true), model.getValueLength(undefined, true), model.getValueInRange(new Range(1, 2, 2, 2)), model.getLineContent(1), model.getLineMaxColumn(1)];
			const original = target.getValueInRange;
			target.getValueInRange = (...args) => { observations.push('arity:' + args.length); return original.apply(target, args); };
			values.push(model.getValue());
			return { values, observations };
		} finally { target.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust reads retain captured providers when validation or argument getters replace methods', () => {
	const run = () => {
		const observations: string[] = [];
		const model = createTextModel('abc\ndef');
		const internal = model as unknown as IQueryModel;
		const original = internal._buffer.getValueInRange;
		internal._buffer.getValueInRange = (...args) => { observations.push('originalRange'); return original.apply(internal._buffer, args); };
		model.validateRange = range => {
			observations.push('validate');
			internal._buffer.getValueInRange = () => { observations.push('replacementRange'); return 'replacement'; };
			return Range.lift(range);
		};
		internal._validatePosition = (line, column) => { observations.push('originalPosition'); return new Position(line, column); };
		const position: IPosition = {
			get lineNumber() { observations.push('line'); internal._validatePosition = () => { observations.push('replacementPosition'); return new Position(2, 1); }; return 1; },
			get column() { observations.push('column'); return 2; }
		};
		try { return { value: model.getValueInRange(new Range(1, 1, 1, 3)), offset: model.getOffsetAt(position), observations }; } finally { model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust reads preserve heap/line failures, coercions, NaN offsets, and disposed shortcuts', () => {
	const failure = new Error('Original model read failure');
	const run = () => {
		const model = createTextModel('abc\ndef');
		const internal = model as unknown as IQueryModel;
		const observations: string[] = [];
		const attempt = (compute: () => object | number | string | boolean) => {
			try { return { value: compute() }; } catch (error) { return { error: error instanceof Error ? [error.name, error.message] : error }; }
		};
		try {
			const lines = [0, -1, 3, NaN, 1.5, '1', null, undefined];
			const lineResults = lines.map(line => attempt(() => model.getLineContent(line as number)));
			const offset = { [Symbol.toPrimitive]: (hint: string) => { observations.push(hint); return 2; } };
			const offsets = [attempt(() => model.getPositionAt(NaN)), attempt(() => model.getPositionAt(offset as unknown as number)), attempt(() => model.getPositionAt(2n as unknown as number))];
			internal._buffer.getLineContent = () => { throw failure; };
			assert.throws(() => model.getLineContent(1), error => error === failure);
			model.isTooLargeForHeapOperation = () => true;
			const heap = [attempt(() => model.getValue()), attempt(() => model.getLinesContent()), model.getValueLength()];
			model.dispose();
			const disposed = [attempt(() => model.getLineCount()), attempt(() => model.getLineMinColumn(0)), attempt(() => model.getValue())];
			return { lineResults, offsets, heap, disposed, observations };
		} finally { model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust reads preserve original aliased results and long-line thresholds', () => {
	const run = () => {
		const model = createTextModel('x'.repeat(10000) + '\nsmall');
		const internal = model as unknown as IQueryModel;
		const lines = ['aliased'];
		internal._buffer.getLinesContent = () => lines;
		const value = model.getLinesContent();
		const dominated = model.isDominatedByLongLines();
		model.isTooLargeForTokenization = () => true;
		try { return { identity: value === lines, dominated, large: model.isDominatedByLongLines(), minColumn: model.getLineMinColumn(-99) }; } finally { model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust reads execute all integrated operations and reject stale core registration atomically', () => {
	const calls = new Set<number>();
	const module: IRustModelQueryModule = { ...rust, run_model_query: (...args) => { calls.add(args[1]); return rust.run_model_query(...args); } };
	withRust(() => {
		const model = createTextModel('abc');
		try {
			model.getOffsetAt(new Position(1, 1)); model.getPositionAt(1);
			model.getValue(); model.getValueLength(); model.getValueInRange(new Range(1, 1, 1, 2)); model.getValueLengthInRange(new Range(1, 1, 1, 2)); model.getCharacterCountInRange(new Range(1, 1, 1, 2));
			model.getLineCount(); model.getLineContent(1); model.getLineLength(1); model.getLinesContent(); model.getEOL(); model.getEndOfLineSequence(); model.getLineMinColumn(1); model.getLineMaxColumn(1); model.getLineFirstNonWhitespaceColumn(1); model.getLineLastNonWhitespaceColumn(1);
			model.modifyPosition(new Position(1, 1), 1); model.getFullModelRange(); model.isDominatedByLongLines(); readSnapshot(model.createSnapshot());
			model.getVersionId(); model.getAlternativeVersionId(); model.getInitialUndoRedoSnapshot(); model.mightContainRTL(); model.mightContainUnusualLineTerminators(); model.mightContainNonBasicASCII();
		} finally { model.dispose(); }
	}, false, module);
	assert.deepStrictEqual([...calls].sort((first, second) => first - second), Array.from({ length: 27 }, (_, index) => index));
	assert.throws(() => registerRustTextBuffer({ ...rust, model_query_abi_version: () => 0 }), /reading contract/);
	assert.strictEqual(tryRustModelQuery(RustModelQueryOperation.LineCount, 0, 0, false, () => { throw new Error('Unavailable reads must not create a host'); }), undefined);
	const registration = registerRustModelQuery(rust);
	try { assert.throws(() => registerRustModelQuery(rust), /already registered/); } finally { registration.dispose(); }
});

