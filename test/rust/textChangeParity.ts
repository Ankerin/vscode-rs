/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { IRustTextChangeModule, registerRustTextChanges, tryCompressRustTextChanges } from '../../src/vs/editor/common/core/rustTextChanges.js';
import { compressConsecutiveTextChanges, TextChange } from '../../src/vs/editor/common/core/textChange.js';
import { decodeUTF16LELossless } from '../../src/vs/editor/common/core/utf16Transfer.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

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
		assert.deepStrictEqual({ actual, direct, modified: applyChanges(original, actual), original: applyChanges(modified, actual, true) }, { actual: reference, direct: reference.map(change => ({ oldPosition: change.oldPosition, oldText: change.oldText, newPosition: change.newPosition, newText: change.newText })), modified, original }, `Undo composition ${iteration}`);
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
