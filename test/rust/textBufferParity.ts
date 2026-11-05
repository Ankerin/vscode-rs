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
import { IRustTextBuffer, IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { SearchParams } from '../../src/vs/editor/common/model/textModelSearch.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { encodeUTF16 } from '../../src/vs/editor/common/core/utf16Transfer.js';
import { containsRTL, containsUnusualLineTerminators, isBasicASCII } from '../../src/vs/base/common/strings.js';
import { readUInt32BE } from '../../src/vs/base/common/buffer.js';
import { guessIndentation } from '../../src/vs/editor/common/model/indentationGuesser.js';

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
	for (const version of [1, 2, 3, 4, 5]) {
		assert.throws(() => registerRustTextBuffer({ ...rust, text_buffer_abi_version: () => version }), /storage contract/);
	}
	const registration = registerRustTextBuffer(rust);
	registration.dispose();
});

test('Rust scalar model queries preserve seeded character counts, visible endpoints, and whitespace columns', context => {
	let seed = 23;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	for (const eol of ['\n', '\r\n'] as const) {
		const [reference, actual] = createPair(context, [(' \t\uFEFF\uD800x\uD83D\uDE00\t' + eol + '\uD800' + eol + '\t ').repeat(128)]);
		const compare = () => {
			for (let line = 1; line <= reference.getLineCount(); line++) {
				assert.deepStrictEqual([actual.getLineFirstNonWhitespaceColumn(line), actual.getLineLastNonWhitespaceColumn(line)], [reference.getLineFirstNonWhitespaceColumn(line), reference.getLineLastNonWhitespaceColumn(line)]);
			}
			for (let iteration = 0; iteration < 1024; iteration++) {
				const startLine = 1 + random(reference.getLineCount());
				const endLine = startLine + random(reference.getLineCount() - startLine + 1);
				const startColumn = 1 + random(reference.getLineMaxColumn(startLine));
				const endColumn = endLine === startLine ? startColumn + random(reference.getLineMaxColumn(endLine) - startColumn + 1) : 1 + random(reference.getLineMaxColumn(endLine));
				const range = new Range(startLine, startColumn, endLine, endColumn);
				for (const preference of [EndOfLinePreference.TextDefined, EndOfLinePreference.LF, EndOfLinePreference.CRLF]) {
					assert.strictEqual(actual.getCharacterCountInRange(range, preference), reference.getCharacterCountInRange(range, preference), `Character range ${range}`);
				}
			}
		};
		compare();
		const operations = annotate([{ range: new Range(1, 1, 1, 2), text: '\uD800\uD800x' }, { range: new Range(2, 1, 2, 1), text: '\t\n ' }]);
		reference.applyEdits(operations, true, true);
		actual.applyEdits(operations, true, true);
		compare();
	}
	const [reference, actual] = createPair(context, ['\uD800a\r\nnext']);
	const interior = new Range(1, 1, 1, 4);
	assert.strictEqual(actual.getCharacterCountInRange(interior), reference.getCharacterCountInRange(interior));
});

test('Rust scalar model queries avoid decoded line transfers', context => {
	class ScalarBuffer extends rust.WasmTextBuffer {
		public static override from_text(text: string): ScalarBuffer { return new ScalarBuffer(encodeUTF16(text)); }
		public override line_batch(): never { throw new Error('Decoded scalar-query line transfer'); }
		public override line_content(): never { throw new Error('Copied scalar-query line transfer'); }
	}
	const text = ' '.repeat(2048) + '\uD800x\uD83D\uDE00' + '\t'.repeat(4096) + '\r\n\uD800\r\n';
	const reference = createBuffer([text]);
	const registration = registerRustTextBuffer({ ...rust, WasmTextBuffer: ScalarBuffer });
	let actual: PieceTreeTextBuffer;
	try { actual = createBuffer([text]); } finally { registration.dispose(); }
	context.after(() => { reference.dispose(); actual.dispose(); });
	const range = new Range(1, 1, 3, 1);
	assert.deepStrictEqual([actual.getLineFirstNonWhitespaceColumn(1), actual.getLineLastNonWhitespaceColumn(1), actual.getCharacterCountInRange(range)], [reference.getLineFirstNonWhitespaceColumn(1), reference.getLineLastNonWhitespaceColumn(1), reference.getCharacterCountInRange(range)]);
});

