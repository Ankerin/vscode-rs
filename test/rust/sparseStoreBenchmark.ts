/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { LanguageIdCodec } from '../../src/vs/editor/common/services/languagesRegistry.js';
import { LineTokens } from '../../src/vs/editor/common/tokens/lineTokens.js';
import { IRustTokensModule, registerRustTokens } from '../../src/vs/editor/common/tokens/rustTokens.js';
import { SparseMultilineTokens } from '../../src/vs/editor/common/tokens/sparseMultilineTokens.js';
import { SparseTokensStore } from '../../src/vs/editor/common/tokens/sparseTokensStore.js';

interface IRustModule extends IRustTokensModule {
	default(options: { module_or_path: Uint8Array }): Promise<{ memory: WebAssembly.Memory }>;
}

const engine = process.argv[2];
if (engine !== 'existing' && engine !== 'rust') { throw new Error('Select the existing or Rust sparse store'); }
let memory: WebAssembly.Memory | undefined;
let registration: ReturnType<typeof registerRustTokens> | undefined;
if (engine === 'rust') {
	const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
	const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
	memory = (await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) })).memory;
	registration = registerRustTokens(rust);
}
const fixture = process.argv[3];
if (!['small', 'dense', 'multiline', 'manyPieces'].includes(fixture)) { throw new Error('Select a known sparse-store fixture'); }
const pieces = fixture === 'manyPieces' ? 4096 : fixture === 'small' ? 8 : 64;
const linesPerPiece = fixture === 'manyPieces' ? 1 : fixture === 'small' ? 4 : 8;
const count = fixture === 'dense' ? 32 : fixture === 'manyPieces' ? 1 : 4;
const lines = pieces * linesPerPiece;
const codec = new LanguageIdCodec();
const text = 'x'.repeat(count * 8);
const syntax = new LineTokens(new Uint32Array([text.length, 0x82010401]), text, codec);
const words = (line: number) => Array.from({ length: count }, (_, index) => [0, index * 8 + 1, index * 8 + 6, (Math.imul(line + index + 1, 104729) | 63) >>> 0]).flat();
const input = Array.from({ length: pieces }, (_, piece) => SparseMultilineTokens.create(piece * linesPerPiece + 1,
	new Uint32Array(Array.from({ length: linesPerPiece }, (_, line) => words(piece * linesPerPiece + line).map((word, index) => index % 4 === 0 ? line : word)).flat())));
const store = new SparseTokensStore(codec);
store.set(input, true);
const positions = Array.from({ length: 32 }, (_, index) => {
	const line = (Math.imul(index + 1, 7919) >>> 0) % lines + 1;
	return new Range(line, 3, line, 3);
});
const updates = Array.from({ length: 232 }, (_, index) => {
	const line = positions[index % positions.length].startLineNumber;
	return { range: new Range(line, 1, line, text.length + 1), pieces: [SparseMultilineTokens.create(line, new Uint32Array(words(line - 1)))] };
});
let checksum = 0;
const consume = (line: number) => {
	for (const word of store.addSparseTokens(line, syntax).getEncodedTokens()) { checksum = (Math.imul(checksum, 31) + word) >>> 0; }
};
const edit = (index: number) => {
	const range = positions[index % positions.length];
	store.acceptEdit(range, fixture === 'multiline' ? 1 : 0, 1, 1, 97);
	store.acceptEdit(fixture === 'multiline' ? new Range(range.startLineNumber, 3, range.startLineNumber + 1, 2) : new Range(range.startLineNumber, 3, range.startLineNumber, 4), 0, 0, 0, 0);
	consume(range.startLineNumber);
};
const partial = (index: number) => {
	const update = updates[index];
	const range = store.setPartial(update.range, update.pieces);
	checksum = (checksum + range.startLineNumber + range.startColumn + range.endLineNumber + range.endColumn) >>> 0;
	consume(range.startLineNumber);
};
const measurements: Record<string, number> = {};
try {
	for (let index = 0; index < 32; index++) { edit(index); partial(index); }
	global.gc?.();
	const baseline = process.memoryUsage();
	let start = performance.now();
	for (let index = 0; index < 200; index++) { edit(index); }
	measurements.sparse_store_edit_pairs_ms = performance.now() - start;
	start = performance.now();
	for (let index = 32; index < 232; index++) { partial(index); }
	measurements.sparse_store_partial_updates_ms = performance.now() - start;
	start = performance.now();
	for (let index = 0; index < 10000; index++) { consume(positions[index % positions.length].startLineNumber); }
	measurements.sparse_store_line_reads_ms = performance.now() - start;
	// Consume the retained input aliases, including mutations to every remaining block.
	for (const piece of input) {
		checksum = (checksum + piece.startLineNumber + piece.endLineNumber) >>> 0;
		for (let line = piece.startLineNumber; line <= piece.endLineNumber; line++) {
			for (const word of piece.getLineTokens(line)?.getEncodedTokens() ?? []) { checksum = (Math.imul(checksum, 31) + word) >>> 0; }
		}
	}
	const observed = process.memoryUsage();
	process.stdout.write(JSON.stringify({
		engine, fixture, inputUtf16Units: lines * text.length, pieces, linesPerPiece, tokensPerLine: count, editPairs: 200, partialUpdates: 200, lineReads: 10000,
		measurements,
		memory: { rssDeltaBytes: observed.rss - baseline.rss, heapUsedDeltaBytes: observed.heapUsed - baseline.heapUsed, peakRssBytes: process.resourceUsage().maxRSS * 1024, wasmLinearMemoryBytes: memory?.buffer.byteLength ?? 0 },
		checksum
	}));
} finally { store.dispose(); registration?.dispose(); }
