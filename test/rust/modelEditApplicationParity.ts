/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { Selection } from '../../src/vs/editor/common/core/selection.js';
import { ApplyEditsResult, IInternalModelContentChange, IValidEditOperation, ValidAnnotatedEditOperation } from '../../src/vs/editor/common/model.js';
import { TextModel } from '../../src/vs/editor/common/model/textModel.js';
import { EditSources, TextModelEditSource } from '../../src/vs/editor/common/textModelEditSource.js';
import { IModelContentChangedEvent, ModelRawContentChangedEvent } from '../../src/vs/editor/common/textModelEvents.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { IRustModelEditApplicationModule, registerRustModelEditApplication, tryRustModelEditApplication } from '../../src/vs/editor/common/model/rustModelEditApplication.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }
interface IApplicationModel {
	_buffer: { getLineCount(): number; applyEdits(operations: ValidAnnotatedEditOperation[], trim: boolean, undo: boolean): ApplyEditsResult; getEOL(): string };
	_options: { trimAutoWhitespace: boolean };
	_decorationsTree: { acceptReplace(offset: number, deleted: number, inserted: number, markers: boolean): void };
	_trimAutoWhitespaceLines: number[] | null;
	_doApplyEdits(operations: ValidAnnotatedEditOperation[], undo: boolean, reason: TextModelEditSource, selection?: Selection[] | null): void | IValidEditOperation[];
	_emitContentChangedEvent(raw: ModelRawContentChangedEvent, content: IModelContentChangedEvent, selection: Selection[] | null): void;
	getVersionId(): number;
}
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });
const reason = EditSources.applyEdits();

function withRust<T>(compute: () => T, core = false, module: IRustModelEditApplicationModule = rust): T {
	const registration = core ? registerRustTextBuffer(rust) : registerRustModelEditApplication(module);
	try { return compute(); } finally { registration.dispose(); }
}
function change(range: Range, text: string): IInternalModelContentChange {
	return { range, rangeOffset: 0, rangeLength: 0, text, forceMoveMarkers: false };
}
function mockModel(result: ApplyEditsResult, trace: string[], failures: readonly string[] = []): { model: IApplicationModel; received: object[]; failure: object } {
	const failure = {};
	let version = 1;
	let lines = 0;
	const received: object[] = [];
	const record = (name: string) => { trace.push(name); if (failures.includes(name)) { throw failure; } };
	const model = Object.assign(Object.create(TextModel.prototype), {
		_buffer: {
			getLineCount: () => { record('lines'); return ++lines === 1 ? 4 : 5; },
			applyEdits: () => { record('buffer:apply'); return result; },
			getEOL: () => { record('eol'); return '\n'; },
		},
		_options: { trimAutoWhitespace: true },
		_isUndoing: false,
		_isRedoing: false,
		_trimAutoWhitespaceLines: null,
		_decorationsTree: { acceptReplace: () => record('replace') },
		_onDidChangeDecorations: { fire: () => record('decorations') },
		_increaseVersionId: () => { record('increase'); version++; },
		getVersionId: () => { record('version'); return version; },
		_emitContentChangedEvent: (raw: ModelRawContentChangedEvent, content: IModelContentChangedEvent, selection: Selection[] | null) => { record('emit'); received.push({ raw: { ...raw, changes: raw.changes.map(value => ({ ...value })) }, content: { ...content }, selection }); },
	}) as IApplicationModel;
	return { model, received, failure };
}

test('Rust model application preserves seeded real batches, inverse edits, events, versions, and decorations', () => {
	let seed = 863;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const texts = [null, '', '\n', 'x\r\n', '\uD800\n', '\uDC00', '  '];
	const fixtures = Array.from({ length: 128 }, () => Array.from({ length: 4 }, () => [random(2), random(texts.length), random(2)]));
	const run = () => fixtures.map(fixture => {
		const model = createTextModel('abc\nxy\n\nz');
		const events: object[] = [];
		const subscription = model.onDidChangeContent(event => events.push({ ...event }));
		model.deltaDecorations([], [{ range: new Range(1, 1, 4, 2), options: { description: 'Rust model application parity' } }]);
		const operations = fixture.flatMap(([include, text, markers], index) => include ? [{ range: new Range(index + 1, 1, index + 1, model.getLineMaxColumn(index + 1)), text: texts[text], forceMoveMarkers: !!markers }] : []);
		try {
			const reverse = model.applyEdits(operations, true);
			return { reverse, events, value: model.getValue(), version: model.getVersionId(), decorations: model.getAllDecorations().map(value => ({ range: value.range, description: value.options.description })) };
		} finally { subscription.dispose(); model.dispose(); }
	});
	const expected = run();
	assert.deepStrictEqual(withRust(run), expected);
	assert.deepStrictEqual(withRust(run, true), expected);
});

