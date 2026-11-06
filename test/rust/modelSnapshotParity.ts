/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { ITextSnapshot } from '../../src/vs/editor/common/model.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { IRustModelSnapshotModule, registerRustModelSnapshot, tryRustModelSnapshot } from '../../src/vs/editor/common/model/rustModelSnapshot.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }
interface IOwningSnapshot extends ITextSnapshot { _source: ITextSnapshot; _eos: boolean }
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });
const model = createTextModel('template');
const template = model.createSnapshot();
const Snapshot = template.constructor as { new(source: ITextSnapshot): IOwningSnapshot };
while (template.read() !== null) { /* Exhaust the native source before retaining only its constructor. */ }
model.dispose();

function withRust<T>(compute: () => T, core = false, module: IRustModelSnapshotModule = rust): T {
	const registration = core ? registerRustTextBuffer(rust) : registerRustModelSnapshot(module);
	try { return compute(); } finally { registration.dispose(); }
}

test('Rust model snapshots preserve seeded empty chunks, 64-KiB boundaries, EOF state, and repeated terminal reads', () => {
	let seed = 2341;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const cases = Array.from({ length: 128 }, (_, index) => Array.from({ length: 1 + random(24) }, () => index % 4 ? 'x'.repeat(random(8000)) : ['', '\uD800', '\uDC00', 'x'.repeat(65536), 'y'.repeat(65535)][random(5)]));
	const run = () => cases.map(chunks => {
		let index = 0;
		const source: ITextSnapshot = { read: () => index < chunks.length ? chunks[index++] : null };
		const snapshot = new Snapshot(source);
		const result: (string | null)[] = [];
		let value: string | null;
		do { value = snapshot.read(); result.push(value); } while (value !== null);
		result.push(snapshot.read());
		const state = { eos: snapshot._eos, sourceIdentity: snapshot._source === source, index, result };
		Object.freeze(snapshot);
		return state;
	});
	const expected = run();
	assert.deepStrictEqual(withRust(run), expected);
	assert.deepStrictEqual(withRust(run, true), expected);
});

test('Rust snapshot reads preserve source/length/receiver getters and join coercions', () => {
	const run = () => {
		const observations: string[] = [];
		let reads = 0;
		const chunk = {
			get length() { observations.push('length'); return 3; },
			toString: () => { observations.push('string'); return 'abc'; }
		};
		const source: ITextSnapshot = {
			get read() {
				observations.push('readMethod');
				return () => { observations.push('read'); return reads++ === 0 ? chunk as unknown as string : null; };
			}
		};
		const target = new Snapshot(source);
		const snapshot = new Proxy(target, {
			get: (owner, key, receiver) => { observations.push('get:' + String(key)); return Reflect.get(owner, key, receiver); },
			set: (owner, key, value, receiver) => { observations.push('set:' + String(key)); return Reflect.set(owner, key, value, receiver); }
		});
		const value = snapshot.read();
		Object.freeze(target);
		return { value, observations };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust snapshot reads retain source failures, invalid chunks, readonly EOS writes, and consumed state', () => {
	const failure = new Error('Original snapshot source failure');
	const run = () => {
		let index = 0;
		const source: ITextSnapshot = { read: () => { if (index++ === 0) { return 'abc'; } throw failure; } };
		const snapshot = new Snapshot(source);
		assert.throws(() => snapshot.read(), error => error === failure);
		const partial = { eos: snapshot._eos, index };
		Object.freeze(snapshot);
		const frozen = new Snapshot({ read: () => null });
		Object.freeze(frozen);
		assert.throws(() => frozen.read(), TypeError);
		const invalid = new Snapshot({ read: () => undefined as unknown as string });
		assert.throws(() => invalid.read(), TypeError);
		const state = { partial, frozenEos: frozen._eos, invalidEos: invalid._eos };
		Object.freeze(invalid);
		return state;
	};
	assert.deepStrictEqual(withRust(run), run());
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust model snapshots own source handles and EOS fields and materialize frozen descriptors', () => {
	const snapshot = withRust(() => {
		const baseline = rust.bracket_node_metadata_live_count();
		const source: ITextSnapshot = { read: () => null };
		const snapshot = new Snapshot(source);
		assert.deepStrictEqual([rust.bracket_node_metadata_live_count(), Object.getOwnPropertyDescriptor(snapshot, '_source')?.value === source, Object.getOwnPropertyDescriptor(snapshot, '_eos')?.value], [baseline + 1, true, false]);
		snapshot.read();
		Object.freeze(snapshot);
		assert.deepStrictEqual([rust.bracket_node_metadata_live_count(), Object.getOwnPropertyDescriptor(snapshot, '_eos')], [baseline, { value: true, writable: false, enumerable: true, configurable: false }]);
		return snapshot;
	}, true);
	assert.strictEqual(snapshot.read(), null);
	const held = withRust(() => {
		let index = 0;
		return new Snapshot({ read: () => index++ === 0 ? 'held' : null });
	}, true);
	assert.strictEqual(held.read(), 'held');
	Object.freeze(held);
});

function cyclicSnapshot(): [WeakRef<IOwningSnapshot>, WeakRef<ITextSnapshot>] {
	const source: ITextSnapshot & { owner?: IOwningSnapshot } = { read: () => null };
	const snapshot = new Snapshot(source);
	source.owner = snapshot;
	return [new WeakRef(snapshot), new WeakRef(source)];
}

test('Rust owning snapshot source cycles remain visible to the host collector', async () => {
	const registration = registerRustTextBuffer(rust);
	try {
		const baseline = rust.bracket_node_metadata_live_count();
		const references = cyclicSnapshot();
		for (let attempt = 0; attempt < 64; attempt++) {
			await setTimeout(0);
			globalThis.gc?.();
			if (references.every(reference => reference.deref() === undefined) && rust.bracket_node_metadata_live_count() === baseline) { return; }
		}
		assert.deepStrictEqual([references.map(reference => reference.deref() === undefined), rust.bracket_node_metadata_live_count()], [[true, true], baseline]);
	} finally { registration.dispose(); }
});

test('Rust snapshot control executes real reads and rejects stale registration atomically', () => {
	let calls = 0;
	const module: IRustModelSnapshotModule = { ...rust, read_model_snapshot: host => { calls++; return rust.read_model_snapshot(host); } };
	withRust(() => {
		const snapshot = new Snapshot({ read: () => null });
		assert.strictEqual(snapshot.read(), null);
		assert.strictEqual(snapshot.read(), null);
	}, false, module);
	assert.strictEqual(calls, 2);
	assert.throws(() => registerRustTextBuffer({ ...rust, model_snapshot_abi_version: () => 0 }), /streaming contract/);
	assert.strictEqual(tryRustModelSnapshot(() => { throw new Error('Unavailable snapshots must not create a host'); }), undefined);
	const registration = registerRustModelSnapshot(rust);
	try { assert.throws(() => registerRustModelSnapshot(rust), /already registered/); } finally { registration.dispose(); }
});

