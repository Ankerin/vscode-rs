/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { DefaultEndOfLine, EndOfLinePreference } from '../../src/vs/editor/common/model.js';
import { createTextBuffer } from '../../src/vs/editor/common/model/textModel.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { guessIndentation } from '../../src/vs/editor/common/model/indentationGuesser.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<{ memory: WebAssembly.Memory }>;
}

const engine = process.argv[2];
if (engine !== 'existing' && engine !== 'rust') {
	throw new Error('Select the existing or Rust model query engine');
}
let memory: WebAssembly.Memory | undefined;
let registration: ReturnType<typeof registerRustTextBuffer> | undefined;
if (engine === 'rust') {
	const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
	const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
	memory = (await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) })).memory;
	registration = registerRustTextBuffer(rust);
}
const fixture = process.argv[3];
const fixtures: Record<string, string> = {
	shortLines: ' \ttext\u03A9\t \n'.repeat(8192),
	unicode: ' \t\uFEFF\u03A9\u6F22\uD800x\uD83D\uDE00 \n'.repeat(8192),
	longLine: ' '.repeat(65536) + '\uD800x\uD83D\uDE00' + '\t'.repeat(65536) + '\n',
	whitespace: (' \t'.repeat(64) + '\n').repeat(1024) + '\uFEFF\n'
};
const text = fixtures[fixture];
if (text === undefined) {
	throw new Error('Select a known model query fixture');
}
const document = createTextBuffer(text, DefaultEndOfLine.LF);
const buffer = document.textBuffer;
const lineCount = buffer.getLineCount();
const columnQueries = fixture === 'longLine' ? 1000 : 10000;
const ranges = Array.from({ length: 20 }, (_, index) => {
	const start = (Math.imul(index + 1, 7919) >>> 0) % lineCount + 1;
	const end = start + (Math.imul(index + 1, 104729) >>> 0) % (lineCount - start + 1);
	return new Range(start, 1, end, buffer.getLineMaxColumn(end));
});
let checksum = 0;
const measurements: Record<string, number> = {};
const preferences = [EndOfLinePreference.TextDefined, EndOfLinePreference.LF, EndOfLinePreference.CRLF];
try {
	for (const range of ranges) {
		checksum += buffer.getCharacterCountInRange(range, EndOfLinePreference.TextDefined);
		checksum += buffer.getLineFirstNonWhitespaceColumn(range.startLineNumber) + buffer.getLineLastNonWhitespaceColumn(range.endLineNumber);
	}
	for (const insertSpaces of [true, false]) {
		const result = guessIndentation(buffer, 4, insertSpaces);
		checksum += result.tabSize + (result.insertSpaces ? 1 : 0);
	}
	global.gc?.();
	const baseline = process.memoryUsage();
	let start = performance.now();
	for (let index = 0; index < columnQueries; index++) {
		const line = (Math.imul(index + 1, 7919) >>> 0) % lineCount + 1;
		checksum += buffer.getLineFirstNonWhitespaceColumn(line) + buffer.getLineLastNonWhitespaceColumn(line);
	}
	measurements.whitespace_column_queries_ms = performance.now() - start;
	start = performance.now();
	for (let index = 0; index < 200; index++) {
		checksum += buffer.getCharacterCountInRange(ranges[index % ranges.length], preferences[index % preferences.length]);
	}
	measurements.character_count_queries_ms = performance.now() - start;
	start = performance.now();
	for (let index = 0; index < 100; index++) {
		const result = guessIndentation(buffer, 4, index % 2 === 0);
		checksum += result.tabSize + (result.insertSpaces ? 1 : 0);
	}
	measurements.indentation_queries_ms = performance.now() - start;
	const observed = process.memoryUsage();
	process.stdout.write(JSON.stringify({
		engine, fixture, inputUtf16Units: text.length, columnQueries, characterQueries: 200, indentationQueries: 100,
		measurements,
		memory: { rssDeltaBytes: observed.rss - baseline.rss, heapUsedDeltaBytes: observed.heapUsed - baseline.heapUsed, peakRssBytes: process.resourceUsage().maxRSS * 1024, wasmLinearMemoryBytes: memory?.buffer.byteLength ?? 0 },
		checksum
	}));
} finally {
	document.disposable.dispose();
	registration?.dispose();
}
