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
import { Range } from '../../src/vs/editor/common/core/range.js';
import { Selection } from '../../src/vs/editor/common/core/selection.js';
import { ICursorStateComputer, ValidAnnotatedEditOperation } from '../../src/vs/editor/common/model.js';
import { TextModelEditSource } from '../../src/vs/editor/common/textModelEditSource.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { IRustModelEditingModule, ownRustPreparedModelEdit, registerRustModelEditing } from '../../src/vs/editor/common/model/rustModelEditing.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }
interface IPreparationModel {
	_trimAutoWhitespaceLines: number[] | null;
	_commandManager: object;
	_options: { trimAutoWhitespace: boolean };
	_pushEditOperations(before: Selection[] | null, edits: ValidAnnotatedEditOperation[], cursor: ICursorStateComputer | null, group?: Parameters<ReturnType<typeof createTextModel>['pushEditOperations']>[3], reason?: TextModelEditSource): Selection[] | null;
}
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, core = false, module: IRustModelEditingModule = rust): T {
	const registration = core ? registerRustTextBuffer(rust) : registerRustModelEditing(module);
	try { return compute(); } finally { registration.dispose(); }
}
function edit(range: Range, text: string | null): ValidAnnotatedEditOperation {
	return new ValidAnnotatedEditOperation(null, range, text, false, false, false);
}

test('Rust edit preparation preserves seeded cursor proximity, whitespace conflicts, and newline exceptions', () => {
	let seed = 7581;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const texts = [null, '', 'a', '\n', 'a\n', '\na', '\r\n', '\uD800\n', '  '];
	const fixtures = Array.from({ length: 512 }, () => ({ trim: !!random(2), candidates: Array.from({ length: random(4) }, () => random(5) + 1), cursor: random(4), operations: Array.from({ length: random(4) }, () => ({ first: random(5) + 1, last: random(5) + 1, column: random(6) + 1, text: texts[random(texts.length)] })) }));
	const run = () => fixtures.map(fixture => {
		const model = createTextModel('abc\n   \ndef\n\ntail');
		const internal = model as unknown as IPreparationModel;
		const manager = internal._commandManager;
		const result = [new Selection(1, 1, 1, 1)];
		let identities: boolean[] = [];
		internal._commandManager = { pushEditOperation: (before: Selection[] | null, operations: ValidAnnotatedEditOperation[]) => { identities = operations.slice(0, inputs.length).map((operation, index) => operation === inputs[index]); return result; } };
		internal._options.trimAutoWhitespace = fixture.trim;
		internal._trimAutoWhitespaceLines = fixture.candidates;
		const inputs = fixture.operations.map(operation => edit(model.validateRange(new Range(operation.first, operation.column, operation.last, operation.column)), operation.text));
		const operations = inputs.slice();
		const before = fixture.cursor === 0 ? null : fixture.cursor === 1 ? [] : [new Selection(fixture.cursor, 1, fixture.cursor, 1)];
		try {
			const returned = internal._pushEditOperations(before, operations, null);
			return { operations: operations.map(operation => ({ ...operation })), identities, returned: returned === result, candidates: internal._trimAutoWhitespaceLines };
		} finally { internal._commandManager = manager; model.dispose(); }
	});
	const expected = run();
	assert.deepStrictEqual(withRust(run), expected);
	assert.deepStrictEqual(withRust(run, true), expected);
});

