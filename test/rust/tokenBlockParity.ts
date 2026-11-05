/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { ContiguousMultilineTokens } from '../../src/vs/editor/common/tokens/contiguousMultilineTokens.js';
import { EMPTY_LINE_TOKENS, toUint32Array } from '../../src/vs/editor/common/tokens/contiguousTokensEditing.js';
import { IRustTokensModule, registerRustTokens, tryEditRustContiguousTokenBlock } from '../../src/vs/editor/common/tokens/rustTokens.js';

interface IRustModule extends IRustTokensModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustTokensModule = rust): T {
	const registration = registerRustTokens(module);
	try { return compute(); } finally { registration.dispose(); }
}

/** Keeps provider arrays and backing buffers alive while the block replaces or splices its index. */
class BlockFixture {
	public readonly piece: ContiguousMultilineTokens;
	public readonly source: (Uint32Array | ArrayBuffer | null)[];
	public readonly buffers: Uint32Array[] = [];
	private readonly inputs: Uint32Array[];

	constructor(start: number, lines: number[][]) {
		this.inputs = lines.map(line => {
			const buffer = new Uint32Array(line.length + 8);
			buffer.fill(0xDEADBEEF);
			buffer.set(line, 3);
			this.buffers.push(buffer);
			return buffer.subarray(3, 3 + line.length);
		});
		const source = this.inputs.slice();
		this.source = source;
		this.piece = new ContiguousMultilineTokens(start, source);
	}

	private line(value: Uint32Array | ArrayBuffer | null | undefined) {
		return {
			kind: value === undefined ? 'undefined' : value === null ? 'null' : value === EMPTY_LINE_TOKENS ? 'empty' : value instanceof Uint32Array ? 'view' : 'buffer',
			source: this.inputs.findIndex(input => input === value),
			words: value === undefined || value === null ? null : toUint32Array(value)
		};
	}

	public snapshot() {
		return {
			start: this.piece.startLineNumber, end: this.piece.endLineNumber, range: this.piece.getLineRange(),
			lines: Array.from({ length: this.piece.endLineNumber - this.piece.startLineNumber + 1 }, (_, index) => this.line(this.piece.getLineTokens(this.piece.startLineNumber + index))),
			source: this.source.map(value => this.line(value)), buffers: this.buffers,
			before: this.line(this.piece.getLineTokens(this.piece.startLineNumber - 1)), after: this.line(this.piece.getLineTokens(this.piece.endLineNumber + 1))
		};
	}
}

test('Rust contiguous block edits preserve seeded coordinates, splice/slice aliases, and held buffers', () => {
	let seed = 4717;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	for (let trace = 0; trace < 512; trace++) {
		const lines = Array.from({ length: 1 + random(16) }, () => {
			const ends = Array.from({ length: 1 + random(8) }, () => random(100)).sort((first, second) => first - second);
			ends.push(100);
			return ends.flatMap(end => [end, random(0x100000000)]);
		});
		const start = 1 + random(12);
		const reference = new BlockFixture(start, lines);
		const actual = new BlockFixture(start, lines);
		for (let step = 0; step < 16; step++) {
			const range = new Range(1 + random(36), 1 + random(120), 1 + random(36), 1 + random(120));
			const text = ['', 'a', '\uD800', 'first\r\nlast', '\n', '\r\n\uD83D\uDE00\n'][random(6)];
			const before = reference.piece.getLineTokens(range.startLineNumber);
			const firstWords = before === null || before === undefined ? null : Array.from(toUint32Array(before));
			reference.piece.applyEdit(range, text);
			assert.doesNotThrow(() => withRust(() => actual.piece.applyEdit(range, text)), JSON.stringify({ trace, step, range, text, firstWords }));
			assert.deepStrictEqual(actual.snapshot(), reference.snapshot(), `Block trace ${trace}, operation ${step}`);
		}
	}
});

