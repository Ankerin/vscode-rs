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
import { Event } from '../../src/vs/base/common/event.js';
import { IDisposable } from '../../src/vs/base/common/lifecycle.js';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { Selection } from '../../src/vs/editor/common/core/selection.js';
import { InternalModelContentChangeEvent, ModelRawContentChangedEvent } from '../../src/vs/editor/common/textModelEvents.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { IRustModelContentEventsModule, registerRustModelContentEvents, RustModelContentEventsOperation, tryRustModelContentEvents } from '../../src/vs/editor/common/model/rustModelContentEvents.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }
interface IContentEmitter extends IDisposable {
	_deferredCnt: number;
	_deferredEvent: InternalModelContentChangeEvent | null;
	_emitter: { hasListeners(): boolean; fire(event: InternalModelContentChangeEvent): void };
	event: Event<InternalModelContentChangeEvent>;
	hasListeners(): boolean;
	beginDeferredEmit(): void;
	endDeferredEmit(selection?: Selection[] | null): void;
	fire(event: InternalModelContentChangeEvent): void;
}
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });
const probe = createTextModel('');
const ContentEmitter = (probe as unknown as { _eventEmitter: object })._eventEmitter.constructor as new () => IContentEmitter;
probe.dispose();

function withRust<T>(compute: () => T, core = false, module: IRustModelContentEventsModule = rust): T {
	const registration = core ? registerRustTextBuffer(rust) : registerRustModelContentEvents(module);
	try { return compute(); } finally { registration.dispose(); }
}
function event(version: number): InternalModelContentChangeEvent {
	return new InternalModelContentChangeEvent(new ModelRawContentChangedEvent([], version, false, false), { changes: [{ range: new Range(1, 1, 1, 1), rangeOffset: 0, rangeLength: 0, text: String(version) }], eol: '\n', versionId: version, isUndoing: false, isRedoing: false, isFlush: false, isEolChange: false, detailedReasons: [], detailedReasonsChangeLengths: [] });
}

test('Rust deferred model content events preserve seeded nesting, merging, and selection identity', () => {
	let seed = 65129;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const fixtures = Array.from({ length: 128 }, () => Array.from({ length: 32 }, () => random(3)));
	const run = () => fixtures.map(operations => {
		const emitter = new ContentEmitter();
		const received: object[] = [];
		const selection = [new Selection(1, 1, 1, 2)];
		const subscription = emitter.event(value => received.push({ content: value.contentChangedEvent, raw: { ...value.rawContentChangedEvent }, selectionIdentity: value.rawContentChangedEvent.resultingSelection === selection, count: emitter._deferredCnt, cleared: emitter._deferredEvent === null }));
		try {
			const states = operations.map((operation, index) => {
				if (operation === 0) { emitter.beginDeferredEmit(); }
				else if (operation === 1) { emitter.endDeferredEmit(selection); }
				else { emitter.fire(event(index + 1)); }
				return { count: emitter._deferredCnt, deferred: emitter._deferredEvent?.contentChangedEvent, listeners: emitter.hasListeners() };
			});
			return { states, received };
		} finally { subscription.dispose(); emitter.dispose(); }
	});
	const expected = run();
	assert.deepStrictEqual(withRust(run), expected);
	assert.deepStrictEqual(withRust(run, true), expected);
});

