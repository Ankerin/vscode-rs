/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import * as strings from '../../src/vs/base/common/strings.js';
import { IRustUnicodeModule, registerRustUnicode, tryComputeRustCodePoint, tryComputeRustGraphemeOffset } from '../../src/vs/base/common/rustUnicode.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustUnicodeModule = rust): T {
	const registration = registerRustUnicode(module);
	try { return compute(); } finally { registration.dispose(); }
}

test('Rust Unicode iterators retain seeded code points, reverse graphemes, surrogate interiors, and original iterator coordinates', () => {
	let seed = 593;
	let codePointCalls = 0;
	let graphemeCalls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const parts = ['a', '\t', '\r\n', '\uD800', '\uDC00', '\u0301', '\u200D', '\uFE0F', '\u1100\u1161\u11A8', '\u0600', '\u0903', '\u4E00', '\uFF01', '\uD83D\uDE00', '\uD83C\uDDE6\uD83C\uDDE7\uD83C\uDDE8', '\uD83D\uDC69\u200D\uD83D\uDCBB'];
	const module: IRustUnicodeModule = {
		...rust,
		unicode_code_point: (text, length, offset, previous) => { codePointCalls++; return rust.unicode_code_point(text, length, offset, previous); },
		unicode_grapheme_offset: (text, offset, previous) => { graphemeCalls++; return rust.unicode_grapheme_offset(text, offset, previous); }
	};
	for (let trace = 0; trace < 2048; trace++) {
		const text = Array.from({ length: 1 + random(32) }, () => parts[random(parts.length)]).join('');
		const offset = random(text.length);
		const run = () => {
			const forward = new strings.CodePointIterator(text, offset);
			const backward = new strings.CodePointIterator(text, offset + 1);
			const next = new strings.GraphemeIterator(text, offset);
			const previous = new strings.GraphemeIterator(text, offset + 1);
			return [
				strings.getNextCodePoint(text, text.length, offset),
				forward.nextCodePoint(), forward.offset, forward.eol(),
				backward.prevCodePoint(), backward.offset,
				next.nextGraphemeLength(), next.offset,
				previous.prevGraphemeLength(), previous.offset,
				strings.nextCharLength(text, offset), strings.prevCharLength(text, offset + 1),
				strings.getCharContainingOffset(text, offset), strings.charCount(text)
			];
		};
		assert.deepStrictEqual(withRust(run, module), run(), `Unicode trace ${trace}`);
	}
	assert.ok(codePointCalls >= 6144 && graphemeCalls >= 12288, 'Public code-point and grapheme APIs dispatch to the native kernels');
});

test('Rust Unicode traversal keeps boundary, fractional, cached-length, boxed-string, and oversize compatibility paths', () => {
	const text = '\uD800\uDC00\u0301\r\na';
	const offsets = [-2, -1, -0, 0, 0.5, 1, text.length - 1, text.length, text.length + 1, Number.POSITIVE_INFINITY];
	for (const offset of offsets) {
		const run = () => {
			const forward = new strings.CodePointIterator(text, offset);
			const backward = new strings.CodePointIterator(text, offset);
			return [forward.nextCodePoint(), forward.offset, backward.prevCodePoint(), backward.offset, strings.nextCharLength(text, offset), strings.prevCharLength(text, offset), strings.getCharContainingOffset(text, offset)];
		};
		assert.deepStrictEqual(withRust(run), run(), `Unicode boundary ${offset}`);
	}
	for (const length of [-1, 0, 1, 1.5, text.length, text.length + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.strictEqual(withRust(() => strings.getNextCodePoint(text, length, 0)), strings.getNextCodePoint(text, length, 0));
	}
	const boxed = Object(text) as never;
	const run = () => [strings.nextCharLength(boxed, 0), strings.prevCharLength(boxed, text.length), strings.charCount(boxed)];
	assert.deepStrictEqual(withRust(run), run());
	withRust(() => {
		assert.strictEqual(tryComputeRustCodePoint('a'.repeat(4 * 1024 * 1024 + 1), 1, 0, false), undefined);
		assert.strictEqual(tryComputeRustGraphemeOffset(text, Number.NaN, false), undefined);
	});
	assert.strictEqual(rust.unicode_code_point(text, text.length, 0, true), undefined);
	assert.strictEqual(rust.unicode_grapheme_offset(text, text.length, false), undefined);
});

test('Rust Unicode traversal preserves live iterator accessors, read-only offsets, subclass callbacks, and proxy trap order', () => {
	const failure = new Error('Original Unicode iterator callback failure');
	class CustomIterator extends strings.GraphemeIterator { }
	const run = () => {
		const subclass = new CustomIterator('a\u0301b');
		return [subclass.nextGraphemeLength(), subclass.offset, subclass.prevGraphemeLength(), subclass.offset];
	};
	assert.deepStrictEqual(withRust(run), run());
	const accessorRun = () => {
		const iterator = new strings.GraphemeIterator('a\u0301b');
		const inner: strings.CodePointIterator = Object.getOwnPropertyDescriptor(iterator, '_iterator')!.value;
		let reads = 0;
		Object.defineProperty(inner, '_str', { configurable: true, get: () => { reads++; return 'a\u0301b'; } });
		const length = iterator.nextGraphemeLength();
		return [length, iterator.offset, reads];
	};
	assert.deepStrictEqual(withRust(accessorRun), accessorRun());
	const readOnly = new strings.GraphemeIterator('a');
	const inner: strings.CodePointIterator = Object.getOwnPropertyDescriptor(readOnly, '_iterator')!.value;
	Object.defineProperty(inner, '_offset', { writable: false });
	assert.throws(() => withRust(() => readOnly.nextGraphemeLength()), TypeError);
	const proxyRun = () => {
		const traps: string[] = [];
		const proxy = new Proxy(new strings.GraphemeIterator('a\u0301b'), {
			get: (target, name, receiver) => { traps.push(String(name)); return Reflect.get(target, name, receiver); },
			getPrototypeOf: target => { traps.push('prototype'); return Reflect.getPrototypeOf(target); }
		});
		const length = proxy.nextGraphemeLength();
		return [length, proxy.offset, traps];
	};
	assert.deepStrictEqual(withRust(proxyRun), proxyRun());
	const method = Object.getOwnPropertyDescriptor(strings.CodePointIterator.prototype, 'nextCodePoint')!;
	Object.defineProperty(strings.CodePointIterator.prototype, 'nextCodePoint', { configurable: true, get: () => { throw failure; } });
	try { assert.throws(() => withRust(() => strings.nextCharLength('a', 0)), error => error === failure); }
	finally { Object.defineProperty(strings.CodePointIterator.prototype, 'nextCodePoint', method); }
	const character = Object.getOwnPropertyDescriptor(String.prototype, 'charCodeAt')!;
	Object.defineProperty(String.prototype, 'charCodeAt', { configurable: true, get: () => { throw failure; } });
	try { assert.throws(() => withRust(() => strings.prevCharLength('a', 1)), error => error === failure); }
	finally { Object.defineProperty(String.prototype, 'charCodeAt', character); }
});

test('Rust Unicode registration validates results and rolls back the owning core atomically', () => {
	assert.throws(() => withRust(() => strings.getNextCodePoint('a', 1, 0), { ...rust, unicode_code_point: () => -1 }), /code point result/);
	assert.throws(() => withRust(() => strings.nextCharLength('a', 0), { ...rust, unicode_grapheme_offset: () => 2 }), /grapheme offset result/);
	assert.throws(() => registerRustTextBuffer({ ...rust, unicode_abi_version: () => 0 }), /iterator contract/);
	assert.strictEqual(tryComputeRustCodePoint('a', 1, 0, false), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustUnicode(rust), /already registered/); } finally { registration.dispose(); }
	assert.strictEqual(tryComputeRustGraphemeOffset('a', 0, false), undefined);
});

