/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { URI } from '../../src/vs/base/common/uri.js';
import { ISingleEditOperation } from '../../src/vs/editor/common/core/editOperation.js';
import { Position } from '../../src/vs/editor/common/core/position.js';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { Selection } from '../../src/vs/editor/common/core/selection.js';
import { TextChange } from '../../src/vs/editor/common/core/textChange.js';
import { IIdentifiedSingleEditOperation, IValidEditOperation, ValidAnnotatedEditOperation } from '../../src/vs/editor/common/model.js';
import { TextModel } from '../../src/vs/editor/common/model/textModel.js';
import { EditSources, TextModelEditSource } from '../../src/vs/editor/common/textModelEditSource.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { IRustModelEditingModule, registerRustModelEditing, RustModelEditingOperation, tryRustModelEditing } from '../../src/vs/editor/common/model/rustModelEditing.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }
interface IPrivateEditingModel {
	_initialUndoRedoSnapshot: object | null;
	_isUndoing: boolean;
	_isRedoing: boolean;
	_validateEditOperations(operations: readonly IIdentifiedSingleEditOperation[]): ValidAnnotatedEditOperation[];
	_pushEditOperations(...args: object[]): Selection[] | null;
	_doApplyEdits(operations: ValidAnnotatedEditOperation[], undo: boolean, reason: TextModelEditSource, selection?: Selection[] | null): void | IValidEditOperation[];
	_applyUndoRedoEdits(edits: ISingleEditOperation[], eol: number, undo: boolean, redo: boolean, version: number, selection: Selection[] | null): void;
}
type EditingModel = Omit<TextModel, keyof IPrivateEditingModel> & IPrivateEditingModel;
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, core = false, module: IRustModelEditingModule = rust): T {
	const registration = core ? registerRustTextBuffer(rust) : registerRustModelEditing(module);
	try { return compute(); } finally { registration.dispose(); }
}
async function withRustAsync<T>(compute: () => Promise<T>, core = false): Promise<T> {
	const registration = core ? registerRustTextBuffer(rust) : registerRustModelEditing(rust);
	try { return await compute(); } finally { registration.dispose(); }
}

function mockModel(trace: string[], failures: readonly string[] = []): { model: EditingModel; failure: object } {
	const failure = {};
	const record = (name: string) => { trace.push(name); if (failures.includes(name)) { throw failure; } };
	const model = Object.assign(Object.create(TextModel.prototype), {
		_uri: URI.parse('inmemory://rust/editing'),
		_initialUndoRedoSnapshot: null,
		_isUndoing: false,
		_isRedoing: false,
		_onDidChangeDecorations: { beginDeferredEmit: () => record('decorations:begin'), endDeferredEmit: () => record('decorations:end') },
		_eventEmitter: { beginDeferredEmit: () => record('content:begin'), endDeferredEmit: (...args: object[]) => record('content:end:' + args.length) },
		_undoRedoService: { createSnapshot: () => { record('snapshot'); return {}; } },
		_commandManager: { pushEOL: () => record('command:eol'), pushStackElement: () => record('stack:push'), popStackElement: () => record('stack:pop') },
		getEOL: () => { record('eol'); return '\n'; },
		_validateEditOperations: () => { record('validate'); return []; },
		_pushEditOperations: () => { record('push'); return null; },
		_doApplyEdits: () => { record('apply'); return undefined; },
		setEOL: () => record('set:eol'),
		_overwriteAlternativeVersionId: () => record('alternative'),
		getPositionAt: (offset: number) => new Position(1, offset + 1),
	}) as EditingModel;
	return { model, failure };
}

test('Rust public edit transactions preserve real model edits, events, versions, and undo/redo', async () => {
	let seed = 223;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const texts = ['', '\n', 'xy', '\uD800', '\uDC00', '\r\n'];
	const fixtures = Array.from({ length: 32 }, () => Array.from({ length: 16 }, () => [random(8), random(texts.length), random(7)]));
	const run = async () => {
		const results: object[] = [];
		for (const operations of fixtures) {
			const model = createTextModel('abc\nxy');
			const events: object[] = [];
			const subscription = model.onDidChangeContent(event => events.push({ changes: event.changes, eol: event.eol, version: event.versionId, undo: event.isUndoing, redo: event.isRedoing }));
			try {
				const states: object[] = [];
				for (const [operation, text, offset] of operations) {
					const position = model.getPositionAt(offset);
					const range = Range.fromPositions(position);
					switch (operation) {
						case 0: model.pushStackElement(); model.pushEditOperations(null, [{ range, text: texts[text] }], null); break;
						case 1: model.applyEdits([{ range, text: texts[text] }]); break;
						case 2: model.applyEdits([{ range, text: texts[text] }], true); break;
						case 3: model.pushEOL(text % 2); break;
						case 4: await model.undo(); break;
						case 5: await model.redo(); break;
						case 6: model.pushStackElement(); break;
						case 7: model.popStackElement(); break;
					}
					states.push({ value: model.getValue(), eol: model.getEOL(), version: model.getVersionId(), alternative: model.getAlternativeVersionId(), undo: model.canUndo(), redo: model.canRedo() });
				}
				results.push({ states, events });
			} finally { subscription.dispose(); model.dispose(); }
		}
		return results;
	};
	const expected = await run();
	assert.deepStrictEqual(await withRustAsync(run), expected);
	assert.deepStrictEqual(await withRustAsync(run, true), expected);
});

