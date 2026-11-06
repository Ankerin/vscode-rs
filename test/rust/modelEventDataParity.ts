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
import { IModelContentChangedEvent, InternalModelContentChangeEvent, ModelRawChange, ModelRawContentChangedEvent, ModelRawEOLChanged, ModelRawFlush, ModelRawLineChanged, ModelRawLinesDeleted, ModelRawLinesInserted } from '../../src/vs/editor/common/textModelEvents.js';
import { ApplyEditsResult } from '../../src/vs/editor/common/model.js';
import { IRustModelEventDataModule, registerRustModelEventData, RustModelEventDataOperation, tryRustModelEventData } from '../../src/vs/editor/common/model/rustModelEventData.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }
interface IInternalEventClass { _mergeChangeEvents(first: IModelContentChangedEvent, second: IModelContentChangedEvent): IModelContentChangedEvent }
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });
const internalClass = InternalModelContentChangeEvent as unknown as IInternalEventClass;

function withRust<T>(compute: () => T, core = false, module: IRustModelEventDataModule = rust): T {
	const registration = core ? registerRustTextBuffer(rust) : registerRustModelEventData(module);
	try { return compute(); } finally { registration.dispose(); }
}
function content(version: number, flags: number): IModelContentChangedEvent {
	return { changes: [{ range: new Range(1, 1, 1, 1), rangeOffset: 0, rangeLength: 0, text: String(version) }], eol: flags & 1 ? '\r\n' : '\n', versionId: version, isUndoing: !!(flags & 2), isRedoing: !!(flags & 4), isFlush: !!(flags & 8), isEolChange: !!(flags & 16), detailedReasons: [], detailedReasonsChangeLengths: [] };
}
function raw(version: number, flags: number): ModelRawContentChangedEvent {
	return new ModelRawContentChangedEvent(flags & 1 ? [new ModelRawFlush(), new ModelRawEOLChanged()] : [new ModelRawLinesDeleted(1, 2, 0)], version, !!(flags & 2), !!(flags & 4));
}

test('Rust model event data preserves seeded merges, flags, content order, and raw presence queries', () => {
	let seed = 279;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const fixtures = Array.from({ length: 256 }, () => [random(32), random(32), random(100), random(100)]);
	const run = () => fixtures.map(([firstFlags, secondFlags, firstVersion, secondVersion]) => {
		const first = new InternalModelContentChangeEvent(raw(firstVersion, firstFlags), content(firstVersion, firstFlags));
		const second = new InternalModelContentChangeEvent(raw(secondVersion, secondFlags), content(secondVersion, secondFlags));
		const result = first.merge(second);
		const snapshot = { raw: { ...result.rawContentChangedEvent }, content: { ...result.contentChangedEvent }, keys: Reflect.ownKeys(result.contentChangedEvent), presence: [0, 1, 2, 3, 4, 5, NaN].map(type => result.rawContentChangedEvent.containsEvent(type)), rawIdentity: first.rawContentChangedEvent.changes !== result.rawContentChangedEvent.changes };
		return snapshot;
	});
	const expected = run();
	assert.deepStrictEqual(withRust(run), expected);
	assert.deepStrictEqual(withRust(run, true), expected);
});

