/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Disposable } from '../../src/vs/base/common/lifecycle.js';
import { countEOL } from '../../src/vs/editor/common/core/misc/eolCounter.js';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { LanguageIdCodec } from '../../src/vs/editor/common/services/languagesRegistry.js';
import { LineTokens } from '../../src/vs/editor/common/tokens/lineTokens.js';
import { IRustTokensModule, registerRustTokens } from '../../src/vs/editor/common/tokens/rustTokens.js';
import { SparseMultilineTokens } from '../../src/vs/editor/common/tokens/sparseMultilineTokens.js';
import { SparseTokensStore } from '../../src/vs/editor/common/tokens/sparseTokensStore.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustTokensModule = rust): T {
	const registration = registerRustTokens(module);
	try { return compute(); } finally { registration.dispose(); }
}

/** Captures externally retained arrays, pieces, complete backing buffers, and old line views. */
class StoreFixture extends Disposable {
	public readonly store: SparseTokensStore;
	public readonly arrays: SparseMultilineTokens[][] = [];
	private readonly buffers: Uint32Array[] = [];
	private readonly views: Uint32Array[] = [];
	private readonly identities = new Map<SparseMultilineTokens, number>();
	private readonly codec = new LanguageIdCodec();

	constructor(native: boolean) {
		super();
		this.store = native ? withRust(() => this._register(new SparseTokensStore(this.codec))) : this._register(new SparseTokensStore(this.codec));
	}

	public piece(start: number, words: number[]): SparseMultilineTokens {
		const backing = new Uint32Array(words.length + 8);
		backing.fill(0xDEADBEEF);
		backing.set(words, 3);
		this.buffers.push(backing);
		const piece = SparseMultilineTokens.create(start, backing.subarray(3, 3 + words.length));
		this.identity(piece);
		for (let line = start; line <= Math.min(start + 40, piece.endLineNumber); line++) {
			const tokens = piece.getLineTokens(line);
			if (tokens) { this.views.push(tokens.getEncodedTokens()); }
		}
		return piece;
	}

	public array(pieces: SparseMultilineTokens[]): SparseMultilineTokens[] {
		this.arrays.push(pieces);
		return pieces;
	}

	private identity(piece: SparseMultilineTokens): number {
		let identity = this.identities.get(piece);
		if (identity === undefined) {
			identity = this.identities.size;
			this.identities.set(piece, identity);
		}
		return identity;
	}

	public snapshot() {
		const arrays = this.arrays.map(array => array.map(piece => this.identity(piece)));
		const text = 'a\uD800x\uDC00\uD83D\uDE00\uFEFF'.repeat(32);
		const syntax = new LineTokens(new Uint32Array([3, 0x82010407, text.length, 0x02018401]), text, this.codec);
		return {
			empty: this.store.isEmpty(), complete: this.store.isComplete(), arrays,
			pieces: Array.from(this.identities, ([piece, identity]) => ({
				identity, start: piece.startLineNumber, end: piece.endLineNumber, range: piece.getRange(), empty: piece.isEmpty(), text: piece.toString(),
				lines: Array.from({ length: 40 }, (_, index) => piece.getLineTokens(index + 1)?.getEncodedTokens() ?? null)
			})),
			buffers: this.buffers, views: this.views,
			lines: Array.from({ length: 40 }, (_, index) => {
				const result = this.store.addSparseTokens(index + 1, syntax);
				return { original: result === syntax, encoding: result.getEncodedTokens() };
			})
		};
	}
}

function compare(reference: StoreFixture, actual: StoreFixture, message?: string): void {
	assert.deepStrictEqual(withRust(() => actual.snapshot()), reference.snapshot(), message);
}

function partial(reference: StoreFixture, actual: StoreFixture, range: Range, first: SparseMultilineTokens[], second: SparseMultilineTokens[]): void {
	const expected = reference.store.setPartial(range, first);
	const result = withRust(() => actual.store.setPartial(range, second));
	assert.deepStrictEqual({ range: result, original: result === range }, { range: expected, original: expected === range });
}

function edit(fixture: StoreFixture, range: Range, text: string): void {
	const [eols, first, last] = countEOL(text);
	fixture.store.acceptEdit(range, eols, first, last, text.charCodeAt(0) || 0);
}