test('Rust indentation detection preserves seeded alignment, mixed prefixes, and numeric defaults', context => {
	let seed = 131;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const prefixes = ['', ' ', '  ', '    ', '      ', '        ', '\t', '\t\t', '\t    ', '  \t', '   ', '     ', '       '];
	const contents = ['', 'value', 'const a = 1,', 'b = 2;', '- item', '\uD800x\uFEFF\uD83D\uDE00', 'value, ', '\u00A0'];
	for (let iteration = 0; iteration < 768; iteration++) {
		const text = Array.from({ length: random(64) }, () => prefixes[random(prefixes.length)] + contents[random(contents.length)]).join(iteration % 2 === 0 ? '\n' : '\r\n');
		const [reference, actual] = createPair(context, [text]);
		try {
			for (const tabSize of [2, 4, 8, 3.5, -0, Number.NaN, Number.POSITIVE_INFINITY]) {
				for (const insertSpaces of [false, true]) {
					assert.deepStrictEqual(guessIndentation(actual, tabSize, insertSpaces), guessIndentation(reference, tabSize, insertSpaces), `Indentation ${iteration}/${tabSize}/${insertSpaces}`);
				}
			}
		} finally {
			reference.dispose();
			actual.dispose();
		}
	}
});

test('Rust indentation detection keeps the ten-thousand-line limit and avoids line transfers', context => {
	class IndentationBuffer extends rust.WasmTextBuffer {
		public static override from_text(text: string): IndentationBuffer { return new IndentationBuffer(encodeUTF16(text)); }
		public override line_batch(): never { throw new Error('Decoded indentation line transfer'); }
		public override line_content(): never { throw new Error('Copied indentation line transfer'); }
		public override line_length(): never { throw new Error('Separate indentation metadata transfer'); }
	}
	for (const text of ['root\n'.repeat(10000) + '  child\n    nested', 'const a = 1,\n' + ' '.repeat(65537) + '\uD800x,\n\t  \n  child']) {
		const reference = createBuffer([text]);
		const registration = registerRustTextBuffer({ ...rust, WasmTextBuffer: IndentationBuffer });
		let actual: PieceTreeTextBuffer;
		try { actual = createBuffer([text]); } finally { registration.dispose(); }
		context.after(() => { reference.dispose(); actual.dispose(); });
		for (const tabSize of [2, 4, 8]) {
			for (const insertSpaces of [false, true]) {
				assert.deepStrictEqual(guessIndentation(actual, tabSize, insertSpaces), guessIndentation(reference, tabSize, insertSpaces));
			}
		}
	}
});

test('Rust binding batches validate every original range and text slice before changing the document', () => {
	const original = new Uint16Array([97, 98, 99, 100, 101, 102]);
	const buffer = new rust.WasmTextBuffer(original);
	try {
		for (const ranges of [
			[0, 0],
			[0, 1, 0, 1, 5, 2, 0, 1],
			[0, 1, 0, 1, 3, 1, 1, 2],
			[0, 3, 0, 1, 2, 1, 0, 1],
			[3, 0, 0, 1, 1, 0, 0, 1]
		]) {
			assert.throws(() => buffer.apply_edits(new Uint32Array(ranges), new Uint16Array([65])));
			assert.deepStrictEqual(buffer.slice(0, buffer.length()), original);
		}
		buffer.apply_edits(new Uint32Array([1, 0, 0, 1, 1, 0, 1, 1, 3, 2, 2, 2]), new Uint16Array([65, 66, 0xD800, 0xDC00]));
		assert.deepStrictEqual(buffer.slice(0, buffer.length()), new Uint16Array([97, 65, 66, 98, 99, 0xD800, 0xDC00, 102]));
	} finally { buffer.free(); }
});

test('Rust model transactions validate packets atomically and retain unsupported-state fallback', context => {
	const buffer = new rust.WasmTextBuffer(new Uint16Array([97, 98, 99]));
	try {
		for (const ranges of [
			[1], [1, 1, 1, 2, 0, 2, 0], [0, 1, 1, 2, 0, 1, 0], [1, 1, 1, 2, 0, 1, 8],
			[1, 1, 1, 3, 0, 1, 0, 1, 2, 1, 4, 0, 1, 0]
		]) {
			assert.throws(() => buffer.apply_model_edits(new Uint32Array(ranges), new Uint16Array([88]), false, 0, true, true));
			assert.deepStrictEqual(buffer.slice(0, buffer.length()), new Uint16Array([97, 98, 99]));
		}
		assert.strictEqual(buffer.apply_model_edits(new Uint32Array([1, 1, 1, 1, 0, 4194305, 0]), new Uint16Array(4194305), false, 0, false, false), undefined);
		assert.deepStrictEqual(buffer.slice(0, buffer.length()), new Uint16Array([97, 98, 99]));
	} finally {
		buffer.free();
	}
	class UnsupportedBuffer extends rust.WasmTextBuffer {
		public static override from_text(text: string): UnsupportedBuffer { return new UnsupportedBuffer(encodeUTF16(text)); }
		public override apply_model_edits(): undefined { return undefined; }
	}
	const reference = createBuffer(['one\ntwo']);
	const registration = registerRustTextBuffer({ ...rust, WasmTextBuffer: UnsupportedBuffer });
	let actual: PieceTreeTextBuffer;
	try {
		actual = createBuffer(['one\ntwo']);
	} finally {
		registration.dispose();
	}
	context.after(() => { reference.dispose(); actual.dispose(); });
	const operations = annotate([{ range: new Range(1, 2, 2, 2), text: '\uD800\r\ninserted' }]);
	assert.deepStrictEqual(actual.applyEdits(operations, true, true), reference.applyEdits(operations, true, true));
	compareBuffers(reference, actual);
});

