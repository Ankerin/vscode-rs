/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { TextEditInfo } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/beforeEditPositionMapper.js';
import { combineTextEditInfos } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/combineTextEditInfos.js';
import { Length, lengthAdd, lengthOfString, lengthToObj } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/length.js';
import { IRustBracketEditsModule, registerRustBracketEdits } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketEdits.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { tryCountRustEOL } from '../../src/vs/editor/common/core/rustTextShape.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustBracketEditsModule = rust): T {
	const registration = registerRustBracketEdits(module);
	try { return compute(); } finally { registration.dispose(); }
}

function textOffset(text: string, length: Length): number {
	const coordinate = lengthToObj(length);
	let offset = 0;
	for (let line = 0; line < coordinate.lineCount; line++) { offset = text.indexOf('\n', offset) + 1; }
	return offset + coordinate.columnCount;
}

test('Rust bracket edit composition preserves seeded multiline streams, edit prototypes, and document reconstruction', () => {
	let seed = 911;
	let calls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const module: IRustBracketEditsModule = { ...rust, combine_bracket_edits: (first, second) => { calls++; return rust.combine_bracket_edits(first, second); } };
	const alphabet = ['a', 'b', '\n', '\uD800', '\uDC00', '\uD83D\uDE00'];
	const newText = () => Array.from({ length: random(16) }, () => alphabet[random(alphabet.length)]).join('');
	for (let trace = 0; trace < 2048; trace++) {
		const original = newText().repeat(8);
		let text = original;
		let reference: TextEditInfo[] = [];
		let actual: TextEditInfo[] = [];
		for (let step = 0; step < 8; step++) {
			const edits: TextEditInfo[] = [];
			const replacements: { start: number; end: number; text: string }[] = [];
			let cursor = 0;
			for (let edit = 0, count = 1 + random(8); edit < count; edit++) {
				const start = cursor + random(text.length - cursor + 1);
				const end = start + random(text.length - start + 1);
				const inserted = newText();
				edits.push(new TextEditInfo(lengthOfString(text.slice(0, start)), lengthOfString(text.slice(0, end)), lengthOfString(inserted)));
				replacements.push({ start, end, text: inserted });
				cursor = end;
			}
			for (let index = replacements.length - 1; index >= 0; index--) {
				const replacement = replacements[index];
				text = text.slice(0, replacement.start) + replacement.text + text.slice(replacement.end);
			}
			reference = combineTextEditInfos(reference, edits);
			actual = withRust(() => combineTextEditInfos(actual, edits), module);
			assert.deepStrictEqual(actual, reference, `Bracket edit stream ${trace}/${step}`);
			let restored = text;
			for (const edit of actual) {
				const start = textOffset(restored, edit.startOffset);
				const end = textOffset(restored, lengthAdd(edit.startOffset, edit.newLength));
				restored = restored.slice(0, start) + original.slice(textOffset(original, edit.startOffset), textOffset(original, edit.endOffset)) + restored.slice(end);
			}
			assert.strictEqual(restored, original, `Bracket reconstruction ${trace}/${step}`);
		}
	}
	assert.ok(calls >= 14000, 'Supported nonempty compositions use the integrated native kernel');
});

test('Rust bracket edit composition retains empty-input identity and unsupported numeric fallback', () => {
	const edit = new TextEditInfo(1 as never, 2 as never, 3 as never);
	const input = [edit];
	assert.deepStrictEqual(withRust(() => [combineTextEditInfos([], input) === input, combineTextEditInfos(input, []) === input]), [true, true]);
	for (const value of [-8, -0, 0.5, 1, 2 ** 52, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY]) {
		const first = [new TextEditInfo(0 as never, 2 as never, value as never)];
		const second = [new TextEditInfo(1 as never, 3 as never, 4 as never)];
		assert.deepStrictEqual(withRust(() => combineTextEditInfos(first, second)), combineTextEditInfos(first, second));
	}
});

test('Rust bracket edit composition preserves provider iteration, accessor reads, proxy traps, and fallback without rereading', () => {
	const run = (unsupported: boolean) => {
		const observations: string[] = [];
		const create = (name: string, start: number, end: number) => new Proxy(new TextEditInfo(start as never, end as never, 2 as never), {
			get: (target, key, receiver) => { observations.push(`${name}:get:${String(key)}`); return Reflect.get(target, key, receiver); },
			getOwnPropertyDescriptor: (target, key) => { observations.push(`${name}:descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); }
		});
		const first = [create('first', 2, 4)];
		const second = [create('second', 3, 5)];
		Object.defineProperty(first[0], 'newLength', { get: () => { observations.push('first:accessor'); return unsupported ? 2.5 : 2; } });
		Object.defineProperty(first, Symbol.iterator, { value: () => { observations.push('first:iterator'); return first.values(); } });
		return { edits: combineTextEditInfos(first, second), observations };
	};
	for (const unsupported of [false, true]) { assert.deepStrictEqual(withRust(() => run(unsupported)), run(unsupported)); }
});

test('Rust bracket edit composition retains callback-installed mapping prototypes and original split failures', () => {
	const failure = new Error('Original bracket mapping split failure');
	const push = Object.getOwnPropertyDescriptor(Array.prototype, 'push')!;
	const run = () => {
		let intercepted = false;
		const first = [new TextEditInfo(2 as never, 4 as never, 3 as never)];
		const second = [new TextEditInfo(3 as never, 5 as never, 1 as never)];
		Object.defineProperty(second[0], 'newLength', { get: () => { Object.defineProperty(Array.prototype, 'push', push); return 1; } });
		Object.defineProperty(Array.prototype, 'push', {
			...push, value: function (this: object[], ...items: object[]) {
				for (const item of items) {
					if (!intercepted && Object.hasOwn(item, 'lengthBefore')) {
						intercepted = true;
						Object.setPrototypeOf(item, { splitAt: () => { throw failure; } });
					}
				}
				return Reflect.apply(push.value, this, items);
			}
		});
		try { assert.throws(() => combineTextEditInfos(first, second), error => error === failure); }
		finally { Object.defineProperty(Array.prototype, 'push', push); }
		return intercepted;
	};
	assert.deepStrictEqual([withRust(run), run()], [true, true]);
});

test('Rust bracket edit registration rejects malformed packets and rolls back the complete core lifetime', () => {
	const run = () => combineTextEditInfos([new TextEditInfo(1 as never, 2 as never, 3 as never)], [new TextEditInfo(2 as never, 3 as never, 1 as never)]);
	for (const packet of [new Float64Array(3), new Float64Array([0, 1, 1, 2]), new Float64Array([0, 1, Number.NaN, 0])]) {
		assert.throws(() => withRust(run, { ...rust, combine_bracket_edits: () => packet }), /bracket edit result/);
	}
	assert.strictEqual(rust.combine_bracket_edits(new Float64Array(2), new Float64Array(3)), undefined);
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_edits_abi_version: () => 0 }), /composition contract/);
	assert.strictEqual(tryCountRustEOL('a\nb'), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketEdits(rust), /already registered/); } finally { registration.dispose(); }
	assert.strictEqual(tryCountRustEOL('a\nb'), undefined);
});
