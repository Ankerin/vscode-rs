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
import { AtomicTabMoveOperations, Direction } from '../../src/vs/editor/common/cursor/cursorAtomicMoveOperations.js';
import { WordOperations } from '../../src/vs/editor/common/cursor/cursorWordOperations.js';
import { Position } from '../../src/vs/editor/common/core/position.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';

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

test('Rust atomic tabs preserve full indentation, strict positions, midpoint ties, and exceptional numeric directions', () => {
	let seed = 911;
	let whitespaceCalls = 0;
	let positionCalls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const sizes = [1, 2, 4, 8, 0, -0, 1.5, -2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_VALUE, Number.MIN_VALUE];
	const directions: Direction[] = [Direction.Left, Direction.Right, Direction.Nearest, -1, 3, 0.5, Number.NaN, Number.POSITIVE_INFINITY];
	const module: IRustCursorColumnsModule = {
		...rust,
		cursor_whitespace_column: (text, position, size) => { whitespaceCalls++; return rust.cursor_whitespace_column(text, position, size); },
		cursor_atomic_position: (text, position, size, direction) => { positionCalls++; return rust.cursor_atomic_position(text, position, size, direction); }
	};
	for (let trace = 0; trace < 2048; trace++) {
		const text = Array.from({ length: random(48) }, () => random(4) === 0 ? '\t' : ' ').join('') + ['', 'text', '\uD800\uDC00', '\r\n', '\u00A0'][trace % 5];
		const positions = [-3, -0, 0, 0.5, 1, random(text.length + 5), text.length, text.length + 1, Number.NaN, Number.POSITIVE_INFINITY];
		const size = sizes[trace % sizes.length];
		const run = () => positions.map(position => ({
			whitespace: AtomicTabMoveOperations.whitespaceVisibleColumn(text, position, size),
			positions: directions.map(direction => AtomicTabMoveOperations.atomicPosition(text, position, size, direction))
		}));
		assert.deepStrictEqual(withRust(run, module), run(), `Atomic tab trace ${trace}`);
	}
	assert.deepStrictEqual([whitespaceCalls, positionCalls], [20480, 163840], 'Both public atomic-tab entry points use the native implementations');
});

test('Rust atomic tabs preserve base-class callbacks, string accessors, subclass and detached calls, and fallback domains', () => {
	class CustomAtomicTabs extends AtomicTabMoveOperations { }
	Object.defineProperty(CustomAtomicTabs, 'whitespaceVisibleColumn', { value: () => { throw new Error('Subclass callback must not be called'); } });
	const detached = AtomicTabMoveOperations.atomicPosition;
	const run = () => [CustomAtomicTabs.atomicPosition('    x', 2, 4, Direction.Left), detached('    x', 2, 4, Direction.Nearest)];
	assert.deepStrictEqual(withRust(run), run());
	const failure = new Error('Original atomic tab callback failure');
	const tabStop = Object.getOwnPropertyDescriptor(CursorColumns, 'nextRenderTabStop')!;
	Object.defineProperty(CursorColumns, 'nextRenderTabStop', { configurable: true, get: () => { throw failure; } });
	try {
		assert.throws(() => withRust(() => AtomicTabMoveOperations.whitespaceVisibleColumn('\tx', 1, 4)), error => error === failure);
		assert.throws(() => withRust(() => AtomicTabMoveOperations.atomicPosition('    x', 1, 4, Direction.Right)), error => error === failure);
	} finally { Object.defineProperty(CursorColumns, 'nextRenderTabStop', tabStop); }
	const whitespace = Object.getOwnPropertyDescriptor(AtomicTabMoveOperations, 'whitespaceVisibleColumn')!;
	Object.defineProperty(AtomicTabMoveOperations, 'whitespaceVisibleColumn', { configurable: true, get: () => { throw failure; } });
	try { assert.throws(() => withRust(() => AtomicTabMoveOperations.atomicPosition('', 0, 4, Direction.Left)), error => error === failure); }
	finally { Object.defineProperty(AtomicTabMoveOperations, 'whitespaceVisibleColumn', whitespace); }
	const character = Object.getOwnPropertyDescriptor(String.prototype, 'charCodeAt')!;
	Object.defineProperty(String.prototype, 'charCodeAt', { configurable: true, get: () => { throw failure; } });
	try {
		assert.throws(() => withRust(() => AtomicTabMoveOperations.whitespaceVisibleColumn('    x', 1, 4)), error => error === failure);
		assert.deepStrictEqual(withRust(() => AtomicTabMoveOperations.whitespaceVisibleColumn('text', 0, 4)), [-1, -1, 0]);
	} finally { Object.defineProperty(String.prototype, 'charCodeAt', character); }
	const boxed = Object('    x') as never;
	assert.strictEqual(withRust(() => AtomicTabMoveOperations.atomicPosition(boxed, 2, 4, Direction.Left)), 0);
	assert.strictEqual(rust.cursor_atomic_position('a'.repeat(4 * 1024 * 1024 + 1), 0, 4, 1), undefined);
	assert.throws(() => withRust(() => AtomicTabMoveOperations.whitespaceVisibleColumn('', 0, 4), { ...rust, cursor_whitespace_column: () => new Float64Array(2) }), /whitespace column result/);
	assert.throws(() => withRust(() => AtomicTabMoveOperations.atomicPosition('', 0, 4, Direction.Left), { ...rust, cursor_atomic_position: () => 'invalid' as never }), /atomic position result/);
	assert.throws(() => registerRustTextBuffer({ ...rust, cursor_atomic_position: undefined as never }), /column contract/);
	assert.strictEqual(withRust(() => AtomicTabMoveOperations.atomicPosition('    x', '2' as never, 4, Direction.Left)), -1);
});

