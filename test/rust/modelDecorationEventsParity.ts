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
import { SetWithKey } from '../../src/vs/base/common/collections.js';
import { IModelDecorationsChangedEvent } from '../../src/vs/editor/common/textModelEvents.js';
import { LineFontChangingDecoration, LineHeightChangingDecoration } from '../../src/vs/editor/common/model/decorationProvider.js';
import { ModelDecorationOptions } from '../../src/vs/editor/common/model/textModel.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { IRustModelDecorationEventsModule, registerRustModelDecorationEvents, RustDecorationBeforeFire, RustModelDecorationEventsOperation, rustModelDecorationEventFields, tryRustModelDecorationEvents } from '../../src/vs/editor/common/model/rustModelDecorationEvents.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }
interface IDecorationEmitter extends IDisposable {
	_deferredCnt: number; _shouldFireDeferred: boolean; _affectsMinimap: boolean; _affectsOverviewRuler: boolean; _affectsGlyphMargin: boolean; _affectsLineNumber: boolean;
	_affectedInjectedTextLines: Set<number> | null; _affectedLineHeights: SetWithKey<LineHeightChangingDecoration> | null; _affectedFontLines: SetWithKey<LineFontChangingDecoration> | null;
	handleBeforeFire: RustDecorationBeforeFire;
	_actual: { hasListeners(): boolean; fire(event: IModelDecorationsChangedEvent): void };
	event: Event<IModelDecorationsChangedEvent>;
	hasListeners(): boolean; beginDeferredEmit(): void; endDeferredEmit(): void;
	recordLineAffectedByInjectedText(line: number): void;
	recordLineAffectedByLineHeightChange(owner: number, id: string, line: number, height: number | null): void;
	recordLineAffectedByFontChange(owner: number, id: string, line: number): void;
	checkAffectedAndFire(options: ModelDecorationOptions): void; fire(): void;
}
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });
const probe = createTextModel('');
const DecorationEmitter = (probe as unknown as { _onDidChangeDecorations: object })._onDidChangeDecorations.constructor as new (before: RustDecorationBeforeFire) => IDecorationEmitter;
probe.dispose();

function withRust<T>(compute: () => T, core = false, module: IRustModelDecorationEventsModule = rust): T {
	const registration = core ? registerRustTextBuffer(rust) : registerRustModelDecorationEvents(module);
	try { return compute(); } finally { registration.dispose(); }
}
function state(emitter: IDecorationEmitter): object {
	return { count: emitter._deferredCnt, pending: emitter._shouldFireDeferred, flags: [emitter._affectsMinimap, emitter._affectsOverviewRuler, emitter._affectsGlyphMargin, emitter._affectsLineNumber], injected: emitter._affectedInjectedTextLines ? [...emitter._affectedInjectedTextLines] : null, heights: emitter._affectedLineHeights ? [...emitter._affectedLineHeights].map(value => ({ ...value })) : null, fonts: emitter._affectedFontLines ? [...emitter._affectedFontLines].map(value => ({ ...value })) : null };
}
function options(flags: number): ModelDecorationOptions {
	return ModelDecorationOptions.createDynamic({ description: 'Rust decoration event parity', minimap: flags & 1 ? { color: '#fff', position: 1 } : undefined, overviewRuler: flags & 2 ? { color: '#fff', position: 1 } : undefined, glyphMarginClassName: flags & 4 ? 'glyph' : undefined, lineNumberClassName: flags & 8 ? 'line' : undefined });
}

test('Rust decoration events preserve seeded batching, flags, affected-set order, and deduplication', () => {
	let seed = 6947;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const fixtures = Array.from({ length: 128 }, () => Array.from({ length: 32 }, () => [random(7), random(16), random(5)]));
	const run = () => fixtures.map(operations => {
		const before: object[] = [];
		const received: object[] = [];
		const emitter = new DecorationEmitter((injected, heights, fonts) => before.push({ injected: injected ? [...injected] : null, heights: heights ? [...heights].map(value => ({ ...value })) : null, fonts: fonts ? [...fonts].map(value => ({ ...value })) : null }));
		const subscription = emitter.event(event => received.push({ ...event, state: state(emitter) }));
		try {
			const states = operations.map(([operation, flags, line]) => {
				switch (operation) {
					case 0: emitter.beginDeferredEmit(); break;
					case 1: emitter.endDeferredEmit(); break;
					case 2: emitter.recordLineAffectedByInjectedText(line); break;
					case 3: emitter.recordLineAffectedByLineHeightChange(1, 'height', line, flags); break;
					case 4: emitter.recordLineAffectedByFontChange(1, 'font', line); break;
					case 5: emitter.checkAffectedAndFire(options(flags)); break;
					case 6: emitter.fire(); break;
				}
				return state(emitter);
			});
			return { states, before, received, listeners: emitter.hasListeners() };
		} finally { subscription.dispose(); emitter.dispose(); }
	});
	const expected = run();
	assert.deepStrictEqual(withRust(run), expected);
	assert.deepStrictEqual(withRust(run, true), expected);
});

