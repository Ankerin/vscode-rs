/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { IRange, Range } from '../../src/vs/editor/common/core/range.js';
import { IIdentifiedSingleEditOperation, ValidAnnotatedEditOperation } from '../../src/vs/editor/common/model.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { IRustModelEditValidationModule, registerRustModelEditValidation, RustModelEditValidationOperation, tryRustModelEditValidation } from '../../src/vs/editor/common/model/rustModelEditValidation.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }
interface IValidationModel {
	_validateEditOperation(operation: IIdentifiedSingleEditOperation): ValidAnnotatedEditOperation;
	_validateEditOperations(operations: readonly IIdentifiedSingleEditOperation[]): ValidAnnotatedEditOperation[];
}
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, core = false, module: IRustModelEditValidationModule = rust): T {
	const registration = core ? registerRustTextBuffer(rust) : registerRustModelEditValidation(module);
	try { return compute(); } finally { registration.dispose(); }
}

test('Rust edit validation preserves seeded ranges, CRLF normalization, flags, and UTF-16 text', () => {
	let seed = 391;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const texts = [null, '', '\r', 'x\r', 'x\r\n', '\n', '\uD800\r', '\uDC00', 'x'];
	const fixtures = Array.from({ length: 512 }, () => ({ range: new Range(random(5), random(9), random(5), random(9)), text: texts[random(texts.length)], forceMoveMarkers: !!random(2), isAutoWhitespaceEdit: !!random(2), _isTracked: !!random(2) }));
	const run = () => ['\n', '\r\n'].map(eol => {
		const model = createTextModel('abc' + eol + 'xy' + eol);
		try { return (model as unknown as IValidationModel)._validateEditOperations(fixtures).map(value => ({ ...value })); }
		finally { model.dispose(); }
	});
	const expected = run();
	assert.deepStrictEqual(withRust(run), expected);
	assert.deepStrictEqual(withRust(run, true), expected);
});

test('Rust edit validation retains annotated identity without observing operation getters', () => {
	const run = () => {
		const model = createTextModel('abc');
		const operation = new ValidAnnotatedEditOperation(null, new Range(1, 1, 1, 2), '\r', true, false, false);
		Object.defineProperty(operation, 'range', { get: () => { throw new Error('Annotated range must not be read'); } });
		try { return (model as unknown as IValidationModel)._validateEditOperation(operation) === operation; }
		finally { model.dispose(); }
	};
	assert.strictEqual(withRust(run), run());
	assert.strictEqual(withRust(run, true), true);
});