test('Rust edit finally paths preserve original failure identity and cleanup precedence', () => {
	const fixtures = [
		['decorations:begin'], ['content:begin'], ['validate'], ['apply'], ['push'], ['command:eol'], ['set:eol'], ['alternative'],
		['validate', 'content:end:0'], ['apply', 'decorations:end'], ['content:begin', 'content:end:1'], ['validate', 'decorations:end'],
	];
	const run = () => fixtures.map(failures => [0, 1, 2, 3].map(operation => {
		const trace: string[] = [];
		const { model, failure } = mockModel(trace, failures);
		try {
			switch (operation) {
				case 0: model.applyEdits([]); break;
				case 1: model.pushEditOperations(null, [], null); break;
				case 2: model.pushEOL(1); break;
				case 3: model._applyUndoRedoEdits([], 1, true, false, 3, null); break;
			}
			return { trace, failure: false, flags: [model._isUndoing, model._isRedoing] };
		} catch (error) { return { trace, failure: error === failure, flags: [model._isUndoing, model._isRedoing] }; }
	}));
	assert.deepStrictEqual(withRust(run), run());
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust EOL transactions retain strict no-op and null snapshot behavior', () => {
	const run = () => [null, undefined, {}].flatMap(snapshot => [0, 1, NaN, '0'].map(eol => {
		const trace: string[] = [];
		const { model } = mockModel(trace);
		Reflect.set(model, '_initialUndoRedoSnapshot', snapshot);
		model.pushEOL(eol as number);
		return trace;
	}));
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust editing captures private methods before validation and source factories with original argument counts', () => {
	const source = Object.getOwnPropertyDescriptor(EditSources, 'applyEdits')!;
	const run = () => {
		const trace: string[] = [];
		const { model } = mockModel(trace);
		const cursor = [new Selection(1, 1, 1, 1)];
		const reverse: IValidEditOperation[] = [];
		Object.defineProperty(model, '_pushEditOperations', { configurable: true, get: () => { trace.push('push:method'); return function (this: object, ...args: object[]) { trace.push('push:receiver:' + (this === model) + ':arity:' + args.length); return cursor; }; } });
		model._validateEditOperations = () => {
			trace.push('validate');
			Object.defineProperty(model, '_pushEditOperations', { configurable: true, value: () => { throw new Error('Later push method must not run'); } });
			return [];
		};
		const pushIdentity = model.pushEditOperations(null, [], null) === cursor;
		Object.defineProperty(model, '_doApplyEdits', { configurable: true, get: () => { trace.push('apply:method'); return function (this: object, ...args: object[]) { trace.push('apply:receiver:' + (this === model) + ':arity:' + args.length); return reverse; }; } });
		Object.defineProperty(EditSources, 'applyEdits', { configurable: true, get: () => { trace.push('source:method'); return () => { trace.push('source'); Object.defineProperty(model, '_doApplyEdits', { configurable: true, value: () => { throw new Error('Later apply method must not run'); } }); return source.value(); }; } });
		try { const applyIdentity = model.applyEdits([], true) === reverse; return { trace, pushIdentity, applyIdentity }; }
		finally { Object.defineProperty(EditSources, 'applyEdits', source); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust captured editing methods ignore callable call properties and retain target arity', () => {
	const run = () => {
		const trace: string[] = [];
		const { model } = mockModel(trace);
		const push = function (this: object, ...args: object[]) { trace.push('push:' + (this === model) + ':' + args.length); return null; };
		const apply = function (this: object, ...args: Parameters<IPrivateEditingModel['_doApplyEdits']>) { trace.push('apply:' + (this === model) + ':' + args.length); };
		for (const method of [push, apply]) { Object.defineProperty(method, 'call', { get: () => { throw new Error('Direct invocation must not observe call'); } }); }
		model._pushEditOperations = push;
		model._doApplyEdits = apply;
		model.pushEditOperations(null, [], null);
		model.applyEdits([]);
		model._applyUndoRedoEdits([], 1, true, false, 3, null);
		return trace;
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust undo mapping preserves array species, sparse holes, virtual map, and source getter order', () => {
	const run = () => {
		const trace: string[] = [];
		const { model } = mockModel(trace);
		let count = 0;
		Object.defineProperty(model, 'getPositionAt', { configurable: true, get: () => { trace.push('position:method'); return function (this: object, offset: number) { trace.push('position:' + offset + ':' + (this === model)); return new Proxy(new Position(1, offset + 1), { get: (target, key, receiver) => { trace.push('position:' + String(key)); return Reflect.get(target, key, receiver); } }); }; } });
		const change = new Proxy(new TextChange(0, '\uD800', 2, 'xy'), {
			get: (target, key, receiver) => {
				trace.push('change:' + String(key));
				if (key === 'newPosition' && ++count === 1) { Object.defineProperty(model, 'getPositionAt', { configurable: true, value: (offset: number) => { trace.push('replacement:' + offset); return new Position(2, 3); } }); }
				return Reflect.get(target, key, receiver);
			}
		});
		class Changes extends Array<TextChange> { }
		const changes = new Changes(2);
		changes[1] = change;
		const received: object[] = [];
		model._applyUndoRedoEdits = function (...args) { received.push({ edits: Array.from(args[0]), keys: Reflect.ownKeys(args[0]), species: args[0] instanceof Changes, rest: args.slice(1), receiver: this === model }); };
		model._applyUndo(changes, 1, 7, null);
		model._applyRedo(changes, 0, 8, null);
		return { trace, received };
	};
	assert.deepStrictEqual(withRust(run), run());
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust undo flags retain raw values, setter order, and cleanup failures', () => {
	const run = () => [false, true].map(failReset => {
		const trace: string[] = [];
		const { model } = mockModel(trace);
		const failure = {};
		const opaque = {};
		let undo: boolean = false;
		Object.defineProperty(model, '_isUndoing', { configurable: true, get: () => undo, set: (value: boolean) => { trace.push('undo:' + (value === opaque ? 'opaque' : value)); if (failReset && value === false) { throw failure; } undo = value; } });
		Object.defineProperty(model, '_isRedoing', { configurable: true, set: value => trace.push('redo:' + value) });
		let failed = false;
		try { model._applyUndoRedoEdits([], 1, opaque as boolean, false, 3, null); }
		catch (error) { failed = error === failure; }
		return { trace, failed, retained: undo === opaque };
	});
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust undo services preserve receivers, lookup before URI getters, and Promise/result identities', () => {
	const run = () => {
		const trace: string[] = [];
		const { model } = mockModel(trace);
		const pending = Promise.resolve();
		const opaque = {};
		const service = {
			get undo() { trace.push('undo:method'); return function (this: object) { trace.push('undo:' + (this === service)); return pending; }; },
			redo: () => pending,
			canUndo: () => opaque,
			canRedo: () => 0,
		};
		Reflect.set(model, '_undoRedoService', service);
		Object.defineProperty(model, 'uri', { configurable: true, get: () => { trace.push('uri'); Object.defineProperty(service, 'undo', { configurable: true, value: () => { throw new Error('Later service method must not run'); } }); return URI.parse('inmemory://rust/editing'); } });
		return { trace, undo: model.undo() === pending, redo: model.redo() === pending, canUndo: model.canUndo() === opaque, canRedo: model.canRedo() };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust model editing executes all transitions and atomically rolls back stale bindings', () => {
	const calls = new Set<number>();
	const module: IRustModelEditingModule = { ...rust, run_model_editing: (...args) => { calls.add(args[1]); return rust.run_model_editing(...args); } };
	withRust(() => {
		const model = createTextModel('abc');
		try {
			model.pushStackElement(); model.popStackElement(); model.pushEOL(1);
			model.applyEdits([{ range: new Range(1, 1, 1, 1), text: 'a' }]);
			model.pushEditOperations(null, [{ range: new Range(1, 1, 1, 1), text: 'b' }], null);
			model.undo(); model.redo(); model.canUndo(); model.canRedo();
		} finally { model.dispose(); }
	}, false, module);
	assert.deepStrictEqual([...calls].sort((a, b) => a - b), Array.from({ length: 12 }, (_, index) => index));
	assert.throws(() => registerRustTextBuffer({ ...rust, model_editing_abi_version: () => 0 }), /transaction contract/);
	assert.strictEqual(tryRustModelEditing(RustModelEditingOperation.PushStack, () => { throw new Error('Unavailable editing must not create a host'); }), undefined);
	const registration = registerRustModelEditing(rust);
	try { assert.throws(() => registerRustModelEditing(rust), /already registered/); }
	finally { registration.dispose(); }
});
