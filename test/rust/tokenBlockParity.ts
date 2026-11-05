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
import { ContiguousMultilineTokensBuilder } from '../../src/vs/editor/common/tokens/contiguousMultilineTokensBuilder.js';
import { EMPTY_LINE_TOKENS, toUint32Array } from '../../src/vs/editor/common/tokens/contiguousTokensEditing.js';
import { IRustTokensModule, registerRustTokens, tryDecodeRustTokenBlocks, tryEditRustContiguousTokenBlock, trySerializeRustTokenBlocks, trySizeRustTokenBlocks } from '../../src/vs/editor/common/tokens/rustTokens.js';

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

test('Rust token serialization preserves seeded complete streams, grouping, headers, and provider aliases', () => {
	let seed = 17291;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	for (let trace = 0; trace < 512; trace++) {
		const reference = new ContiguousMultilineTokensBuilder();
		const actual = new ContiguousMultilineTokensBuilder();
		const inputs: Uint32Array[] = [];
		const before: Uint32Array[] = [];
		let line = random(0x100000000);
		for (let index = 0, count = random(32); index < count; index++) {
			line += random(4);
			const words = new Uint32Array(Array.from({ length: random(64) }, () => random(0x100000000)));
			const native = words.slice();
			reference.add(line, words);
			actual.add(line, native);
			inputs.push(native); before.push(words.slice());
		}
		const expectedBytes = reference.serialize();
		const actualBytes = withRust(() => actual.serialize());
		assert.deepStrictEqual({ bytes: actualBytes, inputs }, { bytes: expectedBytes, inputs: before }, `Encoded stream ${trace}`);
		const expectedBlocks = ContiguousMultilineTokensBuilder.deserialize(expectedBytes);
		const actualBlocks = withRust(() => ContiguousMultilineTokensBuilder.deserialize(actualBytes));
		assert.deepStrictEqual(decodedState(actualBlocks, actualBytes), decodedState(expectedBlocks, expectedBytes));
		expectedBytes[expectedBytes.length - 1] ^= 0x7F;
		actualBytes[actualBytes.length - 1] ^= 0x7F;
		assert.deepStrictEqual(decodedState(actualBlocks, actualBytes), decodedState(expectedBlocks, expectedBytes), 'Decoded records retain mutable source views');
		for (const offset of [0, 3, 17]) {
			for (let index = 0; index < actual.finalize().length; index++) {
				const expectedPiece = reference.finalize()[index];
				const piece = actual.finalize()[index];
				const expected = new Uint8Array(expectedPiece.serializeSize() + offset + 5).fill(0xA5);
				const bytes = expected.slice();
				assert.deepStrictEqual({ size: withRust(() => piece.serializeSize()), offset: withRust(() => piece.serialize(bytes, offset)), bytes }, { size: expectedPiece.serializeSize(), offset: expectedPiece.serialize(expected, offset), bytes: expected });
			}
		}
	}
});

function decodedState(blocks: ContiguousMultilineTokens[], source: Uint8Array) {
	return blocks.map(block => ({
		start: block.startLineNumber, end: block.endLineNumber,
		lines: Array.from({ length: block.endLineNumber - block.startLineNumber + 1 }, (_, index) => {
			const value = block.getLineTokens(block.startLineNumber + index);
			assert.ok(value instanceof Uint32Array);
			return { words: value, offset: value.byteOffset, source: value.buffer === source.buffer };
		})
	}));
}

test('Rust token deserialization preserves single-block offsets and original malformed/subview behavior', () => {
	const block = new ContiguousMultilineTokens(7, [new Uint32Array([3, 7, 6, 9]), new Uint32Array([4, 0xFFFFFFFF])]);
	const expected = new Uint8Array(block.serializeSize() + 4).fill(0xA5);
	block.serialize(expected, 4);
	const bytes = expected.slice();
	const first = [new ContiguousMultilineTokens(1, [])];
	const second = [new ContiguousMultilineTokens(1, [])];
	assert.deepStrictEqual({ offset: withRust(() => ContiguousMultilineTokens.deserialize(bytes, 4, second)), blocks: decodedState(second, bytes) }, { offset: ContiguousMultilineTokens.deserialize(expected, 4, first), blocks: decodedState(first, expected) });
	const builder = new ContiguousMultilineTokensBuilder();
	builder.add(7, new Uint32Array([3, 7, 6, 9]));
	const valid = builder.serialize();
	const padded = new Uint8Array(valid.length + 8);
	padded.set(valid, 8);
	const oddByteCount = valid.slice();
	oddByteCount.set([0, 0, 0, 3], 12);
	for (const malformed of [valid.subarray(0, valid.length - 1), valid.slice(0, valid.length - 4), padded.subarray(8), oddByteCount, new Uint8Array()]) {
		assert.deepStrictEqual(decodedState(withRust(() => ContiguousMultilineTokensBuilder.deserialize(malformed)), malformed), decodedState(ContiguousMultilineTokensBuilder.deserialize(malformed), malformed));
	}
	assert.strictEqual(rust.decode_contiguous_token_blocks(valid, 1.5, true), undefined);
	assert.strictEqual(rust.decode_contiguous_token_blocks(valid, 1, true), undefined);
	assert.strictEqual(rust.decode_contiguous_token_blocks(padded.subarray(8), 0, true), undefined);
	assert.strictEqual(rust.decode_contiguous_token_blocks(new Uint8Array(16 * 1024 * 1024 + 4), 0, true), undefined);
	withRust(() => assert.throws(() => tryDecodeRustTokenBlocks(valid, 0, true), /deserialization result/), { ...rust, decode_contiguous_token_blocks: () => [Number.NaN, []] });
});

