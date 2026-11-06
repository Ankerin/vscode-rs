/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { countEOL } from '../../src/vs/editor/common/core/misc/eolCounter.js';
import { normalizeIndentation } from '../../src/vs/editor/common/core/misc/indentation.js';
import { CursorColumns } from '../../src/vs/editor/common/core/cursorColumns.js';
import { IRustTextShapeModule, registerRustTextShape, tryCountRustEOL, tryNormalizeRustIndentation } from '../../src/vs/editor/common/core/rustTextShape.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustTextShapeModule = rust): T {
	const registration = registerRustTextShape(module);
	try { return compute(); } finally { registration.dispose(); }
}

test('Rust string shape preserves seeded CR/LF/CRLF counts and lengths and complete Unicode indentation suffixes', () => {
	let seed = 337;
	let eolCalls = 0;
	let indentCalls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const parts = ['a', '\t', ' ', '\r', '\n', '\r\n', '\uD800', '\uDC00', '\uD83D\uDE00', '\u2028', '\u2029', '\uFEFF'];
	const sizes = [1, 2, 4, 8, 0, -0, 1.5, -2, Number.NaN, Number.MIN_VALUE];
	const module: IRustTextShapeModule = {
		...rust,
		text_eol_count: units => { eolCalls++; return rust.text_eol_count(units); },
		text_normalize_indentation: (text, size, spaces) => { indentCalls++; return rust.text_normalize_indentation(text, size, spaces); }
	};
	for (let trace = 0; trace < 2048; trace++) {
		const text = Array.from({ length: random(80) }, () => parts[random(parts.length)]).join('');
		const prefix = Array.from({ length: random(16) }, () => random(2) === 0 ? '\t' : ' ').join('');
		const size = sizes[trace % sizes.length];
		// Zero/subnormal sizes can produce unbounded original tab loops; preserve those paths without running them.
		const spaces = size === 0 || size === Number.MIN_VALUE || trace % 2 === 0;
		const run = () => [countEOL(text), normalizeIndentation(prefix + text, size, spaces)];
		assert.deepStrictEqual(withRust(run, module), run(), `String shape trace ${trace}`);
	}
	assert.deepStrictEqual([eolCalls, indentCalls], [2048, 2048], 'Both existing public text-shape algorithms dispatch natively');
});

test('Rust indentation retains fractional rounding, exceptional sizes, unsupported output budgets, and original string callbacks', () => {
	for (const size of [1.5, -2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
		const texts = size === Number.POSITIVE_INFINITY ? ['', '   suffix', 'suffix'] : ['', '   suffix', '\t\t suffix', ' \t\uD800suffix'];
		for (const text of texts) {
			const run = () => [normalizeIndentation(text, size, false), normalizeIndentation(text, size, true)];
			assert.deepStrictEqual(withRust(run), run());
		}
	}
	assert.strictEqual(rust.text_normalize_indentation('\t', Number.POSITIVE_INFINITY, true), undefined);
	assert.strictEqual(rust.text_normalize_indentation(' ', 0, false), undefined);
	const failure = new Error('Original indentation callback failure');
	const tabStop = Object.getOwnPropertyDescriptor(CursorColumns, 'nextIndentTabStop')!;
	Object.defineProperty(CursorColumns, 'nextIndentTabStop', { configurable: true, get: () => { throw failure; } });
	try { assert.throws(() => withRust(() => normalizeIndentation('\ttext', 4, true)), error => error === failure); }
	finally { Object.defineProperty(CursorColumns, 'nextIndentTabStop', tabStop); }
	const character = Object.getOwnPropertyDescriptor(String.prototype, 'charAt')!;
	Object.defineProperty(String.prototype, 'charAt', { configurable: true, get: () => { throw failure; } });
	try { assert.throws(() => withRust(() => normalizeIndentation(' text', 4, true)), error => error === failure); }
	finally { Object.defineProperty(String.prototype, 'charAt', character); }
	const boxed = Object(' \t\uD800\r\ntext') as never;
	const run = () => [countEOL(boxed), normalizeIndentation(boxed, 4, false)];
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust text shape rejects stale or malformed bindings and unsupported domains before changing registration', () => {
	withRust(() => {
		assert.strictEqual(tryCountRustEOL('a'.repeat(4 * 1024 * 1024 + 1)), undefined);
		assert.strictEqual(tryNormalizeRustIndentation('text', '4' as never, true), undefined);
	});
	assert.throws(() => withRust(() => countEOL('a'), { ...rust, text_eol_count: () => new Uint32Array(3) }), /EOL count result/);
	assert.throws(() => withRust(() => normalizeIndentation(' a', 4, true), { ...rust, text_normalize_indentation: () => [4, ''] }), /indentation result/);
	assert.throws(() => registerRustTextBuffer({ ...rust, text_shape_abi_version: () => 0 }), /string contract/);
	assert.strictEqual(tryCountRustEOL('a'), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustTextShape(rust), /already registered/); } finally { registration.dispose(); }
	assert.strictEqual(tryNormalizeRustIndentation(' a', 4, true), undefined);
});
