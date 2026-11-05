/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, TestContext } from 'node:test';
import { DisposableStore } from '../../src/vs/base/common/lifecycle.js';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { DefaultEndOfLine, EndOfLinePreference, ITextSnapshot, IIdentifiedSingleEditOperation, ValidAnnotatedEditOperation } from '../../src/vs/editor/common/model.js';
import { PieceTreeTextBuffer } from '../../src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.js';
import { PieceTreeTextBufferBuilder } from '../../src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { SearchParams } from '../../src/vs/editor/common/model/textModelSearch.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<{ memory: WebAssembly.Memory }>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const moduleUrl = pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href;
const rust = await import(moduleUrl) as IRustModule;
const wasm = await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function createBuffer(chunks: string[], defaultEOL: DefaultEndOfLine = DefaultEndOfLine.LF): PieceTreeTextBuffer {
	const builder = new PieceTreeTextBufferBuilder();
	for (const chunk of chunks) {
		builder.acceptChunk(chunk);
	}
	return builder.finish().create(defaultEOL).textBuffer as PieceTreeTextBuffer;
}

function createPair(context: TestContext, chunks: string[], defaultEOL: DefaultEndOfLine = DefaultEndOfLine.LF): [PieceTreeTextBuffer, PieceTreeTextBuffer] {
	const disposables = new DisposableStore();
	context.after(() => disposables.dispose());
	const reference = disposables.add(createBuffer(chunks, defaultEOL));
	const registration = registerRustTextBuffer(rust);
	try {
		return [reference, disposables.add(createBuffer(chunks, defaultEOL))];
	} finally {
		registration.dispose();
	}
}

function readSnapshot(snapshot: ITextSnapshot): string {
	const chunks: string[] = [];
	let chunk: string | null;
	while ((chunk = snapshot.read()) !== null) {
		chunks.push(chunk);
	}
	return chunks.join('');
}

function annotate(operations: IIdentifiedSingleEditOperation[]): ValidAnnotatedEditOperation[] {
	return operations.map(operation => new ValidAnnotatedEditOperation(operation.identifier ?? null, Range.lift(operation.range), operation.text, operation.forceMoveMarkers ?? false, operation.isAutoWhitespaceEdit ?? false, operation._isTracked ?? false));
}

function compareBuffers(reference: PieceTreeTextBuffer, actual: PieceTreeTextBuffer): void {
	assert.deepStrictEqual({
		length: actual.getLength(),
		lines: actual.getLinesContent(),
		eol: actual.getEOL(),
		bom: actual.getBOM(),
		snapshot: readSnapshot(actual.createSnapshot(true))
	}, {
		length: reference.getLength(),
		lines: reference.getLinesContent(),
		eol: reference.getEOL(),
		bom: reference.getBOM(),
		snapshot: readSnapshot(reference.createSnapshot(true))
	});
	for (let line = 1; line <= reference.getLineCount(); line++) {
		assert.deepStrictEqual([
			actual.getLineLength(line),
			actual.getLineFirstNonWhitespaceColumn(line),
			actual.getLineLastNonWhitespaceColumn(line)
		], [
			reference.getLineLength(line),
			reference.getLineFirstNonWhitespaceColumn(line),
			reference.getLineLastNonWhitespaceColumn(line)
		]);
	}
	for (let offset = 0; offset <= reference.getLength(); offset += Math.max(1, Math.floor(reference.getLength() / 64))) {
		const expected = reference.getPositionAt(offset);
		assert.deepStrictEqual(actual.getPositionAt(offset), expected);
		assert.strictEqual(actual.getOffsetAt(expected.lineNumber, expected.column), offset);
	}
	assert.ok(actual.equals(reference) && reference.equals(actual));
}

test('Rust storage rejects stale bindings before registering a model factory', () => {
	assert.throws(() => registerRustTextBuffer({ ...rust, text_buffer_abi_version: () => 1 }), /storage contract/);
	const registration = registerRustTextBuffer(rust);
	registration.dispose();
});

test('Rust storage preserves chunked UTF-16 input, BOM, and both default EOLs', context => {
	for (const chunks of [
		[''],
		['\uFEFF', 'one\r', '\ntwo\r', 'three\nfour'],
		['\uD800', '\uDC00\r', '\n\uDFFF\u0000\u2028\u2029'],
		['a'.repeat(1023) + '\r', '\n' + 'b'.repeat(2048) + '\r\n']
	]) {
		for (const eol of [DefaultEndOfLine.LF, DefaultEndOfLine.CRLF]) {
			const [reference, actual] = createPair(context, chunks, eol);
			compareBuffers(reference, actual);
		}
	}
});