test('Rust event flag short circuits retain arbitrary runtime values and property getter order', () => {
	const run = () => {
		const trace: string[] = [];
		const opaque = {};
		const first = content(1, 0);
		const second = content(2, 31);
		Reflect.set(first, 'isUndoing', opaque);
		Reflect.set(first, 'isRedoing', '');
		Reflect.set(first, 'isEolChange', null);
		const observed = (value: IModelContentChangedEvent, name: string) => new Proxy(value, { get: (target, key, receiver) => { trace.push(name + ':' + String(key)); return Reflect.get(target, key, receiver); } });
		const result = internalClass._mergeChangeEvents(observed(first, 'a'), observed(second, 'b'));
		return { flags: [result.isUndoing === opaque, result.isRedoing, result.isFlush, result.isEolChange], trace, keys: Reflect.ownKeys(result) };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust raw event merging captures concat before source getters can replace the method', () => {
	const concat = Array.prototype.concat;
	const run = () => {
		const trace: string[] = [];
		const first = raw(1, 0);
		const second = raw(2, 1);
		const changes = first.changes;
		const marker = new ModelRawFlush();
		Object.defineProperty(first, 'changes', {
			configurable: true, get: () => {
				trace.push('a');
				Array.prototype.concat = function () { trace.push('replacement'); return [marker]; };
				return changes;
			}
		});
		let result: ModelRawContentChangedEvent;
		try { result = ModelRawContentChangedEvent.merge(first, second); }
		finally { Array.prototype.concat = concat; }
		return { trace, marker: result.changes[0] === marker, count: result.changes.length, version: result.versionId };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust internal event merging captures virtual static providers before event argument getters', () => {
	const merge = Object.getOwnPropertyDescriptor(ModelRawContentChangedEvent, 'merge')!;
	const contentMerge = Object.getOwnPropertyDescriptor(InternalModelContentChangeEvent, '_mergeChangeEvents')!;
	const run = () => {
		const trace: string[] = [];
		const first = new InternalModelContentChangeEvent(raw(1, 0), content(1, 0));
		const second = new InternalModelContentChangeEvent(raw(2, 1), content(2, 31));
		const rawResult = raw(9, 0);
		const contentResult = content(9, 0);
		const initialRaw = first.rawContentChangedEvent;
		Object.defineProperty(ModelRawContentChangedEvent, 'merge', { configurable: true, get: () => { trace.push('raw:method'); return function rawMerge(this: typeof ModelRawContentChangedEvent) { trace.push(this === ModelRawContentChangedEvent ? 'raw:receiver' : 'raw:wrong'); return rawResult; }; } });
		Object.defineProperty(InternalModelContentChangeEvent, '_mergeChangeEvents', { configurable: true, get: () => { trace.push('content:method'); return function contentMerge(this: typeof InternalModelContentChangeEvent) { trace.push(this === InternalModelContentChangeEvent ? 'content:receiver' : 'content:wrong'); return contentResult; }; } });
		Object.defineProperty(first, 'rawContentChangedEvent', { configurable: true, get: () => { trace.push('raw:argument'); Object.defineProperty(ModelRawContentChangedEvent, 'merge', { configurable: true, value: () => { throw new Error('A later merge replacement must not run'); } }); return initialRaw; } });
		try { const result = first.merge(second); return { trace, rawIdentity: result.rawContentChangedEvent === rawResult, contentIdentity: result.contentChangedEvent === contentResult }; }
		finally { Object.defineProperty(ModelRawContentChangedEvent, 'merge', merge); Object.defineProperty(InternalModelContentChangeEvent, '_mergeChangeEvents', contentMerge); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust raw event presence scanning retains initial length, live source arrays, and strict type checks', () => {
	const run = () => {
		const event = raw(1, 1);
		const trace: string[] = [];
		let reads = 0;
		Object.defineProperty(event, 'changes', { configurable: true, get: () => { trace.push('changes'); reads++; return reads === 1 ? [new ModelRawFlush(), new ModelRawFlush(), new ModelRawFlush()] : [new ModelRawFlush(), new ModelRawEOLChanged(), new ModelRawLinesDeleted(1, 2, 0)]; } });
		const found = event.containsEvent(new ModelRawEOLChanged().changeType);
		return { found, trace };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust raw and internal event records retain original aliases, descriptors, and frozen values', () => {
	const held = withRust(() => {
		const baseline = rust.bracket_node_metadata_live_count();
		const changes: ModelRawChange[] = [new ModelRawFlush()];
		const source = new ModelRawContentChangedEvent(changes, 1, false, false);
		const data = content(1, 0);
		const internal = new InternalModelContentChangeEvent(source, data);
		assert.deepStrictEqual([rust.bracket_node_metadata_live_count(), source.changes === changes, internal.rawContentChangedEvent === source, internal.contentChangedEvent === data], [baseline + 3, true, true, true]);
		Object.freeze(source); Object.freeze(internal);
		Object.freeze(changes[0]);
		assert.strictEqual(rust.bracket_node_metadata_live_count(), baseline);
		return internal;
	}, true);
	assert.strictEqual(held.rawContentChangedEvent.containsEvent(new ModelRawFlush().changeType), true);
	assert.deepStrictEqual(Object.getOwnPropertyDescriptor(held, 'contentChangedEvent'), { value: held.contentChangedEvent, writable: false, enumerable: true, configurable: false });
});

function cyclicRawEvent(): [WeakRef<object>, WeakRef<object>] {
	const changes: ModelRawChange[] = [];
	const event = new ModelRawContentChangedEvent(changes, 1, false, false);
	Object.assign(changes, { owner: event });
	return [new WeakRef(event), new WeakRef(changes)];
}

test('Rust raw event reference cycles stay collector visible', async () => {
	const registration = registerRustTextBuffer(rust);
	try {
		for (let attempt = 0; attempt < 8; attempt++) { await setTimeout(0); globalThis.gc?.(); }
		await setTimeout(0);
		const baseline = rust.bracket_node_metadata_live_count();
		const references = cyclicRawEvent();
		for (let attempt = 0; attempt < 64; attempt++) {
			await setTimeout(0); globalThis.gc?.();
			if (references.every(reference => reference.deref() === undefined) && rust.bracket_node_metadata_live_count() === baseline) { return; }
		}
		assert.deepStrictEqual([references.map(reference => reference.deref() === undefined), rust.bracket_node_metadata_live_count()], [[true, true], baseline]);
	} finally { registration.dispose(); }
});

test('Rust event data executes every operation and rejects stale bindings atomically', () => {
	const calls = new Set<number>();
	const module: IRustModelEventDataModule = { ...rust, run_model_event_data: (...args) => { calls.add(args[1]); return rust.run_model_event_data(...args); } };
	withRust(() => {
		const first = new InternalModelContentChangeEvent(raw(1, 0), content(1, 0));
		const second = new InternalModelContentChangeEvent(raw(2, 1), content(2, 31));
		first.merge(second).rawContentChangedEvent.containsEvent(new ModelRawFlush().changeType);
	}, false, module);
	assert.deepStrictEqual([...calls].sort(), [0, 1, 2, 3]);
	assert.throws(() => registerRustTextBuffer({ ...rust, model_event_data_abi_version: () => 0 }), /merge contract/);
	assert.strictEqual(tryRustModelEventData(RustModelEventDataOperation.RawMerge, raw(1, 0), raw(2, 0), () => { throw new Error('Unavailable data control must not create a host'); }), undefined);
	const registration = registerRustModelEventData(rust);
	try { assert.throws(() => registerRustModelEventData(rust), /already registered/); }
	finally { registration.dispose(); }
});

test('Rust raw change and edit result fields own native slots with original aliases and descriptors', () => {
	const held = withRust(() => {
		const baseline = rust.bracket_node_metadata_live_count();
		const changes = [new ModelRawFlush(), new ModelRawLineChanged(1, 2), new ModelRawLinesDeleted(2, 3, 1), new ModelRawLinesInserted(3, 4, 2), new ModelRawEOLChanged()];
		const reverse: [] = [];
		const candidates = [2];
		const result = new ApplyEditsResult(reverse, [], candidates);
		assert.deepStrictEqual([rust.bracket_node_metadata_live_count(), result.reverseEdits === reverse, result.trimAutoWhitespaceLineNumbers === candidates], [baseline + 6, true, true]);
		const snapshots = changes.map(value => ({ ...value }));
		for (const value of [...changes, result]) { Object.freeze(value); }
		assert.strictEqual(rust.bracket_node_metadata_live_count(), baseline);
		return { changes, result, snapshots };
	}, true);
	assert.deepStrictEqual(held.changes.map(value => ({ ...value })), held.snapshots);
	assert.deepStrictEqual(Object.getOwnPropertyDescriptor(held.result, 'reverseEdits'), { value: held.result.reverseEdits, writable: false, enumerable: true, configurable: false });
	assert.strictEqual((held.changes[3] as ModelRawLinesInserted).toLineNumberPostEdit, 5);
});

test('Rust inserted line endpoints preserve seeded exceptional values, getter order, and coercions', () => {
	const values = [NaN, Infinity, -Infinity, -0, 0, -2.5, 1, 3.25, '2', null, undefined, false, 2n, Symbol('line')];
	let seed = 798;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const fixtures = Array.from({ length: 256 }, () => [values[random(values.length)], values[random(values.length)], values[random(values.length)]]);
	const run = () => fixtures.map(([first, second, count]) => {
		const trace: string[] = [];
		const event = new ModelRawLinesInserted(1, 2, 3);
		Object.defineProperty(event, 'fromLineNumber', { get: () => { trace.push('first'); return first; } });
		Object.defineProperty(event, 'fromLineNumberPostEdit', { get: () => { trace.push('second'); return second; } });
		Object.defineProperty(event, 'count', { get: () => { trace.push('count'); return count; } });
		const read = (post: boolean) => { try { return post ? event.toLineNumberPostEdit : event.toLineNumber; } catch (error) { return error instanceof Error ? error.name : String(error); } };
		return { first: read(false), second: read(true), trace };
	});
	assert.deepStrictEqual(withRust(run), run());
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust inserted endpoints retain getter and coercion failures without reading later state', () => {
	const run = () => ['first', 'count', 'coercion'].map(stage => {
		const trace: string[] = [];
		const failure = {};
		const event = new ModelRawLinesInserted(1, 2, 3);
		const number = (name: string) => ({ [Symbol.toPrimitive]: () => { trace.push(name + ':coercion'); if (stage === 'coercion') { throw failure; } return 2; } });
		Object.defineProperty(event, 'fromLineNumber', { get: () => { trace.push('first'); if (stage === 'first') { throw failure; } return number('first'); } });
		Object.defineProperty(event, 'count', { get: () => { trace.push('count'); if (stage === 'count') { throw failure; } return number('count'); } });
		let failed = false;
		try { void event.toLineNumber; } catch (error) { failed = error === failure; }
		return { trace, failed };
	});
	assert.deepStrictEqual(withRust(run), run());
});

function cyclicEditResult(): WeakRef<object>[] {
	const changes: ModelRawChange[] = [];
	const result = new ApplyEditsResult([], [], null);
	const raw = new ModelRawLineChanged(1, 2);
	Reflect.set(raw, 'lineNumber', result);
	Reflect.set(result, 'changes', changes);
	changes.push(raw);
	return [new WeakRef(changes), new WeakRef(result), new WeakRef(raw)];
}
test('Rust raw change and edit result cycles stay collector visible', async () => {
	const registration = registerRustTextBuffer(rust);
	try {
		for (let attempt = 0; attempt < 8; attempt++) { await setTimeout(0); globalThis.gc?.(); }
		await setTimeout(0);
		const baseline = rust.bracket_node_metadata_live_count();
		const references = cyclicEditResult();
		for (let attempt = 0; attempt < 64; attempt++) {
			await setTimeout(0); globalThis.gc?.();
			if (references.every(reference => reference.deref() === undefined) && rust.bracket_node_metadata_live_count() === baseline) { return; }
		}
		assert.deepStrictEqual([references.map(reference => reference.deref() === undefined), rust.bracket_node_metadata_live_count()], [[true, true, true], baseline]);
	} finally { registration.dispose(); }
});

test('Rust inserted endpoints execute native control and reject the previous event data ABI', () => {
	let calls = 0;
	const module: IRustModelEventDataModule = { ...rust, inserted_model_line_end: host => { calls++; return rust.inserted_model_line_end(host); } };
	withRust(() => {
		const event = new ModelRawLinesInserted(2, 4, 3);
		assert.deepStrictEqual([event.toLineNumber, event.toLineNumberPostEdit], [4, 6]);
	}, false, module);
	assert.strictEqual(calls, 2);
	assert.throws(() => registerRustTextBuffer({ ...rust, model_event_data_abi_version: () => 1 }), /merge contract/);
});