test('Rust sparse owner preserves seeded partial updates, splits, edits, and retained aliases', () => {
	let seed = 4591;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const words = () => Array.from({ length: random(16) }, () => [random(12), random(160), random(200), random(0x100000000)]).sort((first, second) => first[0] - second[0] || first[1] - second[1]).flat();
	for (let trace = 0; trace < 256; trace++) {
		const reference = new StoreFixture(false);
		const actual = new StoreFixture(true);
		try {
			const inputs = Array.from({ length: 1 + random(8) }, () => ({ start: 1 + random(24), words: words() })).sort((first, second) => first.start - second.start);
			for (const fixture of [reference, actual]) {
				fixture.store.set(fixture.array(inputs.map(input => fixture.piece(input.start, input.words))), trace % 2 === 0);
			}
			compare(reference, actual, `Initial trace ${trace}`);
			for (let step = 0; step < 16; step++) {
				const range = new Range(1 + random(36), 1 + random(180), 1 + random(36), 1 + random(180));
				if (random(2) === 0) {
					const incoming = Array.from({ length: random(4) }, () => ({ start: 1 + random(32), words: words() })).sort((first, second) => first.start - second.start);
					partial(reference, actual, range,
						reference.array(incoming.map(input => reference.piece(input.start, input.words))),
						actual.array(incoming.map(input => actual.piece(input.start, input.words))));
				} else {
					const text = ['', 'a', '12', ' ', '\uD800', '\r\nword\rnext\n', '\n'][random(7)];
					edit(reference, range, text);
					withRust(() => edit(actual, range, text));
				}
				compare(reference, actual, `Trace ${trace}, operation ${step}`);
			}
		} finally { reference.dispose(); actual.dispose(); }
	}
});

test('Rust sparse owner retains duplicate pieces, external array mutation, and self-aliasing partial input', () => {
	for (const selfPartial of [false, true]) {
		const reference = new StoreFixture(false);
		const actual = new StoreFixture(true);
		try {
			for (const fixture of [reference, actual]) {
				const piece = fixture.piece(3, [0, 2, 8, 63, 2, 1, 5, 0x80208010, 4, 4, 9, 0x02000020, 6, 2, 6, 15]);
				const array = fixture.array([piece, piece]);
				fixture.store.set(array, true);
				array.push(fixture.piece(20, [0, 1, 3, 31]));
				array.unshift(fixture.piece(1, [0, 1, 3, 15]));
			}
			compare(reference, actual);
			if (selfPartial) {
				partial(reference, actual, new Range(4, 1, 6, 10), reference.arrays[0], actual.arrays[0]);
			} else {
				edit(reference, new Range(3, 4, 3, 4), 'a');
				withRust(() => edit(actual, new Range(3, 4, 3, 4), 'a'));
				partial(reference, actual, new Range(4, 1, 6, 10), [], []);
			}
			compare(reference, actual);
			// A partial insertion creates another index after mutating the previously retained array.
			partial(reference, actual, new Range(12, 1, 13, 1),
				reference.array([reference.piece(12, [0, 1, 2, 63])]), actual.array([actual.piece(12, [0, 1, 2, 63])]));
			for (const fixture of [reference, actual]) { fixture.arrays[0].length = 0; }
			compare(reference, actual);
			for (const fixture of [reference, actual]) { fixture.store.flush(); }
			compare(reference, actual);
		} finally { reference.dispose(); actual.dispose(); }
	}
});

test('Rust sparse owner preserves empty-edge partial identity and selected line view identity', () => {
	const native = new rust.WasmSparseTokensStore();
	try {
		const piece = SparseMultilineTokens.create(2, new Uint32Array([0, 1, 3, 63]));
		const view = piece.getLineTokens(2);
		piece.getLineTokens = () => view;
		const pieces = [piece];
		native.set_pieces(pieces, true);
		assert.strictEqual(native.export_pieces(), pieces);
		assert.strictEqual(native.get_line_tokens(2), view);
		const range = new Range(1, 1, 3, 1);
		for (const incoming of [[SparseMultilineTokens.create(1, new Uint32Array()), piece], [piece, SparseMultilineTokens.create(4, new Uint32Array())]]) {
			assert.strictEqual(native.set_partial(range, incoming), range);
			assert.strictEqual(native.export_pieces(), pieces);
		}
	} finally { native.free(); }
});

test('Rust sparse owner edits standard pieces without nested token bindings and refreshes externally changed deltas', () => {
	const module = { ...rust, update_sparse_tokens: (): never => { throw new Error('Unexpected nested sparse token binding'); } };
	const reference = new StoreFixture(false);
	const actual = new StoreFixture(true);
	try {
		for (const fixture of [reference, actual]) {
			const piece = fixture.piece(8, [0, 1, 6, 63, 2, 2, 7, 31]);
			fixture.store.set(fixture.array([piece]), true);
			// The public end is deliberately stale until an edit refreshes it from the current buffer.
			piece.getLineTokens(10)!.getEncodedTokens()[0] = 5;
		}
		for (const range of [new Range(1, 2, 1, 2), new Range(30, 1, 30, 1), new Range(8, 3, 8, 3), new Range(7, 1, 15, 1)]) {
			edit(reference, range, 'a');
			withRust(() => edit(actual, range, 'a'), module);
			compare(reference, actual);
		}
	} finally { reference.dispose(); actual.dispose(); }
});