test('Rust storage preserves lossless string transfers and invalidates bounded line caches', context => {
	const alphabet = String.fromCharCode(...Array.from({ length: 256 }, (_, index) => index)).replace(/[\r\n]/g, '');
	const lines = Array.from({ length: 130 }, (_, index) => `line ${index} ${alphabet}\uFEFF${index % 2 ? '\uD800' : '\uD83D\uDE00'}`);
	lines[70] = 'long'.repeat(10000);
	lines.push('');
	const [reference, actual] = createPair(context, [lines.join('\r\n')]);
	for (const line of [1, 63, 64, 65, 70, 71, 72, 128, 130, 131, 129, 2, 1]) {
		assert.deepStrictEqual([actual.getLineContent(line), actual.getLineLength(line)], [reference.getLineContent(line), reference.getLineLength(line)]);
	}
	const edits = annotate([
		{ range: new Range(2, 1, 2, 4), text: 'changed\nline' },
		{ range: new Range(63, 1, 68, 2), text: '' }
	]);
	reference.applyEdits(edits, false, false);
	actual.applyEdits(edits, false, false);
	compareBuffers(reference, actual);
	reference.setEOL('\n');
	actual.setEOL('\n');
	compareBuffers(reference, actual);
});

test('Rust bindings transfer ASCII strings and UTF-16 arrays without changing code units', () => {
	const texts = ['ASCII\u0000', '\u0080\u009F\u00FF\uFEFF', 'a'.repeat(1023) + '\uD83D\uDE00', '\uD800x\uDFFF', 'x'.repeat(65535) + '\uD800\uDC00', '\uD800x'.repeat(2048), 'valid\uFEFF\uD83D\uDE00'.repeat(2048) + '\uDFFF'];
	for (const text of texts) {
		const original = new Uint16Array(text.length);
		for (let index = 0; index < text.length; index++) { original[index] = text.charCodeAt(index); }
		const buffer = new rust.WasmTextBuffer(original);
		try {
			const decode = (value: string | Uint16Array) => typeof value === 'string' ? value : Array.from(value, unit => String.fromCharCode(unit)).join('');
			const transferred = buffer.slice_text(0, text.length);
			assert.strictEqual(decode(transferred), text);
			assert.strictEqual(typeof transferred, /[^\u0000-\u007F]/.test(text) ? 'object' : 'string');
			const snapshot = buffer.snapshot();
			try {
				const chunks: string[] = [];
				let chunk: string | Uint16Array | undefined;
				while ((chunk = snapshot.read()) !== undefined) { chunks.push(decode(chunk)); }
				assert.strictEqual(chunks.join(''), text);
			} finally { snapshot.free(); }
		} finally { buffer.free(); }
	}
});

test('Rust literal search matches the existing engine across leaf and edit boundaries', context => {
	const [reference, actual] = createPair(context, ['a'.repeat(1023) + 'ababa\uD800x\uDFFF\uD83D\uDE00\r\n' + 'ababa aaba\r\n'.repeat(130)]);
	const searches = ['aba', 'aaba', '\uD800x', '\uDFFF', '\uD83D\uDE00', 'missing'];
	const compare = () => {
		const full = new Range(1, 1, reference.getLineCount(), reference.getLineLength(reference.getLineCount()) + 1);
		for (const search of searches) {
			for (const limit of [1, 3, 1000]) {
				const data = new SearchParams(search, false, true, null).parseSearchRequest()!;
				assert.deepStrictEqual(actual.findMatchesLineByLine(full, data, false, limit), reference.findMatchesLineByLine(full, data, false, limit));
			}
		}
	};
	compare();
	const edits = annotate([{ range: new Range(1, 1024, 1, 1024), text: 'ab' }, { range: new Range(64, 2, 64, 3), text: 'aba' }]);
	reference.applyEdits(edits, false, false);
	actual.applyEdits(edits, false, false);
	compare();
});

test('Rust storage produces identical edits, inverse edits, and notifications', context => {
	const [reference, actual] = createPair(context, ['one\r\ntwo\r\nthree\r\n']);
	const operations = annotate([
		{ range: new Range(1, 2, 1, 3), text: '\uD800\uDC00\ninserted', forceMoveMarkers: true },
		{ range: new Range(2, 1, 3, 2), text: 'replacement' }
	]);
	let referenceEvents = 0;
	let actualEvents = 0;
	const disposables = new DisposableStore();
	context.after(() => disposables.dispose());
	disposables.add(reference.onDidChangeContent(() => referenceEvents++));
	disposables.add(actual.onDidChangeContent(() => actualEvents++));
	const expectedEdits = reference.applyEdits(operations, true, true);
	const actualEdits = actual.applyEdits(operations, true, true);
	assert.deepStrictEqual(actualEdits, expectedEdits);
	compareBuffers(reference, actual);
	reference.applyEdits(annotate(expectedEdits.reverseEdits!), true, false);
	actual.applyEdits(annotate(actualEdits.reverseEdits!), true, false);
	compareBuffers(reference, actual);
	assert.deepStrictEqual([actualEvents, referenceEvents], [2, 2]);
});