test('Rust preparation preserves option, live trim array, mapping, range, and append getter order', () => {
	const run = () => {
		const trace: string[] = [];
		const model = createTextModel('abc\n   ');
		const internal = model as unknown as IPreparationModel;
		const manager = internal._commandManager;
		internal._commandManager = { pushEditOperation: () => { trace.push('command'); return null; } };
		let reads = 0;
		Object.defineProperty(internal, '_trimAutoWhitespaceLines', { configurable: true, get: () => { trace.push('trim:get'); return ++reads < 3 ? [1, 2] : [2, 1]; }, set: value => trace.push('trim:set:' + value) });
		const ops = [edit(new Range(2, 4, 2, 4), '\n')];
		const originalMap = ops.map;
		Object.defineProperty(ops, 'map', { get: () => { trace.push('map:method'); return function (this: ValidAnnotatedEditOperation[], callback: (operation: ValidAnnotatedEditOperation) => { range: Range; text: string | null }) { trace.push('map:' + (this === ops)); return Reflect.apply(originalMap, this, [callback]); }; } });
		const originalPush = ops.push;
		Object.defineProperty(ops, 'push', { get: () => { trace.push('push:method'); return function (this: ValidAnnotatedEditOperation[], operation: ValidAnnotatedEditOperation) { trace.push('push:' + (this === ops)); return Reflect.apply(originalPush, this, [operation]); }; } });
		const validated = model.validateRange;
		Object.defineProperty(model, 'validateRange', { configurable: true, get: () => { trace.push('validate:method'); return function (this: object, range: Range) { trace.push('validate:' + (this === model)); return Reflect.apply(validated, model, [range]); }; } });
		Object.defineProperty(ops[0], 'range', { configurable: true, get: () => { trace.push('range'); return new Range(2, 4, 2, 4); } });
		try { internal._pushEditOperations(null, ops, null); return { trace, operations: ops.map(operation => ({ ...operation })) }; }
		finally { internal._commandManager = manager; model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust preparation retains relational coercion order and conflict short circuits', () => {
	const run = () => [1, 2, 4].map(number => {
		const trace: string[] = [];
		const model = createTextModel('abc');
		const internal = model as unknown as IPreparationModel;
		const manager = internal._commandManager;
		internal._commandManager = { pushEditOperation: () => null };
		const value = (name: string, value: number) => { const result = { [Symbol.toPrimitive]: () => { trace.push(name); return value; } }; return result as unknown as number; };
		internal._trimAutoWhitespaceLines = [value('line', number)];
		const range = new Range(1, 1, 1, 1);
		Reflect.set(range, 'startLineNumber', value('start', 2));
		Reflect.set(range, 'endLineNumber', value('end', 3));
		model.validateRange = () => range;
		model.getLineMaxColumn = () => 4;
		const operations = [edit(range, null)];
		try { internal._pushEditOperations(null, operations, null); return { trace, length: operations.length, candidates: internal._trimAutoWhitespaceLines }; }
		finally { internal._commandManager = manager; model.dispose(); }
	});
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust newline preparation captures charAt before repeated length reads and retains text receivers', () => {
	const run = () => {
		const trace: string[] = [];
		const model = createTextModel('   ');
		const internal = model as unknown as IPreparationModel;
		const manager = internal._commandManager;
		internal._commandManager = { pushEditOperation: () => null };
		internal._trimAutoWhitespaceLines = [1];
		const method = function (this: object, index: number) { trace.push('char:' + index + ':' + (this === text)); return '\n'; };
		Object.defineProperty(method, 'call', { get: () => { throw new Error('Direct invocation must not observe call'); } });
		const text = { get length() { trace.push('length'); return 2; }, get charAt() { trace.push('char:method'); return method; } };
		const operations = [edit(new Range(1, 1, 1, 1), text as unknown as string)];
		try { internal._pushEditOperations(null, operations, null); return { trace, length: operations.length, retained: operations[0].text === text }; }
		finally { internal._commandManager = manager; model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust preparation retains original failures and partial candidate state', () => {
	const stages = ['map', 'max', 'push', 'snapshot', 'command'];
	const run = () => stages.map(stage => {
		const model = createTextModel('abc\n   ');
		const internal = model as unknown as IPreparationModel;
		const manager = internal._commandManager;
		const failure = {};
		const operations: ValidAnnotatedEditOperation[] = [];
		internal._trimAutoWhitespaceLines = [2];
		internal._commandManager = { pushEditOperation: () => { if (stage === 'command') { throw failure; } return null; } };
		if (stage === 'map') { Object.defineProperty(operations, 'map', { get: () => { throw failure; } }); }
		if (stage === 'push') { Object.defineProperty(operations, 'push', { get: () => { throw failure; } }); }
		if (stage === 'max') { model.getLineMaxColumn = () => { throw failure; }; }
		if (stage === 'snapshot') { Object.defineProperty(model, '_initialUndoRedoSnapshot', { configurable: true, get: () => { throw failure; } }); }
		try {
			let failed = false;
			try { internal._pushEditOperations(null, operations, null); } catch (error) { failed = error === failure; }
			return { failed, length: operations.length, candidates: internal._trimAutoWhitespaceLines };
		} finally { internal._commandManager = manager; model.dispose(); }
	});
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust prepared edit fields own native records while retaining held aliases and descriptors', () => {
	const range = new Range(1, 1, 1, 1);
	const held = withRust(() => {
		const baseline = rust.bracket_node_metadata_live_count();
		const operation = ownRustPreparedModelEdit({ range, text: '\uD800' });
		assert.deepStrictEqual([rust.bracket_node_metadata_live_count(), operation.range === range, Reflect.ownKeys(operation)], [baseline + 1, true, ['range', 'text']]);
		return operation;
	}, true);
	assert.strictEqual(held.range, range);
	Object.freeze(held);
	assert.deepStrictEqual(Object.getOwnPropertyDescriptor(held, 'text'), { value: '\uD800', writable: false, enumerable: true, configurable: false });
});

function cyclicPreparedEdit(): WeakRef<object>[] {
	const range = Object.assign(new Range(1, 1, 1, 1), { owner: null as object | null });
	const operation = ownRustPreparedModelEdit({ range, text: null });
	range.owner = operation;
	return [new WeakRef(range), new WeakRef(operation)];
}
test('Rust prepared edit cycles stay collector visible', async () => {
	const registration = registerRustTextBuffer(rust);
	try {
		for (let attempt = 0; attempt < 8; attempt++) { await setTimeout(0); globalThis.gc?.(); }
		await setTimeout(0);
		const baseline = rust.bracket_node_metadata_live_count();
		const references = cyclicPreparedEdit();
		for (let attempt = 0; attempt < 64; attempt++) {
			await setTimeout(0); globalThis.gc?.();
			if (references.every(reference => reference.deref() === undefined) && rust.bracket_node_metadata_live_count() === baseline) { return; }
		}
		assert.deepStrictEqual([references.map(reference => reference.deref() === undefined), rust.bracket_node_metadata_live_count()], [[true, true], baseline]);
	} finally { registration.dispose(); }
});

test('Rust edit preparation executes the original private path and rejects the previous ABI', () => {
	let prepared = 0;
	let mapped = 0;
	const module: IRustModelEditingModule = {
		...rust,
		run_model_editing: (...args) => { if (args[1] === 12) { prepared++; } return rust.run_model_editing(...args); },
		prepare_model_incoming_edit: (...args) => { mapped++; return rust.prepare_model_incoming_edit(...args); },
	};
	withRust(() => {
		const model = createTextModel('   ');
		const internal = model as unknown as IPreparationModel;
		internal._trimAutoWhitespaceLines = [1];
		try { model.pushEditOperations(null, [{ range: new Range(1, 4, 1, 4), text: '\n' }], null); }
		finally { model.dispose(); }
	}, false, module);
	assert.deepStrictEqual([prepared, mapped], [1, 1]);
	assert.throws(() => registerRustTextBuffer({ ...rust, model_editing_abi_version: () => 1 }), /transaction contract/);
});
