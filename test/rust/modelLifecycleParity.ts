/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { IDisposable, DisposableStore } from '../../src/vs/base/common/lifecycle.js';
import { URI } from '../../src/vs/base/common/uri.js';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { IAttachedView, EndOfLineSequence } from '../../src/vs/editor/common/model.js';
import { TextModel } from '../../src/vs/editor/common/model/textModel.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { IRustModelLifecycleModule, registerRustModelLifecycle, RustModelLifecycleOperation, tryRustModelLifecycle } from '../../src/vs/editor/common/model/rustModelLifecycle.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }
interface ILifecycleModel {
	_versionId: number;
	_alternativeVersionId: number;
	_attachedEditorCount: number;
	_isDisposed: boolean;
	__isDisposing: boolean;
	_increaseVersionId(): void;
	_hasListeners(): boolean;
	_assertNotDisposed(): void;
	_commandManager: { releaseResources(): void };
	_tokenizationTextModelPart: { dispose(): void; handleDidChangeAttached(): void; _hasListeners(): boolean };
	_bufferDisposable: IDisposable;
	_undoRedoService: { createSnapshot(resource: URI): NonNullable<ReturnType<TextModel['getInitialUndoRedoSnapshot']>> };
}
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, core = false, module: IRustModelLifecycleModule = rust): T {
	const registration = core ? registerRustTextBuffer(rust) : registerRustModelLifecycle(module);
	try { return compute(); } finally { registration.dispose(); }
}

function state(model: TextModel): object {
	return { version: model.getVersionId(), alternative: model.getAlternativeVersionId(), count: model.getAttachedEditorCount(), attached: model.isAttachedToEditor(), disposed: model.isDisposed(), disposing: model._isDisposing(), flags: [model.isTooLargeForSyncing(), model.isTooLargeForTokenization(), model.isTooLargeForHeapOperation()] };
}

test('Rust model lifecycle preserves seeded versions, attachment events, edits, EOL changes, and disposal', () => {
	let seed = 9923;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const streams = Array.from({ length: 64 }, () => Array.from({ length: 32 }, () => random(6)));
	const run = () => streams.map(operations => {
		const model = createTextModel('abc\ndef');
		const subscriptions = new DisposableStore();
		const views: IAttachedView[] = [];
		const changes: object[] = [];
		subscriptions.add(model.onDidChangeAttached(() => changes.push({ attached: model.isAttachedToEditor(), count: model.getAttachedEditorCount() })));
		subscriptions.add(model.onWillDispose(() => changes.push({ willDispose: true, state: state(model) })));
		try {
			for (const operation of operations) {
				switch (operation) {
					case 0: views.push(model.onBeforeAttached()); break;
					case 1: if (views.length) { model.onBeforeDetached(views.pop()!); } break;
					case 2: model.applyEdits([{ range: new Range(1, 1, 1, 1), text: 'x' }]); break;
					case 3: model.setEOL(EndOfLineSequence.CRLF); break;
					case 4: model._overwriteVersionId(7); break;
					case 5: model._overwriteAlternativeVersionId(3); break;
				}
				changes.push(state(model));
			}
			for (const view of views) { model.onBeforeDetached(view); }
			model.dispose();
			changes.push({ disposed: model.isDisposed(), disposing: model._isDisposing() });
			return changes;
		} finally { subscriptions.dispose(); model.dispose(); }
	});
	const expected = run();
	assert.deepStrictEqual(withRust(run), expected);
	assert.deepStrictEqual(withRust(run, true), expected);
});