test('Rust contiguous blocks preserve same-line multiline replacements and absolute insertion positions', () => {
	const module = {
		...rust,
		update_contiguous_tokens: (): never => { throw new Error('Unexpected nested contiguous token binding'); },
		append_contiguous_tokens: (): never => { throw new Error('Unexpected nested concatenation binding'); }
	};
	for (const range of [new Range(5, 3, 5, 7), new Range(1, 2, 5, 3), new Range(5, 4, 10, 3), new Range(1, 1, 20, 1)]) {
		const lines = Array.from({ length: 8 }, (_, index) => [3, index + 1, 6, index + 2, 10, index + 3]);
		const reference = new BlockFixture(5, lines);
		const actual = new BlockFixture(5, lines);
		reference.piece.applyEdit(range, 'first\nlast');
		withRust(() => actual.piece.applyEdit(range, 'first\nlast'), module);
		assert.deepStrictEqual(actual.snapshot(), reference.snapshot());
		const appended = new Uint32Array([4, 7]);
		for (const piece of [reference.piece, actual.piece]) { piece.appendLineTokens(appended); }
		assert.deepStrictEqual(actual.snapshot(), reference.snapshot());
	}
});

test('Rust contiguous blocks retain shared buffers, external array mutation, and empty/null token identities', () => {
	for (const shape of ['shared', 'empty', 'allocatedEmpty', 'null'] as const) {
		const reference = new BlockFixture(2, [[3, 1, 8, 2], [3, 1, 8, 2], [3, 4, 8, 5]]);
		const actual = new BlockFixture(2, [[3, 1, 8, 2], [3, 1, 8, 2], [3, 4, 8, 5]]);
		for (const fixture of [reference, actual]) {
			switch (shape) {
				case 'shared': fixture.source[1] = fixture.source[0]; break;
				case 'empty': fixture.source[0] = EMPTY_LINE_TOKENS; break;
				case 'allocatedEmpty': fixture.source[0] = new Uint32Array(); break;
				case 'null': fixture.source[0] = null; break;
			}
			fixture.source.push(new Uint32Array([8, 9]));
		}
		for (const [range, text] of [[new Range(2, 3, 3, 3), 'a'], [new Range(3, 2, 3, 2), '\n'], [new Range(1, 1, 6, 1), '']] as const) {
			reference.piece.applyEdit(range, text);
			withRust(() => actual.piece.applyEdit(range, text));
			assert.deepStrictEqual(actual.snapshot(), reference.snapshot(), shape);
		}
	}
});

test('Rust contiguous block fallback is atomic and validates the result contract', () => {
	const tokens = new Uint32Array([3, 7, 6, 9]);
	const lines = [tokens];
	for (const parameters of [[1, 1.5, 1, 3, 0, 1], [1, 1, 1, 3, 262145, 1], [1, 1, 1, 3, 0, 2 ** 41]]) {
		const before = tokens.slice();
		assert.strictEqual(rust.edit_contiguous_tokens_block(1, lines, EMPTY_LINE_TOKENS, new Float64Array(parameters)), undefined);
		assert.deepStrictEqual(tokens, before);
	}
	assert.throws(() => rust.edit_contiguous_tokens_block(1, lines, EMPTY_LINE_TOKENS, new Float64Array()), /block edit/);
	const range = new Range(1, 2, 1, 3);
	assert.strictEqual(tryEditRustContiguousTokenBlock(1, lines, EMPTY_LINE_TOKENS, range, 0, 1), undefined);
	const reference = new BlockFixture(1, [[3, 7, 6, 9]]);
	const actual = new BlockFixture(1, [[3, 7, 6, 9]]);
	const module = { ...rust, edit_contiguous_tokens_block: () => undefined };
	reference.piece.applyEdit(range, 'a');
	withRust(() => actual.piece.applyEdit(range, 'a'), module);
	assert.deepStrictEqual(actual.snapshot(), reference.snapshot());
	withRust(() => {
		assert.throws(() => tryEditRustContiguousTokenBlock(1, lines, EMPTY_LINE_TOKENS, range, 0, 1), /block result/);
	}, { ...rust, edit_contiguous_tokens_block: () => [Number.NaN, lines] });
	assert.throws(() => registerRustTokens({ ...rust, tokens_abi_version: () => 5 }), /metadata contract/);
});