test('Rust storage keeps snapshots stable while edits and EOL changes continue', context => {
	const [reference, actual] = createPair(context, ['\uFEFF' + 'one\r\ntwo\r\n'.repeat(1024)]);
	const expected = readSnapshot(reference.createSnapshot(true));
	const snapshot = actual.createSnapshot(true);
	actual.setEOL('\n');
	actual.applyEdits(annotate([{ range: new Range(1, 1, 2, 2), text: 'changed' }]), false, false);
	actual.dispose();
	assert.strictEqual(readSnapshot(snapshot), expected);
	assert.strictEqual(snapshot.read(), null);
});

test('Rust storage preserves literal search, regex captures, boundaries, and result limits', context => {
	const [reference, actual] = createPair(context, ['word words sword\nword WORD word\n\uD800\uDC00word\n']);
	const range = new Range(1, 2, 3, 7);
	for (const search of [
		new SearchParams('word', false, true, null),
		new SearchParams('word', false, false, ' '),
		new SearchParams('(w)(ord)', true, false, null)
	]) {
		const data = search.parseSearchRequest()!;
		for (const captures of [true, false]) {
			for (const limit of [-1, 0, 1, 1.5, 3, 100, Number.POSITIVE_INFINITY, Number.NaN]) {
				assert.deepStrictEqual(actual.findMatchesLineByLine(range, data, captures, limit), reference.findMatchesLineByLine(range, data, captures, limit));
			}
		}
	}
});

test('Rust storage matches seeded edits and range extraction against the existing buffer', context => {
	let seed = 42;
	const random = (limit: number) => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed % limit;
	};
	const [reference, actual] = createPair(context, ['a\uD800\uDC00b\n'.repeat(1024)]);
	for (let iteration = 0; iteration < 512; iteration++) {
		const start = random(reference.getLength() + 1);
		const length = Math.min(random(32), reference.getLength() - start);
		const text = ['new\nline', '\uD800', '\r\n', '', '\uDC00', 'text'][random(6)];
		const range = reference.getRangeAt(start, length);
		const operations = annotate([{ range, text }]);
		assert.deepStrictEqual(actual.applyEdits(operations, true, true), reference.applyEdits(operations, true, true));
		if (iteration % 32 === 0) {
			compareBuffers(reference, actual);
		}
		const sliceStart = random(reference.getLength() + 1);
		const slice = reference.getRangeAt(sliceStart, Math.min(random(32), reference.getLength() - sliceStart));
		for (const eol of [EndOfLinePreference.LF, EndOfLinePreference.CRLF, EndOfLinePreference.TextDefined]) {
			assert.strictEqual(actual.getValueInRange(slice, eol), reference.getValueInRange(slice, eol));
		}
	}
	compareBuffers(reference, actual);
});

test('Rust storage works with the existing text model undo, redo, and version tracking', async context => {
	const disposables = new DisposableStore();
	context.after(() => disposables.dispose());
	const reference = disposables.add(createTextModel('one\ntwo\nthree'));
	const registration = registerRustTextBuffer(rust);
	const actual = (() => {
		try {
			return disposables.add(createTextModel('one\ntwo\nthree'));
		} finally {
			registration.dispose();
		}
	})();
	for (const model of [reference, actual]) {
		model.pushStackElement();
		model.pushEditOperations(null, [{ range: new Range(1, 2, 2, 2), text: 'new\ncontent' }], () => null);
		model.pushStackElement();
	}
	const state = () => [actual.getValue(), actual.getVersionId(), actual.getAlternativeVersionId()];
	const expected = () => [reference.getValue(), reference.getVersionId(), reference.getAlternativeVersionId()];
	assert.deepStrictEqual(state(), expected());
	await actual.undo();
	await reference.undo();
	assert.deepStrictEqual(state(), expected());
	await actual.redo();
	await reference.redo();
	assert.deepStrictEqual(state(), expected());
	for (const search of ['^|$', '(n)(ew)', '(?<=n)ew', 'new\ncontent']) {
		assert.deepStrictEqual(actual.findMatches(search, null, true, false, null, true, 100), reference.findMatches(search, null, true, false, null, true, 100));
	}
});

test('Rust storage releases buffers and drained snapshots across repeated document lifetimes', context => {
	const exercise = () => {
		for (let iteration = 0; iteration < 64; iteration++) {
			const registration = registerRustTextBuffer(rust);
			let buffer: PieceTreeTextBuffer;
			try {
				buffer = createBuffer(['document\n'.repeat(4096)]);
			} finally {
				registration.dispose();
			}
			readSnapshot(buffer.createSnapshot(false));
			buffer.dispose();
		}
	};
	exercise();
	const initial = wasm.memory.buffer.byteLength;
	exercise();
	assert.ok(wasm.memory.buffer.byteLength <= initial + 65536);
	context.diagnostic(`WebAssembly linear memory after repeated lifetimes: ${wasm.memory.buffer.byteLength} bytes`);
});
