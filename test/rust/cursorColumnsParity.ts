/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { getGraphemeBreakType } from '../../src/vs/base/common/strings.js';
import { CursorColumns } from '../../src/vs/editor/common/core/cursorColumns.js';
import { IRustCursorColumnsModule, registerRustCursorColumns, tryComputeRustCursorColumn } from '../../src/vs/editor/common/core/rustCursorColumns.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustCursorColumnsModule = rust): T {
	const registration = registerRustCursorColumns(module);
	try { return compute(); } finally { registration.dispose(); }
}

test('Rust cursor grapheme classification matches every Unicode code point in the original indexed table', () => {
	for (let point = 0; point <= 0x10FFFF; point++) {
		assert.strictEqual(rust.grapheme_break_type(point), getGraphemeBreakType(point), `Grapheme class ${point.toString(16)}`);
	}
});

test('Rust cursor columns preserve seeded UTF-16 prefixes, grapheme rules, widths, tabs, and numeric edge cases', () => {
	let seed = 937;
	let calls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const parts = ['a', '\t', '\r\n', '\uD800', '\uDC00', '\u0301', '\u200D', '\uFE0F', '\u1100\u1161\u11A8', '\u0600', '\u0903', '\u4E00', '\uFF01', '\uD83D\uDE00', '\uD83C\uDDE6\uD83C\uDDE7\uD83C\uDDE8', '\uD83D\uDC69\u200D\uD83D\uDCBB'];
	const sizes = [1, 2, 4, 8, 0, -0, 1.5, -2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_VALUE, Number.MIN_VALUE];
	const module: IRustCursorColumnsModule = { ...rust, cursor_column: (text, column, size, operation) => { calls++; return rust.cursor_column(text, column, size, operation); } };
	for (let trace = 0; trace < 2048; trace++) {
		const text = Array.from({ length: random(48) }, () => parts[random(parts.length)]).join('');
		const positions = [-3, -0, 1, 1.5, 2, random(text.length + 5) + 0.25, text.length + 2, Number.NaN, Number.POSITIVE_INFINITY];
		const size = sizes[trace % sizes.length];
		const run = () => positions.map(column => ({
			visible: CursorColumns.visibleColumnFromColumn(text, column, size),
			statusbar: CursorColumns.toStatusbarColumn(text, column, size),
			column: CursorColumns.columnFromVisibleColumn(text, column, size)
		}));
		assert.deepStrictEqual(withRust(run, module), run(), `Cursor trace ${trace}`);
	}
	assert.strictEqual(calls, 51200, 'Every supported query dispatches natively except the inverse nonpositive shortcut');
});

test('Rust cursor tab stops preserve exceptional numbers, remainders, fractions, and signed zero', () => {
	const values = [-Number.MAX_VALUE, -32, -2.5, -1, -0, 0, 0.25, 1, 2, 7.5, 32, Number.MAX_VALUE, Number.MIN_VALUE, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
	for (const column of values) {
		for (const size of values) {
			const run = () => [CursorColumns.nextRenderTabStop(column, size), CursorColumns.nextIndentTabStop(column, size), CursorColumns.prevRenderTabStop(column, size), CursorColumns.prevIndentTabStop(column, size)];
			assert.deepStrictEqual(withRust(run), run());
		}
	}
});

test('Rust cursor columns retain subclass callbacks, detached static calls, oversize fallback, and atomic registration', () => {
	const failure = new Error('Original cursor subclass callback failure');
	class CustomCursor extends CursorColumns { }
	Object.defineProperty(CustomCursor, '_nextVisibleColumn', { value: () => { throw failure; } });
	assert.throws(() => withRust(() => CustomCursor.visibleColumnFromColumn('a', 2, 4)), error => error === failure);
	assert.throws(() => withRust(() => CustomCursor.columnFromVisibleColumn('a', 1, 4)), error => error === failure);
	const detached = CursorColumns.visibleColumnFromColumn;
	assert.throws(() => withRust(() => detached('a', 2, 4)), TypeError);
	assert.strictEqual(withRust(() => detached('', 2, 4)), 0);
	withRust(() => assert.strictEqual(tryComputeRustCursorColumn('a'.repeat(4 * 1024 * 1024 + 1), 2, 4, 0), undefined));
	assert.strictEqual(rust.cursor_column('text', 2, 4, 3), undefined);
	assert.throws(() => withRust(() => CursorColumns.visibleColumnFromColumn('a', 2, 4), { ...rust, cursor_column: () => 'invalid' as never }), /cursor column result/);
	assert.throws(() => registerRustTextBuffer({ ...rust, cursor_columns_abi_version: () => 0 }), /column contract/);
	assert.strictEqual(tryComputeRustCursorColumn('a', 2, 4, 0), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustCursorColumns(rust), /already registered/); } finally { registration.dispose(); }
	assert.strictEqual(tryComputeRustCursorColumn('a', 2, 4, 0), undefined);
});