test('Rust word parts retain seeded ASCII case and digit boundaries, directional separators, and Unicode text', () => {
	let seed = 113;
	let calls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const parts = ['abc', 'ABC', 'Ab', 'A', '2', '_', '-', ' ', '\t', '\uD800', '\uDC00', '\u0301', '\uD83D\uDE00', 'thisISMixed', 'one_word-Two', '\u4E00'];
	const module: IRustCursorColumnsModule = { ...rust, cursor_word_part_column: (text, column, maximum, right) => { calls++; return rust.cursor_word_part_column(text, column, maximum, right); } };
	for (let trace = 0; trace < 512; trace++) {
		const text = Array.from({ length: 1 + random(24) }, () => parts[random(parts.length)]).join('');
		const model = createTextModel(text);
		try {
			const positions = Array.from({ length: text.length + 1 }, (_, index) => new Position(1, index + 1));
			const run = () => positions.map(position => [WordOperations._moveWordPartLeft(model, position), WordOperations._moveWordPartRight(model, position)]);
			assert.deepStrictEqual(withRust(run, module), run(), `Word part trace ${trace}`);
		} finally { model.dispose(); }
	}
	assert.ok(calls > 10000, 'Existing WordOperations dispatch their same-line word-part scans to Rust');
});

test('Rust word parts retain model callback and position getter order, line-edge identity, and unusual domains', () => {
	const run = () => {
		const model = createTextModel('aB_cD\nsecondLine');
		const reads: string[] = [];
		const content = model.getLineContent;
		Object.defineProperty(model, 'getLineContent', { value: (line: number) => { reads.push(`line:${line}`); return content.call(model, line); } });
		const position = new Position(1, 4);
		Object.defineProperty(position, 'column', { get: () => { reads.push('column'); return 4; } });
		try { return [WordOperations._moveWordPartLeft(model, position), WordOperations._moveWordPartRight(model, position), reads]; }
		finally { model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
	const model = createTextModel('aB_cD\nsecondLine');
	try {
		const start = new Position(1, 1);
		const end = new Position(2, model.getLineMaxColumn(2));
		assert.strictEqual(withRust(() => WordOperations._moveWordPartLeft(model, start)), start);
		assert.strictEqual(withRust(() => WordOperations._moveWordPartRight(model, end)), end);
		for (const column of [-1, -0, 0, 1.5, 3.25, 7, Number.NaN]) {
			const run = () => [WordOperations._moveWordPartLeft(model, new Position(1, column)), WordOperations._moveWordPartRight(model, new Position(1, column))];
			assert.deepStrictEqual(withRust(run), run());
		}
		const failure = new Error('Original word-part string callback failure');
		const character = Object.getOwnPropertyDescriptor(String.prototype, 'charCodeAt')!;
		Object.defineProperty(String.prototype, 'charCodeAt', { configurable: true, get: () => { throw failure; } });
		try { assert.throws(() => withRust(() => WordOperations._moveWordPartLeft(model, new Position(1, 4))), error => error === failure); }
		finally { Object.defineProperty(String.prototype, 'charCodeAt', character); }
		assert.throws(() => withRust(() => WordOperations._moveWordPartLeft(model, new Position(1, 4)), { ...rust, cursor_word_part_column: () => 0 }), /word part result/);
	} finally { model.dispose(); }
	assert.strictEqual(rust.cursor_word_part_column('text', 2.5, 5, false), undefined);
	assert.throws(() => registerRustTextBuffer({ ...rust, cursor_word_part_column: undefined as never }), /column contract/);
});
