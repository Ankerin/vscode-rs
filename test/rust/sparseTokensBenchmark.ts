/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { IRustTokensModule, registerRustTokens } from '../../src/vs/editor/common/tokens/rustTokens.js';
import { SparseMultilineTokens } from '../../src/vs/editor/common/tokens/sparseMultilineTokens.js';

interface IRustModule extends IRustTokensModule {
	default(options: { module_or_path: Uint8Array }): Promise<{ memory: WebAssembly.Memory }>;
}

const engine = process.argv[2];
if (engine !== 'existing' && engine !== 'rust') { throw new Error('Select the existing or Rust sparse token engine'); }
let memory: WebAssembly.Memory | undefined;
let registration: ReturnType<typeof registerRustTokens> | undefined;
if (engine === 'rust') {
	const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
	const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
	memory = (await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) })).memory;
	registration = registerRustTokens(rust);
}
const fixture = process.argv[3];
if (!['small', 'dense', 'multiline', 'unicode'].includes(fixture)) { throw new Error('Select a known sparse token fixture'); }
const count = fixture === 'small' ? 8 : 8192;
const records = new Uint32Array(Array.from({ length: count }, (_, index) => [Math.floor(index / 8), (index % 8) * 8, (index % 8) * 8 + 6, (Math.imul(index + 1, 104729) | 63) >>> 0]).flat());
const piece = SparseMultilineTokens.create(1, records);
const calls = fixture === 'small' ? 10000 : 1000;
const positions = Array.from({ length: 32 }, (_, index) => {
	const line = (Math.imul(index + 1, 7919) >>> 0) % (count / 8) + 1;
	return new Range(line, 3, line, 3);
});
const inserted = fixture === 'multiline' ? 'first\nlast' : fixture === 'unicode' ? '\uD800\uD83D\uDE00' : 'x';
const inverse = positions.map(range => fixture === 'multiline' ? new Range(range.startLineNumber, 3, range.startLineNumber + 1, 5) : new Range(range.startLineNumber, 3, range.startLineNumber, 3 + inserted.length));
const splitRange = new Range(Math.max(1, Math.floor(count / 16)), 1, Math.max(1, Math.floor(count / 16)) + 1, 1);
let checksum = 0;
const consume = (tokens: Uint32Array) => { for (const word of tokens) { checksum = (Math.imul(checksum, 31) + word) >>> 0; } };
const edit = (index: number) => {
	piece.applyEdit(positions[index % positions.length], inserted);
	piece.applyEdit(inverse[index % inverse.length], '');
	consume(records);
	checksum = (checksum + piece.startLineNumber + piece.endLineNumber) >>> 0;
};
const split = () => {
	for (const part of piece.split(splitRange)) {
		checksum = (checksum + part.startLineNumber + part.endLineNumber) >>> 0;
		for (let line = part.startLineNumber; line <= part.endLineNumber; line++) {
			const tokens = part.getLineTokens(line);
			if (tokens) { consume(tokens.getEncodedTokens()); }
		}
	}
};
const measurements: Record<string, number> = {};
try {
	for (let index = 0; index < 32; index++) { edit(index); split(); }
	global.gc?.();
	const baseline = process.memoryUsage();
	let start = performance.now();
	for (let index = 0; index < calls; index++) { edit(index); }
	measurements.sparse_edit_pairs_ms = performance.now() - start;
	start = performance.now();
	for (let index = 0; index < calls; index++) { split(); }
	measurements.sparse_split_ms = performance.now() - start;
	const observed = process.memoryUsage();
	process.stdout.write(JSON.stringify({
		engine, fixture, inputUtf16Units: 0, tokens: count, calls,
		measurements,
		memory: { rssDeltaBytes: observed.rss - baseline.rss, heapUsedDeltaBytes: observed.heapUsed - baseline.heapUsed, peakRssBytes: process.resourceUsage().maxRSS * 1024, wasmLinearMemoryBytes: memory?.buffer.byteLength ?? 0 },
		checksum
	}));
} finally { registration?.dispose(); }