test('Rust decoration delivery preserves sticky line flags and clears sets after reentrant listeners', () => {
	const run = () => {
		const trace: object[] = [];
		const emitter = new DecorationEmitter(() => trace.push({ before: state(emitter) }));
		let reentered = false;
		const subscription = emitter.event(event => {
			trace.push({ event: { ...event }, state: state(emitter) });
			if (!reentered) { reentered = true; emitter.recordLineAffectedByInjectedText(9); }
		});
		try {
			emitter.beginDeferredEmit(); emitter.recordLineAffectedByInjectedText(1); emitter.checkAffectedAndFire(options(8)); emitter.endDeferredEmit();
			emitter.fire();
			return { trace, final: state(emitter) };
		} finally { subscription.dispose(); emitter.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust decoration flags preserve receiver/getter order, option short circuits, and raw listener values', () => {
	const run = () => {
		const target = new DecorationEmitter(() => { });
		const trace: string[] = [];
		const emitter = new Proxy(target, { get: (value, key, receiver) => { if ([...rustModelDecorationEventFields, 'tryFire', 'doFire', 'handleBeforeFire', '_actual'].includes(String(key))) { trace.push('get:' + String(key)); } return Reflect.get(value, key, receiver); }, set: (value, key, replacement, receiver) => { trace.push('set:' + String(key)); return Reflect.set(value, key, replacement, receiver); } });
		const source = new Proxy(options(15), { get: (value, key, receiver) => { trace.push('option:' + String(key)); return Reflect.get(value, key, receiver); } });
		const opaque = {};
		target._actual.hasListeners = () => opaque as boolean;
		try { emitter.beginDeferredEmit(); emitter.checkAffectedAndFire(source); emitter.checkAffectedAndFire(source); emitter.endDeferredEmit(); return { trace, listenerIdentity: emitter.hasListeners() === opaque, state: state(target) }; }
		finally { target.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust decoration callback and clear failures retain the original partially changed fields', () => {
	const failure = new Error('Original decoration callback failure');
	const run = () => ['before', 'clear', 'fire'].map(kind => {
		const emitter = new DecorationEmitter(() => { if (kind === 'before') { throw failure; } });
		emitter.beginDeferredEmit(); emitter.recordLineAffectedByInjectedText(1); emitter.recordLineAffectedByLineHeightChange(1, 'height', 1, 2); emitter.recordLineAffectedByFontChange(1, 'font', 1); emitter.fire();
		if (kind === 'clear') { emitter._affectedInjectedTextLines!.clear = () => { throw failure; }; }
		if (kind === 'fire') { emitter._actual.fire = () => { throw failure; }; }
		try { assert.throws(() => emitter.endDeferredEmit(), error => error === failure); return state(emitter); }
		finally { emitter.dispose(); }
	});
	assert.deepStrictEqual(withRust(run), run());
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust decoration counters and optional clear retain coercion, strict zero, and readonly behavior', () => {
	const run = () => [NaN, Infinity, -0, 0.5, '1', 1n, null, undefined].map(value => {
		const emitter = new DecorationEmitter(() => { });
		Reflect.set(emitter, '_deferredCnt', value);
		try { emitter.beginDeferredEmit(); emitter.endDeferredEmit(); Object.defineProperty(emitter, '_affectsMinimap', { writable: false }); assert.throws(() => emitter.fire(), TypeError); return state(emitter); }
		finally { emitter.dispose(); }
	});
	assert.deepStrictEqual(withRust(run), run());
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust decoration emitter ownership releases on disposal and preserves held/frozen fields', () => {
	const emitter = withRust(() => {
		const baseline = rust.bracket_node_metadata_live_count();
		const emitter = new DecorationEmitter(() => { });
		assert.strictEqual(rust.bracket_node_metadata_live_count(), baseline + 1);
		emitter.beginDeferredEmit(); emitter.recordLineAffectedByInjectedText(1);
		return emitter;
	}, true);
	emitter.endDeferredEmit(); emitter.dispose();
	assert.strictEqual(Object.isExtensible(emitter), true);
	Object.freeze(emitter);
	assert.deepStrictEqual(Object.getOwnPropertyDescriptor(emitter, '_deferredCnt'), { value: 0, writable: false, enumerable: true, configurable: false });
	assert.throws(() => emitter.beginDeferredEmit(), TypeError);
});

function cyclicEmitter(): [WeakRef<object>, WeakRef<object>] {
	const before = () => { };
	const emitter = new DecorationEmitter(before);
	Object.assign(before, { owner: emitter });
	emitter.recordLineAffectedByInjectedText(1);
	Object.assign(emitter._affectedInjectedTextLines!, { owner: emitter });
	return [new WeakRef(emitter), new WeakRef(before)];
}

test('Rust decoration callback and affected-set cycles remain collector visible', async () => {
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

test('Rust decoration event control executes every operation and rejects stale bindings atomically', () => {
	const calls = new Set<number>();
	const module: IRustModelDecorationEventsModule = { ...rust, run_model_decoration_events: (...args) => { calls.add(args[1]); return rust.run_model_decoration_events(...args); } };
	withRust(() => {
		const emitter = new DecorationEmitter(() => { });
		try { emitter.hasListeners(); emitter.beginDeferredEmit(); emitter.recordLineAffectedByInjectedText(1); emitter.recordLineAffectedByLineHeightChange(1, 'h', 1, 2); emitter.recordLineAffectedByFontChange(1, 'f', 1); emitter.checkAffectedAndFire(options(15)); emitter.fire(); emitter.endDeferredEmit(); }
		finally { emitter.dispose(); }
	}, false, module);
	assert.deepStrictEqual([...calls].sort((first, second) => first - second), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	assert.throws(() => registerRustTextBuffer({ ...rust, model_decoration_events_abi_version: () => 0 }), /deferred contract/);
	assert.strictEqual(tryRustModelDecorationEvents(RustModelDecorationEventsOperation.Begin, null, () => { throw new Error('Unavailable decoration events must not create a host'); }), undefined);
	const registration = registerRustModelDecorationEvents(rust);
	try { assert.throws(() => registerRustModelDecorationEvents(rust), /already registered/); }
	finally { registration.dispose(); }
});