test('Rust Unicode Backspace retains seeded emoji components, isolated modifiers, optional joiners, and surrogate interiors', () => {
	let seed = 617;
	let calls = 0;
	let expectedCalls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const parts = ['a', '\r\n', '\uD800', '\uDC00', '\u0301', '\u200D', '\uFE0F', '\u20E3', '1\uFE0F\u20E3', '\uD83C\uDFFB', '\uD83C\uDFFF', '\uD83D\uDE00', '\uD83D\uDC76\uD83C\uDFFE', '\uD83D\uDC68\u200D\uD83D\uDC69\uD83C\uDFFD\u200D\uD83D\uDC67\u200D\uD83D\uDC66'];
	const module: IRustUnicodeModule = { ...rust, unicode_left_delete_offset: (text, offset) => { calls++; return rust.unicode_left_delete_offset(text, offset); } };
	for (let trace = 0; trace < 2048; trace++) {
		const text = Array.from({ length: 1 + random(20) }, () => parts[random(parts.length)]).join('');
		const run = () => Array.from({ length: text.length + 1 }, (_, offset) => strings.getLeftDeleteOffset(offset, text));
		assert.deepStrictEqual(withRust(run, module), run(), `Unicode delete trace ${trace}`);
		expectedCalls += text.length;
	}
	assert.strictEqual(calls, expectedCalls, 'Every supported nonzero Backspace query uses the native implementation');
});

test('Rust Unicode Backspace preserves original callbacks, unusual offsets, and invalid binding results', () => {
	const text = 'a\uD83D\uDE00\uD83C\uDFFD\u200D\uD83D\uDE00\uFE0F';
	for (const offset of [-2, -0, 0, 0.5, 1.5, text.length, text.length + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.strictEqual(withRust(() => strings.getLeftDeleteOffset(offset, text)), strings.getLeftDeleteOffset(offset, text));
	}
	const failure = new Error('Original Backspace callback failure');
	const method = Object.getOwnPropertyDescriptor(strings.CodePointIterator.prototype, 'prevCodePoint')!;
	Object.defineProperty(strings.CodePointIterator.prototype, 'prevCodePoint', { configurable: true, get: () => { throw failure; } });
	try { assert.throws(() => withRust(() => strings.getLeftDeleteOffset(text.length, text)), error => error === failure); }
	finally { Object.defineProperty(strings.CodePointIterator.prototype, 'prevCodePoint', method); }
	assert.strictEqual(withRust(() => strings.getLeftDeleteOffset(0, undefined as never)), 0);
	const boxed = Object(text) as never;
	assert.strictEqual(withRust(() => strings.getLeftDeleteOffset(text.length, boxed)), strings.getLeftDeleteOffset(text.length, boxed));
	assert.strictEqual(rust.unicode_left_delete_offset(text, 0), undefined);
	assert.throws(() => withRust(() => strings.getLeftDeleteOffset(1, 'a'), { ...rust, unicode_left_delete_offset: () => 1 }), /left delete offset/);
	assert.throws(() => registerRustTextBuffer({ ...rust, unicode_left_delete_offset: undefined as never }), /iterator contract/);
});