test('Rust edit validation retains live text lengths, method capture, receivers, and raw flag identity', () => {
	const run = () => {
		const model = createTextModel('abc\r\n');
		const trace: string[] = [];
		const range = new Range(1, 1, 1, 4);
		const observedRange = new Proxy(range, { get: (target, key, receiver) => { trace.push('range:' + String(key)); return Reflect.get(target, key, receiver); } });
		let reads = 0;
		const text = {
			get length() { trace.push('length'); return ++reads === 1 ? 5 : 2; },
			get charCodeAt() { trace.push('char:method'); return function (this: object, index: number) { trace.push('char:' + index + ':' + (this === text)); return 13; }; },
			get substring() { trace.push('substring:method'); return function (this: object, start: number, end: number) { trace.push('substring:' + start + ':' + end + ':' + (this === text)); return 'normalized'; }; }
		};
		Object.defineProperty(model, 'validateRange', { configurable: true, get: () => { trace.push('validate:method'); return function (this: object, input: IRange) { trace.push('validate:' + (this === model) + ':' + (input === range)); return observedRange; }; } });
		Object.defineProperty(model, 'getLineMaxColumn', { configurable: true, get: () => { trace.push('max:method'); return function (this: object, line: number) { trace.push('max:' + line + ':' + (this === model)); return 4; }; } });
		Object.defineProperty(model, 'getEOL', { configurable: true, get: () => { trace.push('eol:method'); return () => { trace.push('eol'); return '\r\n'; }; } });
		const opaque = {};
		const identifier = { major: 1, minor: 2 };
		const raw: IIdentifiedSingleEditOperation = { range, text: text as unknown as string, identifier, forceMoveMarkers: opaque as boolean, isAutoWhitespaceEdit: '' as unknown as boolean, _isTracked: opaque as boolean };
		const operation = new Proxy(raw, {
			get: (target, key, receiver) => {
				trace.push('operation:' + String(key));
				if (key === 'range') { Object.defineProperty(model, 'validateRange', { configurable: true, value: () => { throw new Error('Later method must not run'); } }); }
				return Reflect.get(target, key, receiver);
			}
		});
		try {
			const result = (model as unknown as IValidationModel)._validateEditOperation(operation);
			return { trace, text: result.text, range: result.range === observedRange, identifier: result.identifier === identifier, flags: [result.forceMoveMarkers === opaque, result.isAutoWhitespaceEdit, result._isTracked === opaque] };
		} finally { model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust edit validation preserves coercing and exceptional runtime length behavior', () => {
	const values = [0, -1, NaN, '2', null, undefined, 2n, Symbol('length')];
	const run = () => values.map(length => {
		const model = createTextModel('abc\r\n');
		const trace: string[] = [];
		const text = { get length() { trace.push('length'); return length; }, charCodeAt: (index: number) => { trace.push('char:' + index); return 13; }, substring: (start: number, end: number) => { trace.push('slice:' + start + ':' + end); return 'x'; } };
		try {
			try { const result = (model as unknown as IValidationModel)._validateEditOperation({ range: new Range(1, 1, 1, 4), text: text as unknown as string }); return { trace, retained: result.text === text, text: typeof result.text === 'string' ? result.text : null }; }
			catch (error) { return { trace, error: error instanceof Error ? error.name : String(error) }; }
		} finally { model.dispose(); }
	});
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust edit validation propagates original getter and normalization failure identities', () => {
	const stages = ['range', 'text', 'identifier', 'forceMoveMarkers', 'isAutoWhitespaceEdit', '_isTracked', 'length', 'charCodeAt', 'substring', 'getEOL', 'getLineMaxColumn'];
	const run = () => stages.map(stage => {
		const model = createTextModel('abc\r\n');
		const failure = {};
		const text = { length: 2, charCodeAt: () => 13, substring: () => 'x' };
		const operation = { range: new Range(1, 1, 1, 4), text: text as unknown as string };
		Object.defineProperty(['getEOL', 'getLineMaxColumn'].includes(stage) ? model : ['length', 'charCodeAt', 'substring'].includes(stage) ? text : operation, stage, { configurable: true, get: () => { throw failure; } });
		try { try { (model as unknown as IValidationModel)._validateEditOperation(operation); return false; } catch (error) { return error === failure; } }
		finally { model.dispose(); }
	});
	assert.deepStrictEqual(withRust(run), stages.map(() => true));
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust edit batches capture virtual validation before input getters and retain initial length', () => {
	const run = () => {
		const model = createTextModel('');
		const internal = model as unknown as IValidationModel;
		const trace: string[] = [];
		const result = new ValidAnnotatedEditOperation(null, new Range(1, 1, 1, 1), null, false, false, false);
		const input: IIdentifiedSingleEditOperation[] = [{ range: result.range, text: 'a' }, { range: result.range, text: 'b' }];
		Object.defineProperty(internal, '_validateEditOperation', { configurable: true, get: () => { trace.push('method'); return function (this: object) { trace.push('validate:' + (this === model)); return result; }; } });
		const operations = new Proxy(input, {
			get: (target, key, receiver) => {
				trace.push('input:' + String(key));
				if (key === '0') { Object.defineProperty(internal, '_validateEditOperation', { configurable: true, value: () => { trace.push('replacement'); return result; } }); target.push({ range: result.range, text: 'c' }); }
				return Reflect.get(target, key, receiver);
			}
		});
		try { return { identities: internal._validateEditOperations(operations).map(value => value === result), trace }; }
		finally { model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust validated edit fields retain aliases, descriptors, and held values after unregistration', () => {
	const range = new Range(1, 1, 1, 2);
	const identifier = { major: 1, minor: 2 };
	const held = withRust(() => {
		const baseline = rust.bracket_node_metadata_live_count();
		const operation = new ValidAnnotatedEditOperation(identifier, range, '\uD800', true, false, false);
		assert.deepStrictEqual([rust.bracket_node_metadata_live_count(), operation.identifier === identifier, operation.range === range], [baseline + 1, true, true]);
		assert.deepStrictEqual(Object.getOwnPropertyDescriptor(operation, 'text'), { value: '\uD800', writable: true, enumerable: true, configurable: true });
		return operation;
	}, true);
	assert.strictEqual(held.range, range);
	Reflect.set(held, 'text', 'changed');
	Object.freeze(held);
	assert.deepStrictEqual({ ...held }, { identifier, range, text: 'changed', forceMoveMarkers: true, isAutoWhitespaceEdit: false, _isTracked: false });
	assert.deepStrictEqual(Object.getOwnPropertyDescriptor(held, 'range'), { value: range, writable: false, enumerable: true, configurable: false });
});

function cyclicEdit(): WeakRef<object>[] {
	const identifier = { major: 1, minor: 1, owner: null as ValidAnnotatedEditOperation | null };
	const operation = new ValidAnnotatedEditOperation(identifier, new Range(1, 1, 1, 1), null, false, false, false);
	identifier.owner = operation;
	return [new WeakRef(operation), new WeakRef(identifier)];
}
test('Rust validated edit reference cycles stay collector visible', async () => {
	const registration = registerRustTextBuffer(rust);
	try {
		for (let attempt = 0; attempt < 8; attempt++) { await setTimeout(0); globalThis.gc?.(); }
		await setTimeout(0);
		const baseline = rust.bracket_node_metadata_live_count();
		const references = cyclicEdit();
		for (let attempt = 0; attempt < 64; attempt++) {
			await setTimeout(0); globalThis.gc?.();
			if (references.every(reference => reference.deref() === undefined) && rust.bracket_node_metadata_live_count() === baseline) { return; }
		}
		assert.deepStrictEqual([references.map(reference => reference.deref() === undefined), rust.bracket_node_metadata_live_count()], [[true, true], baseline]);
	} finally { registration.dispose(); }
});

test('Rust edit validation executes both operations and rolls back stale registration', () => {
	const calls = new Set<number>();
	const module: IRustModelEditValidationModule = { ...rust, run_model_edit_validation: (...args) => { calls.add(args[1]); return rust.run_model_edit_validation(...args); } };
	withRust(() => {
		const model = createTextModel('');
		try { (model as unknown as IValidationModel)._validateEditOperations([{ range: new Range(1, 1, 1, 1), text: 'x' }]); }
		finally { model.dispose(); }
	}, false, module);
	assert.deepStrictEqual([...calls].sort(), [0, 1]);
	assert.throws(() => registerRustTextBuffer({ ...rust, model_edit_validation_abi_version: () => 0 }), /operation contract/);
	assert.strictEqual(tryRustModelEditValidation(RustModelEditValidationOperation.Single, { range: new Range(1, 1, 1, 1), text: null }, () => { throw new Error('Unavailable validation must not create a host'); }), undefined);
	const registration = registerRustModelEditValidation(rust);
	try { assert.throws(() => registerRustModelEditValidation(rust), /already registered/); }
	finally { registration.dispose(); }
});