test('Rust model transactions share one boundary for normalization, inverse text, and whitespace state', context => {
	let calls = 0;
	class TransactionBuffer extends rust.WasmTextBuffer {
		public static override from_text(text: string): TransactionBuffer { return new TransactionBuffer(encodeUTF16(text)); }
		public override apply_model_edits(...args: Parameters<IRustTextBuffer['apply_model_edits']>): Uint8Array | undefined { calls++; return super.apply_model_edits(...args); }
		public override offset_at(): never { throw new Error('Separate model coordinate read'); }
		public override slice_text(): never { throw new Error('Separate model inverse text read'); }
		public override apply_edits(): never { throw new Error('Separate model application'); }
	}
	const reference = createBuffer([' \r\nword\r\n']);
	const registration = registerRustTextBuffer({ ...rust, WasmTextBuffer: TransactionBuffer });
	let actual: PieceTreeTextBuffer;
	try {
		actual = createBuffer([' \r\nword\r\n']);
	} finally {
		registration.dispose();
	}
	context.after(() => { reference.dispose(); actual.dispose(); });
	const operations = annotate([
		{ range: new Range(1, 2, 1, 2), text: '\t\n ', isAutoWhitespaceEdit: true },
		{ range: new Range(2, 2, 2, 3), text: '\uD802\uDC00\u2028\uD800', forceMoveMarkers: true }
	]);
	assert.deepStrictEqual({ result: actual.applyEdits(operations, true, true), calls, lines: actual.getLinesContent() }, { result: reference.applyEdits(operations, true, true), calls: 1, lines: reference.getLinesContent() });
});

test('Rust model text flags match existing classification for every UTF-16 unit and supplementary RTL pair', () => {
	const buffer = new rust.WasmTextBuffer(new Uint16Array());
	const ranges = new Uint32Array([1, 1, 1, 1, 0, 1, 0]);
	const compare = (text: string) => {
		ranges[3] = buffer.length() + 1;
		ranges[5] = text.length;
		const bytes = buffer.apply_model_edits(ranges, encodeUTF16(text), false, 0, false, false);
		assert.ok(bytes);
		assert.strictEqual(readUInt32BE(bytes, 0) & 7, (isBasicASCII(text) ? 0 : 1) | (containsRTL(text) ? 2 : 0) | (containsUnusualLineTerminators(text) ? 4 : 0), `Text flags ${JSON.stringify(text)}`);
		// A line break insertion changes the range contract; keep each classification independent.
		buffer.replace(0, buffer.length(), new Uint16Array());
	};
	try {
		for (let unit = 0; unit <= 0xFFFF; unit++) {
			compare(String.fromCharCode(unit));
		}
		for (const high of [0xD802, 0xD803, 0xD83A, 0xD83B]) {
			for (let low = 0xDBFF; low <= 0xE000; low++) {
				compare(String.fromCharCode(high, low));
			}
		}
	} finally {
		buffer.free();
	}
});

test('Rust model transactions preserve the thousand-edit reduction threshold and tracked metadata', context => {
	for (const count of [999, 1000, 1001]) {
		for (const tracked of [false, true]) {
			const [reference, actual] = createPair(context, ['x '.repeat(1024)]);
			const operations = Array.from({ length: count }, (_, index) => new ValidAnnotatedEditOperation({ major: index, minor: 1 }, new Range(1, index * 2 + 1, 1, index * 2 + 2), index % 7 === 0 ? '\uD800\r\n' : 'changed', index % 17 === 0, true, tracked && index === 0));
			operations.reverse();
			const result = actual.applyEdits(operations, true, true);
			assert.deepStrictEqual(result, reference.applyEdits(operations, true, true));
			compareBuffers(reference, actual);
			assert.strictEqual(result.changes.length, count >= 1000 && !tracked ? 1 : count);
		}
	}
});

