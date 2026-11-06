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
import { Selection } from '../../src/vs/editor/common/core/selection.js';
import { ITextBuffer } from '../../src/vs/editor/common/model.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { IRustModelValidationModule, registerRustModelValidation, RustModelValidationOperation, tryRustModelValidation } from '../../src/vs/editor/common/model/rustModelValidation.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }
interface IValidationModel {
	_buffer: ITextBuffer;
	_assertNotDisposed(): void;
	_isValidPosition(line: number, column: number, validationType: number): boolean;
	_validatePosition(line: number, column: number, validationType: number): Position;
	_isValidRange(range: Range, validationType: number): boolean;
}
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, core = false, module: IRustModelValidationModule = rust): T {
	const registration = core ? registerRustTextBuffer(rust) : registerRustModelValidation(module);
	try { return compute(); } finally { registration.dispose(); }
}

test('Rust model validation preserves seeded bounds, malformed coordinates, UTF-16 surrogates, and instance identity', () => {
	const values = [NaN, Infinity, -Infinity, -2, -0, 0.8, 1, 1.7, 2, 3, 4, 8, 0x7FFFFFFF, 0x80000000, '2', null, undefined, false, 2n, Symbol('coordinate'), {}];
	const lines = ['a\uD800\uDC00b', '\uD800x\uDC00', '', '\uD800'];
	let seed = 4271;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const cases = Array.from({ length: 512 }, () => Array.from({ length: 4 }, () => values[random(values.length)]));
	const run = () => {
		const model = createTextModel(lines.join('\n'));
		const internal = model as unknown as IValidationModel;
		try {
			return cases.map(values => {
				const range: IRange = { startLineNumber: values[0] as number, startColumn: values[1] as number, endLineNumber: values[2] as number, endColumn: values[3] as number };
				const position: IPosition = { lineNumber: values[0] as number, column: values[1] as number };
				const p = new Position(position.lineNumber, position.column);
				const r = new Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn);
				const selection = new Selection(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn);
				const validatedPosition = model.validatePosition(p);
				const validatedRange = model.validateRange(r);
				const relaxedRange = model._validateRangeRelaxedNoAllocations(r);
				return {
					plainPosition: model.validatePosition(position),
					instancePosition: validatedPosition,
					positionIdentity: validatedPosition === p,
					validPosition: [0, 1].map(type => internal._isValidPosition(position.lineNumber, position.column, type)),
					clampedPosition: [0, 1].map(type => internal._validatePosition(position.lineNumber, position.column, type)),
					plainRange: model.validateRange(range),
					instanceRange: validatedRange,
					rangeIdentity: validatedRange === r,
					relaxedRange, relaxedIdentity: relaxedRange === r,
					plainRelaxedRange: model._validateRangeRelaxedNoAllocations(range),
					selection: model.validateRange(selection),
					validRange: [0, 1].map(type => internal._isValidRange(r, type)),
					publicValidRange: model.isValidRange(r)
				};
			});
		} finally { model.dispose(); }
	};
	// Range/Selection constructors use relational coercion; primitive symbols are tested directly below.
	cases.forEach(values => values.forEach((value, index) => { if (typeof value === 'symbol') { values[index] = undefined; } }));
	const expected = run();
	assert.deepStrictEqual(withRust(run), expected);
	assert.deepStrictEqual(withRust(run, true), expected);
});

