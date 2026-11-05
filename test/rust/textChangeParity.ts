/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { createRustUndoChangeBatch, decodeRustTextChanges, IRustTextChangeModule, registerRustTextChanges, tryCompressRustTextChanges } from '../../src/vs/editor/common/core/rustTextChanges.js';
import { compressConsecutiveTextChanges, TextChange } from '../../src/vs/editor/common/core/textChange.js';
import { decodeUTF16LELossless } from '../../src/vs/editor/common/core/utf16Transfer.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { SingleModelEditStackData } from '../../src/vs/editor/common/model/editStack.js';
import { EndOfLineSequence } from '../../src/vs/editor/common/model.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { Range } from '../../src/vs/editor/common/core/range.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustTextChangeModule = rust): T {
	const registration = registerRustTextChanges(module);
	try {
		return compute();
	} finally {
		registration.dispose();
	}
}

function applyChanges(text: string, changes: TextChange[], inverse: boolean = false): string {
	for (let index = changes.length - 1; index >= 0; index--) {
		const change = changes[index];
		const position = inverse ? change.newPosition : change.oldPosition;
		const length = inverse ? change.newLength : change.oldLength;
		text = text.slice(0, position) + (inverse ? change.oldText : change.newText) + text.slice(position + length);
	}
	return text;
}

test('Rust undo composition preserves exact seeded changes and reconstructs both document versions', () => {
	let seed = 43;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const alphabet = ['a', 'b', '\r', '\n', '\uFEFF', '\uFFFE', '\uD800', '\uDC00', '\uD83D\uDE00'];
	const createText = (limit: number) => Array.from({ length: random(limit) }, () => alphabet[random(alphabet.length)]).join('');
	const createChanges = (text: string) => {
		const changes: TextChange[] = [];
		let cursor = 0;
		let delta = 0;
		const count = 1 + random(8);
		for (let index = 0; index < count; index++) {
			const position = cursor + random(text.length - cursor + 1);
			const length = random(text.length - position + 1);
			const inserted = createText(16);
			changes.push(new TextChange(position, text.slice(position, position + length), position + delta, inserted));
			delta += inserted.length - length;
			cursor = position + length;
		}
		return changes;
	};
	for (let iteration = 0; iteration < 2048; iteration++) {
		const original = createText(128);
		const previous = createChanges(original);
		const intermediate = applyChanges(original, previous);
		const current = createChanges(intermediate);
		const modified = applyChanges(intermediate, current);
		const reference = compressConsecutiveTextChanges(previous, current);
		const actual = withRust(() => compressConsecutiveTextChanges(previous, current));
		const direct = withRust(() => tryCompressRustTextChanges(previous, current));
		const owned = withRust(() => {
			const batch = createRustUndoChangeBatch(previous);
			assert.ok(batch);
			try {
				assert.ok(batch.append(current));
				return decodeRustTextChanges(batch.serialize().bytes);
			} finally {
				batch.dispose();
			}
		});
		const data = reference.map(change => ({ oldPosition: change.oldPosition, oldText: change.oldText, newPosition: change.newPosition, newText: change.newText }));
		assert.deepStrictEqual({ actual, direct, owned, modified: applyChanges(original, actual), original: applyChanges(modified, actual, true) }, { actual: reference, direct: data, owned: data, modified, original }, `Undo composition ${iteration}`);
		if (iteration % 8 === 0) {
			const batch = withRust(() => createRustUndoChangeBatch(previous));
			assert.ok(batch);
			try {
				let reference = previous;
				let text = intermediate;
				for (let append = 0; append < 16; append++) {
					const changes = createChanges(text);
					text = applyChanges(text, changes);
					assert.ok(batch.append(changes));
					const actual = decodeRustTextChanges(batch.serialize().bytes);
					reference = compressConsecutiveTextChanges(reference, changes);
					assert.deepStrictEqual(actual, reference.map(change => ({ oldPosition: change.oldPosition, oldText: change.oldText, newPosition: change.newPosition, newText: change.newText })), `Undo stream ${iteration}/${append}`);
					assert.deepStrictEqual({ text: applyChanges(original, reference), original: applyChanges(text, reference, true) }, { text, original });
				}
			} finally {
				batch.dispose();
			}
		}
	}
});

test('Rust owning undo batches append only new text and release on serialization and materialization', () => {
	const model = createTextModel('');
	const create = () => new SingleModelEditStackData(1, 1, EndOfLineSequence.LF, EndOfLineSequence.LF, null, null, []);
	let frees = 0;
	let transfers = 0;
	class CountedBatch extends rust.WasmUndoChangeBatch {
		public override append(ranges: Uint32Array, units: Uint16Array): boolean { transfers += units.length; return super.append(ranges, units); }
		public override free(): void { frees++; super.free(); }
	}
	try {
		const reference = create();
		for (let index = 0; index < 1000; index++) {
			reference.append(model, [new TextChange(index, '', index, 'a')], EndOfLineSequence.LF, index + 2, null);
		}
		const expected = reference.serialize();
		withRust(() => {
			const data = create();
			for (let index = 0; index < 1000; index++) {
				data.append(model, [new TextChange(index, '', index, 'a')], EndOfLineSequence.LF, index + 2, null);
			}
			assert.deepStrictEqual({ bytes: data.serialize(), frees, transfers }, { bytes: expected, frees: 1, transfers: 1000 });
			assert.deepStrictEqual(data.changes, reference.changes);
			data.append(model, [new TextChange(1000, '', 1000, 'b')], EndOfLineSequence.LF, 1002, null);
			data.releaseResources();
			assert.strictEqual(frees, 2);
			assert.strictEqual(data.changes[0].newText, 'a'.repeat(1000) + 'b');
			data.append(model, [new TextChange(1001, '', 1001, 'c')], EndOfLineSequence.LF, 1003, null);
			assert.deepStrictEqual({ text: data.changes[0].newText, frees }, { text: 'a'.repeat(1000) + 'bc', frees: 3 });
		}, { ...rust, WasmUndoChangeBatch: CountedBatch });
	} finally {
		model.dispose();
	}
});