test('Rust content event delivery clears deferred state before reentrant listeners', () => {
	const run = () => {
		const emitter = new ContentEmitter();
		const received: object[] = [];
		let reentered = false;
		const subscription = emitter.event(value => {
			received.push({ version: value.contentChangedEvent.versionId, count: emitter._deferredCnt, cleared: emitter._deferredEvent === null });
			if (!reentered) { reentered = true; emitter.beginDeferredEmit(); emitter.fire(event(9)); emitter.endDeferredEmit(); }
		});
		try { emitter.beginDeferredEmit(); emitter.fire(event(1)); emitter.endDeferredEmit(); return received; }
		finally { subscription.dispose(); emitter.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust content events retain counter coercions, field getter order, and raw listener results', () => {
	const run = () => [NaN, Infinity, -Infinity, -0, 0.5, '1', 1n, null, undefined].map(initial => {
		const emitter = new ContentEmitter();
		const trace: string[] = [];
		Reflect.set(emitter, '_deferredCnt', initial);
		const opaque = {};
		emitter._emitter.hasListeners = () => opaque as boolean;
		const proxy = new Proxy(emitter, {
			get: (value, key, receiver) => { if (['_deferredCnt', '_deferredEvent', '_emitter'].includes(String(key))) { trace.push('get:' + String(key)); } return Reflect.get(value, key, receiver); },
			set: (value, key, replacement, receiver) => { trace.push('set:' + String(key)); return Reflect.set(value, key, replacement, receiver); }
		});
		try { proxy.beginDeferredEmit(); proxy.endDeferredEmit(); return { count: emitter._deferredCnt, trace, listenerIdentity: proxy.hasListeners() === opaque }; }
		finally { emitter.dispose(); }
	});
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust content event merge, selection, and delivery failures preserve exact partial state', () => {
	const failure = new Error('Original content event callback failure');
	const run = () => ['merge', 'selection', 'fire'].map(kind => {
		const emitter = new ContentEmitter();
		const first = event(1);
		emitter.beginDeferredEmit(); emitter.fire(first);
		if (kind === 'merge') { first.merge = () => { throw failure; }; }
		else if (kind === 'selection') { Object.defineProperty(first.rawContentChangedEvent, 'resultingSelection', { configurable: true, set: () => { throw failure; } }); }
		else { emitter._emitter.fire = () => { throw failure; }; }
		try {
			assert.throws(() => kind === 'merge' ? emitter.fire(event(2)) : emitter.endDeferredEmit(), error => error === failure);
			return { count: emitter._deferredCnt, retained: emitter._deferredEvent === first };
		} finally { emitter.dispose(); }
	});
	assert.deepStrictEqual(withRust(run), run());
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust content emitter ownership releases on disposal and preserves held/frozen descriptors', () => {
	const emitter = withRust(() => {
		const baseline = rust.bracket_node_metadata_live_count();
		const emitter = new ContentEmitter();
		assert.strictEqual(rust.bracket_node_metadata_live_count(), baseline + 1);
		emitter.beginDeferredEmit(); emitter.fire(event(1));
		return emitter;
	}, true);
	emitter.endDeferredEmit();
	emitter.dispose();
	assert.strictEqual(Object.isExtensible(emitter), true);
	Object.freeze(emitter);
	assert.deepStrictEqual(Object.getOwnPropertyDescriptor(emitter, '_deferredCnt'), { value: 0, writable: false, enumerable: true, configurable: false });
	assert.throws(() => emitter.beginDeferredEmit(), TypeError);
});

function cyclicEmitter(): [WeakRef<object>, WeakRef<object>] {
	const emitter = new ContentEmitter();
	const value = event(1);
	Object.assign(value, { owner: emitter });
	emitter.beginDeferredEmit(); emitter.fire(value);
	return [new WeakRef(emitter), new WeakRef(value)];
}

test('Rust deferred content event reference cycles remain collector visible', async () => {
	const registration = registerRustTextBuffer(rust);
	try {
		for (let attempt = 0; attempt < 8; attempt++) { await setTimeout(0); globalThis.gc?.(); }
		await setTimeout(0);
		const baseline = rust.bracket_node_metadata_live_count();
		const references = cyclicEmitter();
		for (let attempt = 0; attempt < 64; attempt++) {
			await setTimeout(0); globalThis.gc?.();
			if (references.every(reference => reference.deref() === undefined) && rust.bracket_node_metadata_live_count() === baseline) { return; }
		}
		assert.deepStrictEqual([references.map(reference => reference.deref() === undefined), rust.bracket_node_metadata_live_count()], [[true, true], baseline]);
	} finally { registration.dispose(); }
});

test('Rust content event control executes every operation and rejects stale core bindings atomically', () => {
	const calls = new Set<number>();
	const module: IRustModelContentEventsModule = { ...rust, run_model_content_events: (...args) => { calls.add(args[1]); return rust.run_model_content_events(...args); } };
	withRust(() => {
		const emitter = new ContentEmitter();
		try { emitter.hasListeners(); emitter.beginDeferredEmit(); emitter.fire(event(1)); emitter.endDeferredEmit(); }
		finally { emitter.dispose(); }
	}, false, module);
	assert.deepStrictEqual([...calls].sort(), [0, 1, 2, 3]);
	assert.throws(() => registerRustTextBuffer({ ...rust, model_content_events_abi_version: () => 0 }), /deferred contract/);
	assert.strictEqual(tryRustModelContentEvents(RustModelContentEventsOperation.Begin, null, () => { throw new Error('Unavailable content events must not create a host'); }), undefined);
	const registration = registerRustModelContentEvents(rust);
	try { assert.throws(() => registerRustModelContentEvents(rust), /already registered/); }
	finally { registration.dispose(); }
});