test('Rust validation retains provider, coordinate getter, and virtual helper ordering', () => {
	const run = () => {
		const observations: string[] = [];
		const target = createTextModel('a\uD800x\nb\uD800\uDC00c');
		const internal = target as unknown as IValidationModel;
		internal._buffer = new Proxy(internal._buffer, {
			get: (buffer, key, receiver) => {
				if (['getLineCount', 'getLineLength', 'getLineCharCode'].includes(String(key))) { observations.push('buffer:' + String(key)); }
				return Reflect.get(buffer, key, receiver);
			}
		});
		const model = new Proxy(target, {
			get: (owner, key, receiver) => {
				if (['getLineMaxColumn', '_isValidPosition', '_validatePosition', '_isValidRange', '_assertNotDisposed'].includes(String(key))) { observations.push('model:' + String(key)); }
				return Reflect.get(owner, key, receiver);
			}
		});
		const range = new Proxy({ startLineNumber: 1.9, startColumn: 3.4, endLineNumber: 2.2, endColumn: 3.5 }, {
			get: (value, key, receiver) => { observations.push('range:' + String(key)); return Reflect.get(value, key, receiver); }
		});
		const position = new Proxy(new Position(1, 3), {
			get: (value, key, receiver) => { observations.push('position:' + String(key)); return Reflect.get(value, key, receiver); }
		});
		try {
			const results = [model.validatePosition(position), model.validateRange(range), model._validateRangeRelaxedNoAllocations(range), model.isValidRange(new Range(1, 3, 2, 3))];
			return { results, observations };
		} finally { target.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust range validation honors overridden helpers, returned object getters, and asymmetric surrogate inspection', () => {
	for (const collapsed of [true, false]) {
		const run = () => {
			const observations: string[] = [];
			const model = createTextModel('a\uD800x\nb\uD800x');
			const internal = model as unknown as IValidationModel;
			internal._isValidRange = (range, type) => { observations.push('valid:' + type); return false; };
			internal._validatePosition = (line, column, type) => {
				observations.push('clamp:' + [line, column, type].join(','));
				return new Proxy(new Position(collapsed ? 1 : line, 3), {
					get: (value, key, receiver) => { observations.push('result:' + String(key)); return Reflect.get(value, key, receiver); }
				});
			};
			const charCode = internal._buffer.getLineCharCode;
			internal._buffer.getLineCharCode = (line, index) => { observations.push('char:' + [line, index].join(',')); return charCode.call(internal._buffer, line, index); };
			try { return { range: model.validateRange(new Range(1, 2, 2, 2)), observations }; } finally { model.dispose(); }
		};
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust validation preserves exceptions, disposed behavior, and scalar type rejection', () => {
	const failure = new Error('Original validation provider failure');
	const run = () => {
		const model = createTextModel('a\uD800x');
		const internal = model as unknown as IValidationModel;
		const results: object[] = [];
		try {
			for (const value of [null, undefined, Symbol('position'), 2n]) {
				try { results.push({ value: model.validatePosition(value as unknown as IPosition) }); }
				catch (error) { results.push({ error: error instanceof Error ? error.name : error }); }
			}
			internal._buffer.getLineCharCode = () => { throw failure; };
			assert.throws(() => model.validatePosition(new Position(1, 3)), error => error === failure);
			for (const value of [NaN, Infinity, 0x80000000, '1', null, Symbol('line')]) {
				results.push({ valid: internal._isValidPosition(value as number, 1, 1) });
			}
			model.dispose();
			for (const compute of [() => model.validatePosition(new Position(1, 1)), () => model.validateRange(new Range(1, 1, 1, 1))]) {
				try { compute(); } catch (error) { results.push({ error: error instanceof Error ? error.message : error }); }
			}
			return results;
		} finally { model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});


test('Rust validation captures methods before argument getters and retains provider coercion order', () => {
	const run = () => {
		const model = createTextModel('a\uD800x');
		const internal = model as unknown as IValidationModel;
		const observations: string[] = [];
		internal._validatePosition = (line, column) => { observations.push('original'); return new Position(line, column); };
		const position: IPosition = {
			get lineNumber() {
				observations.push('line');
				internal._validatePosition = (line, column) => { observations.push('replacement'); return new Position(line + 1, column); };
				return 1;
			},
			get column() { observations.push('column'); return 1; }
		};
		try {
			const first = model.validatePosition(position);
			const column = {
				[Symbol.toPrimitive]: (hint: string) => {
					observations.push('coerce:' + hint);
					internal._buffer.getLineCharCode = () => { observations.push('replacementCode'); return 0; };
					return 3;
				}
			};
			internal._buffer.getLineCharCode = () => { observations.push('originalCode'); return 0xD800; };
			internal._validatePosition = () => new Position(1, column as unknown as number);
			const second = model.validateRange({ startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 3 });
			internal._buffer.getLineCharCode = () => 0xD800;
			const types = [0, 1, NaN, 0x100000001, '1', null];
			const validity = types.map(type => internal._isValidPosition(1, 3, type as number));
			return { first, second: { startLine: second.startLineNumber, endLine: second.endLineNumber, startIdentity: second.startColumn === column as unknown as number, endIdentity: second.endColumn === column as unknown as number }, validity, observations };
		} finally { model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust model validation executes every integrated operation and rejects stale registration atomically', () => {
	const identity = {};
	const overridden = createTextModel('x');
	const internal = overridden as unknown as IValidationModel;
	internal._isValidRange = () => identity as boolean;
	internal._isValidPosition = () => identity as boolean;
	try {
		const position = new Position(999, 999);
		const range = new Range(999, 999, 999, 999);
		assert.strictEqual(withRust(() => overridden.isValidRange(range)), identity);
		assert.strictEqual(withRust(() => overridden.validateRange(range)), range);
		assert.strictEqual(withRust(() => overridden.validatePosition(position)), position);
	} finally { overridden.dispose(); }
	const calls = new Set<number>();
	const module: IRustModelValidationModule = {
		...rust,
		run_model_validation: (...args) => { calls.add(args[1]); return rust.run_model_validation(...args); }
	};
	withRust(() => {
		const model = createTextModel('a\uD800x');
		try {
			model.validatePosition(new Position(1, 3));
			model.validateRange(new Range(1, 3, 1, 3));
			model.isValidRange(new Range(1, 1, 1, 2));
			model._validateRangeRelaxedNoAllocations(new Range(0, 0, 2, 2));
		} finally { model.dispose(); }
	}, false, module);
	assert.deepStrictEqual([...calls].sort(), [0, 1, 2, 3, 4, 5, 6]);
	assert.throws(() => registerRustTextBuffer({ ...rust, model_validation_abi_version: () => 0 }), /coordinate contract/);
	assert.strictEqual(tryRustModelValidation(RustModelValidationOperation.Position, new Position(1, 1), 0, 1, () => { throw new Error('Unavailable validation must not observe its host'); }), undefined);
	const registration = registerRustModelValidation(rust);
	try { assert.throws(() => registerRustModelValidation(rust), /already registered/); } finally { registration.dispose(); }
});