test('Rust application captures buffer, decoration, and emission methods before argument getters', () => {
	const run = () => {
		const trace: string[] = [];
		const rawChange = change(new Range(1, 1, 2, 1), '\n');
		const observed = new Proxy(rawChange, { get: (target, key, receiver) => { trace.push('change:' + String(key)); return Reflect.get(target, key, receiver); } });
		const result = new ApplyEditsResult([], [observed], [2]);
		const { model, received } = mockModel(result, trace);
		const buffer = model._buffer;
		const apply = function (this: object, operations: ValidAnnotatedEditOperation[], trim: boolean) { trace.push('buffer:receiver:' + (this === buffer) + ':trim:' + (trim === opaque)); return result; };
		const opaque = {};
		Object.defineProperty(apply, 'call', { get: () => { throw new Error('Direct invocation must not observe call'); } });
		Object.defineProperty(buffer, 'applyEdits', { configurable: true, get: () => { trace.push('buffer:method'); return apply; } });
		Object.defineProperty(model._options, 'trimAutoWhitespace', { get: () => { trace.push('trim'); Object.defineProperty(buffer, 'applyEdits', { configurable: true, value: () => { throw new Error('Later buffer method must not run'); } }); return opaque; } });
		const tree = model._decorationsTree;
		Object.defineProperty(tree, 'acceptReplace', { configurable: true, get: () => { trace.push('replace:method'); return function (this: object) { trace.push('replace:' + (this === tree)); }; } });
		Object.defineProperty(rawChange, 'rangeOffset', { configurable: true, get: () => { trace.push('offset'); Object.defineProperty(tree, 'acceptReplace', { configurable: true, value: () => { throw new Error('Later decoration method must not run'); } }); return 0; } });
		const emit = model._emitContentChangedEvent;
		Object.defineProperty(model, '_emitContentChangedEvent', { configurable: true, get: () => { trace.push('emit:method'); return emit; } });
		model.getVersionId = () => { trace.push('version'); Object.defineProperty(model, '_emitContentChangedEvent', { configurable: true, value: () => { throw new Error('Later emission must not run'); } }); return 2; };
		model._doApplyEdits([], true, reason);
		return { trace, received };
	};
	assert.deepStrictEqual(withRust(run), run());
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust application preserves overridden Math.min values and exceptional arithmetic coercion order', () => {
	const minimum = Math.min;
	const run = () => ['object', 'nan'].map(kind => {
		const trace: string[] = [];
		const range = new Range(1, 1, 2, 1);
		Reflect.set(range, 'startLineNumber', '1');
		Reflect.set(range, 'endLineNumber', '2');
		const result = new ApplyEditsResult([], [change(range, '\n')], null);
		const { model, received } = mockModel(result, trace);
		const value = { [Symbol.toPrimitive]: () => { trace.push('minimum:value'); return 0; } };
		Math.min = () => { trace.push('minimum'); return kind === 'object' ? value as unknown as number : NaN; };
		try { model._doApplyEdits([], false, reason); return { trace, received }; }
		finally { Math.min = minimum; }
	});
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust application failures preserve original identities and partial trim/version state', () => {
	const stages = ['buffer:apply', 'replace', 'increase', 'decorations', 'version', 'eol', 'emit'];
	const run = () => stages.map(stage => {
		const trace: string[] = [];
		const result = new ApplyEditsResult([], [change(new Range(1, 1, 1, 1), '\n')], [2]);
		const { model, failure } = mockModel(result, trace, [stage]);
		let failed = false;
		try { model._doApplyEdits([], false, reason); } catch (error) { failed = error === failure; }
		return { trace, failed, trim: model._trimAutoWhitespaceLines };
	});
	assert.deepStrictEqual(withRust(run), run());
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust application preserves live reverse-edit double reads and null result shortcuts', () => {
	const run = () => [false, true].map(nullFirst => {
		const trace: string[] = [];
		const result = new ApplyEditsResult([], [], [2]);
		const reverse: IValidEditOperation[] = [];
		let reads = 0;
		Object.defineProperty(result, 'reverseEdits', { get: () => { trace.push('reverse'); return ++reads === 1 && nullFirst ? null : reverse; } });
		const { model } = mockModel(result, trace);
		return { identity: model._doApplyEdits([], true, reason) === reverse, trace, trim: model._trimAutoWhitespaceLines };
	});
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust application executes beneath public edits and rolls back stale registration atomically', () => {
	let calls = 0;
	const module: IRustModelEditApplicationModule = { ...rust, apply_model_edits: (...args) => { calls++; return rust.apply_model_edits(...args); } };
	withRust(() => {
		const model = createTextModel('abc');
		try { model.applyEdits([{ range: new Range(1, 1, 1, 1), text: '\n' }]); }
		finally { model.dispose(); }
	}, false, module);
	assert.strictEqual(calls, 1);
	assert.throws(() => registerRustTextBuffer({ ...rust, model_edit_application_abi_version: () => 0 }), /change contract/);
	assert.strictEqual(tryRustModelEditApplication([], false, reason, null, () => { throw new Error('Unavailable application must not create a host'); }), undefined);
	const registration = registerRustModelEditApplication(rust);
	try { assert.throws(() => registerRustModelEditApplication(rust), /already registered/); }
	finally { registration.dispose(); }
});
