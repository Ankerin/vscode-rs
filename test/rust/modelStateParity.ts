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
import { Disposable, DisposableTracker, setDisposableTracker, toDisposable } from '../../src/vs/base/common/lifecycle.js';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { TextModel } from '../../src/vs/editor/common/model/textModel.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { ownRustTextModel, releaseRustTextModel } from '../../src/vs/editor/common/model/rustModelState.js';
import { registerRustBracketNodeMetadata, rustTextModelStateFields } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketNodeMetadata.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }
interface IModelOwners {
	_bracketPairs: { textModel: TextModel };
	_guidesTextModelPart: { textModel: TextModel };
	_tokenizationTextModelPart: { _textModel: TextModel };
	_commandManager: { _model: TextModel };
}
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, core = false): T {
	const registration = core ? registerRustTextBuffer(rust) : registerRustBracketNodeMetadata(rust);
	try { return compute(); } finally { registration.dispose(); }
}

test('Rust model ownership starts before derived fields, callbacks, and disposal tracking', () => {
	const tracker = new DisposableTracker();
	setDisposableTracker(tracker);
	try {
		withRust(() => {
			const baseline = rust.bracket_node_metadata_live_count();
			let allocated: object | undefined;
			let disposedOwner: object | undefined;
			class Probe extends Disposable {
				_versionId = 1;
				_buffer = { owner: this };
				owner = () => this;
				constructor() {
					super(instance => { allocated = instance; return ownRustTextModel(instance); });
					this._register(toDisposable(() => { disposedOwner = this; }));
				}
			}
			const probe = new Probe();
			assert.deepStrictEqual([probe === allocated, probe.owner() === probe, probe._buffer.owner === probe, Reflect.ownKeys(allocated!), Object.getOwnPropertyDescriptor(probe, '_versionId')], [false, true, true, ['owner'], { value: 1, writable: true, enumerable: true, configurable: true }]);
			assert.strictEqual(rust.bracket_node_metadata_live_count(), baseline + 1);
			probe.dispose();
			releaseRustTextModel(probe);
			assert.deepStrictEqual([disposedOwner === probe, rust.bracket_node_metadata_live_count(), Object.isExtensible(probe), probe.owner() === probe, Object.getOwnPropertyDescriptor(probe, '_versionId')?.value], [true, baseline, true, true, 1]);
		});
		assert.strictEqual(tracker.computeLeakingDisposables(), undefined);
	} finally { setDisposableTracker(null); }
});

test('Rust models retain every constructed property, service identity, observer, and field descriptor', () => {
	const run = () => {
		const model = createTextModel('alpha\nbeta');
		const internal = model as unknown as IModelOwners;
		const keys = Reflect.ownKeys(model);
		const trace: object[] = [];
		const content = model.onDidChangeContent(event => trace.push({ changes: event.changes, version: model.getVersionId() }));
		const decorations = model.onDidChangeDecorations(event => trace.push({ ...event }));
		try {
			assert.deepStrictEqual([internal._bracketPairs.textModel, internal._guidesTextModelPart.textModel, internal._tokenizationTextModelPart._textModel, internal._commandManager._model], [model, model, model, model]);
			model.applyEdits([{ range: new Range(1, 1, 1, 1), text: 'x' }]);
			model.deltaDecorations([], [{ range: new Range(1, 1, 1, 2), options: { description: 'Rust model state parity', inlineClassName: 'state-parity' } }]);
			model.updateOptions({ tabSize: 8, indentSize: 3 });
			return { keys, descriptor: Object.getOwnPropertyDescriptor(model, '_versionId'), value: model.getValue(), options: model.getFormattingOptions(), trace };
		} finally { content.dispose(); decorations.dispose(); model.dispose(); }
	};
	const expected = run();
	assert.deepStrictEqual([...expected.keys].sort(), [...rustTextModelStateFields].sort());
	assert.deepStrictEqual(withRust(run), expected);
	assert.deepStrictEqual(withRust(run, true), expected);
});

test('Rust model disposal releases owning state while retaining extensibility and formatting reads', () => {
	const model = withRust(() => {
		const model = createTextModel('  alpha');
		const retainedOptions = model.getOptions();
		const before = rust.bracket_node_metadata_live_count();
		model.dispose();
		assert.strictEqual(rust.bracket_node_metadata_live_count(), before - 2);
		assert.strictEqual(Object.isExtensible(model), true);
		assert.throws(() => model.getValue(), /Model is disposed/);
		Object.freeze(retainedOptions);
		return model;
	}, true);
	assert.deepStrictEqual(model.getFormattingOptions(), { tabSize: 4, insertSpaces: true });
	Object.freeze(model);
	assert.strictEqual(Object.getOwnPropertyDescriptor(model, '_isDisposed')?.value, true);
});

test('Rust models constructed under registration remain operational after unregistration', () => {
	const model = withRust(() => createTextModel('alpha'), true);
	try {
		model.applyEdits([{ range: new Range(1, 1, 1, 1), text: 'beta\n' }]);
		model.updateOptions({ tabSize: 2, indentSize: 'tabSize' });
		assert.deepStrictEqual([model.getValue(), model.getVersionId(), model.getFormattingOptions().tabSize, model.findMatches('alpha', null, false, false, null, false).length], ['beta\nalpha', 2, 2, 1]);
	} finally { model.dispose(); }
});

function cyclicProbe(): [WeakRef<object>, WeakRef<object>] {
	class Probe extends Disposable {
		_buffer = { owner: this };
		constructor() { super(ownRustTextModel); }
	}
	const probe = new Probe();
	return [new WeakRef(probe), new WeakRef(probe._buffer)];
}

test('Rust construction-time model records keep facade, store, and reference cycles collectable', async () => {
	const registration = registerRustBracketNodeMetadata(rust);
	try {
		// Settle finalizers from prior model fixtures before measuring this ownership cycle.
		for (let attempt = 0; attempt < 8; attempt++) { await setTimeout(0); globalThis.gc?.(); }
		await setTimeout(0);
		const baseline = rust.bracket_node_metadata_live_count();
		const references = cyclicProbe();
		for (let attempt = 0; attempt < 64; attempt++) {
			await setTimeout(0);
			globalThis.gc?.();
			if (references.every(reference => reference.deref() === undefined) && rust.bracket_node_metadata_live_count() === baseline) { return; }
		}
		assert.deepStrictEqual([references.map(reference => reference.deref() === undefined), rust.bracket_node_metadata_live_count()], [[true, true], baseline]);
	} finally { registration.dispose(); }
});

test('Rust owning model schemas reject preceding metadata bindings before model construction', () => {
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_node_metadata_abi_version: () => 4 }), /owning AST contract/);
	const record = new rust.WasmBracketNodeMetadata(64);
	try { record.define(63, 99, true, true); assert.strictEqual(record.get(63), 99); }
	finally { record.free(); }
});