test('Rust complete model transactions preserve seeded batch results in both EOL and undo modes', context => {
	let seed = 107;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const alphabet = ['a', ' ', '\t', '\n', '\r', '\r\n', '\uFEFF', '\uD800', '\uDC00', '\u05D0', '\uD803\uDC00', '\u2028'];
	for (const eol of [DefaultEndOfLine.LF, DefaultEndOfLine.CRLF]) {
		for (const record of [false, true]) {
			for (const undo of [false, true]) {
				const [reference, actual] = createPair(context, [' \n\t\ntext\n'.repeat(8)], eol);
				reference.setEOL(eol === DefaultEndOfLine.LF ? '\n' : '\r\n');
				actual.setEOL(reference.getEOL());
				for (let iteration = 0; iteration < 128; iteration++) {
					const offsets: number[] = [];
					for (let line = 1; line <= reference.getLineCount(); line++) {
						for (let column = 1; column <= reference.getLineMaxColumn(line); column++) {
							offsets.push(reference.getOffsetAt(line, column));
						}
					}
					let cursor = 0;
					const operations: ValidAnnotatedEditOperation[] = [];
					for (let index = 0, count = 1 + random(8); index < count; index++) {
						const start = cursor + random(offsets.length - cursor);
						const end = start + random(Math.min(16, offsets.length - start));
						const text = random(8) === 0 ? null : Array.from({ length: random(8) }, () => alphabet[random(alphabet.length)]).join('');
						operations.push(new ValidAnnotatedEditOperation({ major: iteration, minor: index }, reference.getRangeAt(offsets[start], offsets[end] - offsets[start]), text, !!random(2), !!random(2), !!random(2)));
						cursor = end;
					}
					for (let index = operations.length - 1; index > 0; index--) {
						const other = random(index + 1);
						[operations[index], operations[other]] = [operations[other], operations[index]];
					}
					if (iteration % 16 === 0) {
						reference.resetMightContainUnusualLineTerminators();
						actual.resetMightContainUnusualLineTerminators();
					}
					const before = readSnapshot(reference.createSnapshot(false));
					const snapshot = actual.createSnapshot(false);
					const expected = reference.applyEdits(operations, record, undo);
					const result = actual.applyEdits(operations, record, undo);
					const flags = (buffer: PieceTreeTextBuffer) => [buffer.mightContainNonBasicASCII(), buffer.mightContainRTL(), buffer.mightContainUnusualLineTerminators()];
					assert.deepStrictEqual({ result, lines: actual.getLinesContent(), flags: flags(actual), snapshot: readSnapshot(snapshot) }, { result: expected, lines: reference.getLinesContent(), flags: flags(reference), snapshot: before }, `Model transaction ${eol}/${record}/${undo}/${iteration}`);
					if (undo && iteration % 8 === 0) {
						assert.deepStrictEqual(actual.applyEdits(annotate(result.reverseEdits!), false, true), reference.applyEdits(annotate(expected.reverseEdits!), false, true));
						assert.strictEqual(readSnapshot(actual.createSnapshot(false)), before);
					}
				}
			}
		}
	}
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

test('Rust storage batches keep touching insertions, tracked edits, undo text, and snapshots in order', context => {
	for (const tracked of [false, true]) {
		const [reference, actual] = createPair(context, ['one\r\n'.repeat(256)]);
		const previous = readSnapshot(reference.createSnapshot(false));
		const snapshot = actual.createSnapshot(false);
		const operations = [
			new ValidAnnotatedEditOperation(null, new Range(1, 2, 1, 2), 'first\uD800', false, false, tracked),
			new ValidAnnotatedEditOperation(null, new Range(1, 2, 1, 3), 'changed\nline', false, false, tracked),
			new ValidAnnotatedEditOperation(null, new Range(1, 2, 1, 2), 'second\uDC00', false, false, tracked),
			...Array.from({ length: tracked ? 1000 : 32 }, (_, index) => new ValidAnnotatedEditOperation(null, new Range(200, 2, 200, 2), String(index), false, false, tracked))
		];
		const expected = reference.applyEdits(operations, true, true);
		const result = actual.applyEdits(operations, true, true);
		assert.deepStrictEqual(result, expected);
		compareBuffers(reference, actual);
		assert.strictEqual(readSnapshot(snapshot), previous);
		reference.applyEdits(annotate(expected.reverseEdits!), true, false);
		actual.applyEdits(annotate(result.reverseEdits!), true, false);
		compareBuffers(reference, actual);
	}
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
