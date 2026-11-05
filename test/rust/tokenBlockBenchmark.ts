/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { ContiguousMultilineTokens } from '../../src/vs/editor/common/tokens/contiguousMultilineTokens.js';
import { EMPTY_LINE_TOKENS, toUint32Array } from '../../src/vs/editor/common/tokens/contiguousTokensEditing.js';
import { IRustTokensModule, registerRustTokens } from '../../src/vs/editor/common/tokens/rustTokens.js';

interface IRustModule extends IRustTokensModule {
	default(options: { module_or_path: Uint8Array }): Promise<{ memory: WebAssembly.Memory }>;
}

const engine = process.argv[2];
if (engine !== 'existing' && engine !== 'rust') { throw new Error('Select the existing or Rust token-block engine'); }
let memory: WebAssembly.Memory | undefined;
let registration: ReturnType<typeof registerRustTokens> | undefined;
if (engine === 'rust') {
	const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
	const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
	memory = (await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) })).memory;
	registration = registerRustTokens(rust);
}
const fixture = process.argv[3];
if (!['small', 'dense', 'prefix', 'manyLines'].includes(fixture)) { throw new Error('Select a known token-block fixture'); }
const lines = fixture === 'manyLines' ? 32768 : fixture === 'dense' ? 64 : 8;
const count = fixture === 'dense' ? 128 : fixture === 'manyLines' ? 1 : 4;
const startLine = 5;
const inputs = Array.from({ length: lines }, (_, line) => new Uint32Array(Array.from({ length: count }, (_, index) => [(index + 1) * 8, (Math.imul(line + index + 1, 104729) | 0x82010401) >>> 0]).flat()));
const store = new ContiguousMultilineTokens(startLine, inputs.slice());
const positions = Array.from({ length: 32 }, (_, index) => {
	const line = (Math.imul(index + 1, 7919) >>> 0) % lines + startLine;
	return new Range(line, 3, line, 4);
});
const multiline = fixture === 'prefix' ? new Range(1, 1, startLine + 2, 3) : new Range(startLine, 3, startLine + 2, 4);
let checksum = 0;
const consume = (piece: ContiguousMultilineTokens, line: number) => {
	const tokens = piece.getLineTokens(line);
	checksum = (checksum + piece.startLineNumber + piece.endLineNumber + Number(tokens === null) + Number(tokens === EMPTY_LINE_TOKENS)) >>> 0;
	if (tokens !== null && tokens !== undefined) {
		for (const word of toUint32Array(tokens)) { checksum = (Math.imul(checksum, 31) + word) >>> 0; }
	}
};
const edit = (index: number) => {
	const range = positions[index % positions.length];
	store.applyEdit(range, 'a');
	consume(store, range.startLineNumber);
};
const prepare = () => new ContiguousMultilineTokens(startLine, inputs.map(tokens => tokens.slice()));
const change = (piece: ContiguousMultilineTokens) => {
	piece.applyEdit(multiline, 'first\nlast');
	consume(piece, piece.startLineNumber);
	consume(piece, piece.endLineNumber);
};
const measurements: Record<string, number> = {};
try {
	for (let index = 0; index < 32; index++) { edit(index); change(prepare()); }
	global.gc?.();
	const baseline = process.memoryUsage();
	let start = performance.now();
	for (let index = 0; index < 1000; index++) { edit(index); }
	measurements.block_replacements_ms = performance.now() - start;
	let elapsed = 0;
	for (let index = 0; index < 200; index++) {
		const piece = prepare();
		start = performance.now();
		change(piece);
		elapsed += performance.now() - start;
	}
	measurements.block_multiline_edits_ms = elapsed;
	for (const tokens of inputs) {
		for (const word of tokens) { checksum = (Math.imul(checksum, 31) + word) >>> 0; }
	}
	const observed = process.memoryUsage();
	process.stdout.write(JSON.stringify({
		engine, fixture, inputUtf16Units: lines * count * 8, lines, tokensPerLine: count, replacements: 1000, multilineEdits: 200,
		measurements,
		memory: { rssDeltaBytes: observed.rss - baseline.rss, heapUsedDeltaBytes: observed.heapUsed - baseline.heapUsed, peakRssBytes: process.resourceUsage().maxRSS * 1024, wasmLinearMemoryBytes: memory?.buffer.byteLength ?? 0 },
		checksum
	}));
} finally { registration?.dispose(); }