test('Rust lifecycle preserves field traps, attachment callbacks, and private version read/write order', () => {
	const run = () => {
		const target = createTextModel('abc');
		const internal = target as unknown as ILifecycleModel;
		const observations: string[] = [];
		const original = internal._tokenizationTextModelPart.handleDidChangeAttached;
		internal._tokenizationTextModelPart.handleDidChangeAttached = () => { observations.push('tokensChanged'); original.call(internal._tokenizationTextModelPart); };
		const model = new Proxy(target, {
			get: (owner, key, receiver) => {
				if (['_versionId', '_alternativeVersionId', '_attachedEditorCount', '_isDisposed', '__isDisposing'].includes(String(key))) { observations.push('get:' + String(key)); }
				return Reflect.get(owner, key, receiver);
			},
			set: (owner, key, value, receiver) => { observations.push('set:' + String(key) + ':' + String(value)); return Reflect.set(owner, key, value, receiver); }
		});
		try {
			const view = model.onBeforeAttached();
			model.onBeforeDetached(view);
			(model as unknown as ILifecycleModel)._increaseVersionId();
			model._overwriteVersionId(9);
			model._overwriteAlternativeVersionId(4);
			return { state: state(model), observations };
		} finally { target.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust lifecycle keeps exceptional numeric fields, readonly partial writes, and snapshot identity', () => {
	const run = () => {
		const model = createTextModel('abc');
		const internal = model as unknown as ILifecycleModel;
		const versions: object[] = [];
		try {
			for (const value of [NaN, Infinity, -0, '2', null, 2n]) {
				internal._versionId = value as number;
				try { internal._increaseVersionId(); versions.push({ value: internal._versionId, alternative: internal._alternativeVersionId }); }
				catch (error) { versions.push({ error: error instanceof Error ? error.name : error, value: internal._versionId }); }
			}
			internal._attachedEditorCount = 2n as unknown as number;
			const view = model.onBeforeAttached();
			const attached = { count: model.getAttachedEditorCount(), value: model.isAttachedToEditor() };
			model.onBeforeDetached(view);
			internal._attachedEditorCount = 0;
			const snapshot = internal._undoRedoService.createSnapshot(model.uri);
			model._overwriteInitialUndoRedoSnapshot(snapshot);
			const identity = model.getInitialUndoRedoSnapshot() === snapshot;
			Object.defineProperty(model, '_alternativeVersionId', { writable: false });
			internal._versionId = 3;
			assert.throws(() => internal._increaseVersionId(), TypeError);
			return { versions, attached, identity, versionAfterFailure: internal._versionId };
		} finally { model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust disposal retains original service failures and exact partially changed flags', () => {
	const failure = new Error('Original lifecycle service failure');
	for (const stage of ['commands', 'tokens', 'buffer'] as const) {
		const run = () => {
			const model = createTextModel('abc');
			const internal = model as unknown as ILifecycleModel;
			const target = stage === 'commands' ? internal._commandManager : stage === 'tokens' ? internal._tokenizationTextModelPart : internal._bufferDisposable;
			const name = stage === 'commands' ? 'releaseResources' : 'dispose';
			const service = target as { releaseResources?(): void; dispose?(): void };
			const original = service[name]!;
			service[name] = () => { throw failure; };
			try {
				assert.throws(() => model.dispose(), error => error === failure);
				return { disposed: internal._isDisposed, disposing: internal.__isDisposing };
			} finally { service[name] = original; model.dispose(); }
		};
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust listener checks preserve short circuits, raw returned values, and reentrant attachment', () => {
	const run = () => {
		const model = createTextModel('abc');
		const internal = model as unknown as ILifecycleModel;
		const subscriptions = new DisposableStore();
		const observations: number[] = [];
		let nested: IAttachedView | undefined;
		subscriptions.add(model.onDidChangeAttached(() => {
			observations.push(model.getAttachedEditorCount());
			if (model.getAttachedEditorCount() === 1) { nested = model.onBeforeAttached(); }
		}));
		internal._tokenizationTextModelPart._hasListeners = () => 7 as unknown as boolean;
		try {
			const listeners = internal._hasListeners();
			const view = model.onBeforeAttached();
			subscriptions.clear();
			model.onBeforeDetached(view);
			if (nested) { model.onBeforeDetached(nested); }
			return { listeners, observations, count: model.getAttachedEditorCount() };
		} finally { subscriptions.dispose(); model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust lifecycle executes all transitions and rejects stale core registration atomically', () => {
	const calls = new Set<number>();
	const module: IRustModelLifecycleModule = { ...rust, run_model_lifecycle: (...args) => { calls.add(args[1]); return rust.run_model_lifecycle(...args); } };
	withRust(() => {
		const model = createTextModel('abc');
		const internal = model as unknown as ILifecycleModel;
		internal._hasListeners(); internal._assertNotDisposed();
		const view = model.onBeforeAttached(); model.onBeforeDetached(view);
		model.isAttachedToEditor(); model.getAttachedEditorCount(); model.isTooLargeForSyncing(); model.isTooLargeForTokenization(); model.isTooLargeForHeapOperation(); model.isDisposed(); model._isDisposing();
		internal._increaseVersionId(); model._overwriteVersionId(3); model._overwriteAlternativeVersionId(2); model._overwriteInitialUndoRedoSnapshot(null); model.dispose();
	}, false, module);
	assert.deepStrictEqual([...calls].sort((first, second) => first - second), Array.from({ length: 16 }, (_, index) => index));
	assert.throws(() => registerRustTextBuffer({ ...rust, model_lifecycle_abi_version: () => 0 }), /transition contract/);
	assert.strictEqual(tryRustModelLifecycle(RustModelLifecycleOperation.Disposed, undefined, () => { throw new Error('Unavailable transitions must not create a host'); }), undefined);
	const registration = registerRustModelLifecycle(rust);
	try { assert.throws(() => registerRustModelLifecycle(rust), /already registered/); } finally { registration.dispose(); }
});