test('Rust token serialization retains unsupported subviews and original partial writes on short or aliased destinations', () => {
	const failure = (piece: ContiguousMultilineTokens, destination: Uint8Array) => {
		let error: { name: string; message: string } | null = null;
		try { piece.serialize(destination, 1); } catch (value) {
			assert.ok(value instanceof Error);
			error = { name: value.name, message: value.message };
		}
		return { error, backing: new Uint8Array(destination.buffer) };
	};
	for (const subview of [false, true]) {
		for (const length of [0, 3, 9, 20]) {
			const source = new Uint32Array([0xDEADBEEF, 3, 7, 6, 9, 0xDEADBEEF]);
			const native = source.slice();
			const reference = new ContiguousMultilineTokens(2, [subview ? source.subarray(1, 5) : source]);
			const actual = new ContiguousMultilineTokens(2, [subview ? native.subarray(1, 5) : native]);
			const expected = new Uint8Array(length + 7).fill(0xA5);
			const bytes = expected.slice();
			assert.deepStrictEqual(withRust(() => failure(actual, bytes.subarray(3, 3 + length))), failure(reference, expected.subarray(3, 3 + length)));
		}
	}
	const source = new Uint32Array([3, 7, 6, 9]);
	const native = source.slice();
	assert.deepStrictEqual(withRust(() => failure(new ContiguousMultilineTokens(2, [native]), new Uint8Array(native.buffer))), failure(new ContiguousMultilineTokens(2, [source]), new Uint8Array(source.buffer)));
});

test('Rust token serialization preserves overridden callbacks, unsupported tokens, capacity fallback, and validation', () => {
	const failure = new Error('Original token serialization callback failure');
	class CustomSize extends ContiguousMultilineTokens {
		public override serializeSize(): number { throw failure; }
	}
	class CustomWrite extends ContiguousMultilineTokens {
		public override serialize(): number { throw failure; }
	}
	for (const piece of [new CustomSize(1, [new Uint32Array([3, 7])]), new CustomWrite(1, [new Uint32Array([3, 7])])]) {
		const builder = new ContiguousMultilineTokensBuilder();
		builder.finalize().push(piece);
		assert.throws(() => withRust(() => builder.serialize()), error => error === failure);
	}
	const accessor = new ContiguousMultilineTokens(1, [new Uint32Array([3, 7])]);
	let accessorReads = 0;
	Object.defineProperty(accessor, 'serialize', { get: () => { accessorReads++; throw failure; } });
	assert.deepStrictEqual(withRust(() => ({ size: accessor.serializeSize(), accessorReads })), { size: 20, accessorReads: 0 });
	const accessorBuilder = new ContiguousMultilineTokensBuilder();
	accessorBuilder.finalize().push(accessor);
	assert.throws(() => withRust(() => accessorBuilder.serialize()), error => error === failure);
	assert.strictEqual(accessorReads, 1, 'Native preflight must not invoke the overridden accessor');
	const source = [new Uint32Array([3, 7])];
	const external: (Uint32Array | ArrayBuffer | null)[] = source;
	const piece = new ContiguousMultilineTokens(1, source);
	for (const value of [null, EMPTY_LINE_TOKENS, new ArrayBuffer(8)]) {
		external[0] = value;
		assert.throws(() => withRust(() => piece.serializeSize()), /Not supported/);
	}
	const size = ContiguousMultilineTokens.prototype.serializeSize;
	const write = ContiguousMultilineTokens.prototype.serialize;
	const huge = new ContiguousMultilineTokens(1, [new Uint32Array(4 * 1024 * 1024)]);
	assert.strictEqual(rust.contiguous_token_blocks_size([huge], size, write, true), undefined);
	const count = new ContiguousMultilineTokens(1, Array.from({ length: 262145 }, () => new Uint32Array()));
	const bytes = new Uint8Array(32).fill(0xA5);
	assert.strictEqual(rust.serialize_contiguous_token_blocks([count], size, write, bytes, 0, true), undefined);
	assert.deepStrictEqual(bytes, new Uint8Array(32).fill(0xA5));
	withRust(() => assert.throws(() => trySizeRustTokenBlocks([], size, write, true), /serialization size/), { ...rust, contiguous_token_blocks_size: () => -1 });
	withRust(() => assert.throws(() => trySerializeRustTokenBlocks([], size, write, bytes, 0, true), /serialization result/), { ...rust, serialize_contiguous_token_blocks: () => Number.NaN });
	assert.throws(() => registerRustTokens({ ...rust, tokens_abi_version: () => 6 }), /metadata contract/);
});