test('Rust sparse owner propagates original piece callback exceptions without changing their identity', () => {
	const failure = new Error('Original sparse callback failure');
	for (const operation of ['range', 'line', 'remove', 'empty', 'split', 'edit', 'start', 'end'] as const) {
		for (const native of [false, true]) {
			const fixture = new StoreFixture(native);
			try {
				const piece = fixture.piece(1, [0, 1, 3, 63, 4, 1, 3, 63]);
				fixture.store.set([piece], true);
				const fail = (): never => { throw failure; };
				switch (operation) {
					case 'range': piece.getRange = fail; break;
					case 'line': piece.getLineTokens = fail; break;
					case 'remove': piece.removeTokens = fail; break;
					case 'empty': piece.isEmpty = fail; break;
					case 'split': piece.split = fail; break;
					case 'edit': piece.acceptEdit = fail; break;
					case 'start': Object.defineProperty(piece, 'startLineNumber', { get: fail }); break;
					case 'end': Object.defineProperty(piece, 'endLineNumber', { get: fail }); break;
				}
				const run = () => {
					if (operation === 'line') { fixture.store.addSparseTokens(1, new LineTokens(new Uint32Array([4, 7]), 'text', new LanguageIdCodec())); }
					else if (operation === 'edit') { edit(fixture, new Range(1, 2, 1, 2), 'a'); }
					else { fixture.store.setPartial(new Range(2, 1, 3, 1), operation === 'range' ? [piece] : []); }
				};
				assert.throws(() => native ? withRust(run) : run(), error => error === failure, operation);
			} finally { fixture.dispose(); }
		}
	}
});

test('Rust sparse owner transfers the original aliased array and releases unsupported native state', () => {
	let created = 0;
	let freed = 0;
	class CountedStore extends rust.WasmSparseTokensStore {
		constructor(standardEdit?: SparseMultilineTokens['acceptEdit']) { super(standardEdit); created++; }
		public override free(): void { freed++; super.free(); }
	}
	const module = { ...rust, WasmSparseTokensStore: CountedStore };
	for (const domain of ['fraction', 'large', 'partialFraction', 'partialLarge', 'capacity', 'partialCapacity'] as const) {
		const reference = new SparseTokensStore(new LanguageIdCodec());
		const actual = withRust(() => new SparseTokensStore(new LanguageIdCodec()), module);
		try {
			const first = SparseMultilineTokens.create(1, new Uint32Array([0, 1, 3, 63]));
			const second = SparseMultilineTokens.create(1, new Uint32Array([0, 1, 3, 63]));
			const firstArray = [first];
			const secondArray = [second];
			if (domain === 'capacity') {
				firstArray.length = secondArray.length = 262145;
				firstArray.fill(first); secondArray.fill(second);
			} else if (domain === 'partialCapacity') {
				firstArray.length = secondArray.length = 131073;
				firstArray.fill(first); secondArray.fill(second);
			}
			reference.set(firstArray, true); actual.set(secondArray, true);
			const before = freed;
			if (domain === 'fraction' || domain === 'large') {
				const column = domain === 'fraction' ? 1.5 : 2 ** 41;
				reference.acceptEdit(new Range(1, column, 1, column), 0, 1, 1, 97);
				withRust(() => actual.acceptEdit(new Range(1, column, 1, column), 0, 1, 1, 97), module);
			} else if (domain === 'partialCapacity') {
				const range = new Range(2, 1, 3, 1);
				assert.deepStrictEqual(actual.setPartial(range, []), reference.setPartial(range, []));
			} else if (domain === 'partialFraction' || domain === 'partialLarge') {
				const column = domain === 'partialFraction' ? 1.5 : 2 ** 41;
				const range = new Range(1, column, 1, column);
				assert.deepStrictEqual(actual.setPartial(range, []), reference.setPartial(range, []));
			}
			assert.strictEqual(freed - before, domain === 'capacity' ? 0 : 1);
			assert.deepStrictEqual({ complete: actual.isComplete(), text: second.toString(), count: secondArray.length }, { complete: reference.isComplete(), text: first.toString(), count: firstArray.length });
			firstArray.length = secondArray.length = 0;
			assert.strictEqual(actual.isEmpty(), reference.isEmpty());
		} finally { reference.dispose(); actual.dispose(); }
	}
	assert.strictEqual(freed, created);
	const registration = registerRustTextBuffer(module);
	try {
		const model = createTextModel('first\nnext');
		try { model.tokenization.setSemanticTokens([SparseMultilineTokens.create(1, new Uint32Array([0, 0, 3, 63]))], true); }
		finally { model.dispose(); }
		assert.strictEqual(freed, created, 'Model disposal releases its semantic owner');
	} finally { registration.dispose(); }
});