test('Rust owning undo batches preserve repeated aligned replacements and contained fragmented edits', () => {
	const payload = 'a\uD800\uFEFF\uD83D\uDE00'.repeat(2048);
	const fixtures = [
		{
			previous: Array.from({ length: 128 }, (_, index) => new TextChange(index * 4, 'a', index * 5, 'xy')),
			current: Array.from({ length: 128 }, (_, index) => new TextChange(index * 5, 'xy', index * 4, 'z'))
		},
		{
			previous: [new TextChange(3, 'original', 3, payload)],
			current: Array.from({ length: 128 }, (_, index) => new TextChange(3 + index * 48, payload.slice(index * 48, index * 48 + 6), 3 + index * 49, 'changed'))
		}
	];
	for (const { previous, current } of fixtures) {
		const inverse = current.map(change => new TextChange(change.newPosition, change.newText, change.oldPosition, change.oldText));
		const batch = withRust(() => createRustUndoChangeBatch(previous));
		assert.ok(batch);
		try {
			let reference = previous;
			for (let index = 0; index < 32; index++) {
				const changes = index % 2 === 0 ? current : inverse;
				reference = compressConsecutiveTextChanges(reference, changes);
				assert.ok(batch.append(changes));
				assert.deepStrictEqual(decodeRustTextChanges(batch.serialize().bytes), reference.map(change => ({ oldPosition: change.oldPosition, oldText: change.oldText, newPosition: change.newPosition, newText: change.newText })));
			}
		} finally {
			batch.dispose();
		}
	}
});

test('Rust open undo state is released on history replacement and model disposal', () => {
	let frees = 0;
	class CountedBatch extends rust.WasmUndoChangeBatch {
		public override free(): void { frees++; super.free(); }
	}
	const registration = registerRustTextBuffer({ ...rust, WasmUndoChangeBatch: CountedBatch });
	const model = createTextModel('');
	try {
		model.pushEditOperations(null, [{ range: new Range(1, 1, 1, 1), text: 'a' }], null);
		model.setValue('b');
		assert.strictEqual(frees, 1);
		model.pushEditOperations(null, [{ range: new Range(1, 2, 1, 2), text: 'c' }], null);
		model.dispose();
		assert.strictEqual(frees, 2);
	} finally {
		model.dispose();
		registration.dispose();
	}
});

test('Rust undo composition preserves serialized bytes, empty-batch identity, fallback, and registration rollback', () => {
	const previous = [new TextChange(2, '\uD800', 2, '\uDC00')];
	const current = [new TextChange(3, '', 3, '\uFEFF\uD83D\uDE00')];
	const reference = compressConsecutiveTextChanges(previous, current);
	const bytes = new Uint8Array(reference.reduce((length, change) => length + change.writeSize(), 0));
	let offset = 0;
	for (const change of reference) {
		offset = change.write(bytes, offset);
	}
	let nativeBytes: Uint8Array | undefined;
	assert.deepStrictEqual(withRust(() => compressConsecutiveTextChanges(previous, current), { ...rust, compress_changes: (...args) => { nativeBytes = rust.compress_changes(...args); return nativeBytes; } }), reference);
	assert.deepStrictEqual(nativeBytes, bytes);
	for (const previous of [null, []]) {
		assert.strictEqual(withRust(() => compressConsecutiveTextChanges(previous, current), { ...rust, compress_changes: () => { throw new Error('Unexpected empty-batch call'); } }), current);
	}
	assert.deepStrictEqual(withRust(() => compressConsecutiveTextChanges(previous, current), { ...rust, compress_changes: () => undefined }), reference);
	const large = [new TextChange(0x100000000, '', 0x100000000, 'a')];
	assert.strictEqual(withRust(() => tryCompressRustTextChanges(large, current)), undefined);
	assert.throws(() => registerRustTextBuffer({ ...rust, text_change_abi_version: () => 0 }), /undo contract/);
	const registration = registerRustTextBuffer(rust);
	registration.dispose();
	assert.strictEqual(tryCompressRustTextChanges(previous, current), undefined);
	assert.throws(() => rust.compress_changes(new Uint32Array([0]), new Uint32Array(), new Uint16Array()), /range/i);
	assert.throws(() => rust.compress_changes(new Uint32Array([0, 0, 2, 0, 0, 0]), new Uint32Array(), new Uint16Array([97])), /range/i);
	assert.strictEqual(rust.compress_changes(new Uint32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), new Uint32Array(), new Uint16Array([97])), undefined);
	assert.strictEqual(withRust(() => tryCompressRustTextChanges(previous, current), { ...rust, compress_changes: () => new Uint8Array([0]) }), undefined);
	assert.strictEqual(decodeUTF16LELossless(new Uint8Array([0, 0, 216, 255, 254]), 1, 2), '\uD800\uFEFF');
});
