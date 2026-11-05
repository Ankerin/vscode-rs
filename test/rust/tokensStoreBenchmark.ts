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
import { ContiguousTokensStore } from '../../src/vs/editor/common/tokens/contiguousTokensStore.js';
import { LanguageIdCodec } from '../../src/vs/editor/common/services/languagesRegistry.js';

interface IRustModule extends IRustTokensModule {
	default(options: { module_or_path: Uint8Array }): Promise<{ memory: WebAssembly.Memory }>;
}

const engine = process.argv[2];
if (engine !== 'existing' && engine !== 'rust') { throw new Error('Select the existing or Rust token store'); }
let memory: WebAssembly.Memory | undefined;
let registration: ReturnType<typeof registerRustTokens> | undefined;
if (engine === 'rust') {
	const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
	const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
	memory = (await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) })).memory;
	registration = registerRustTokens(rust);
}
const fixture = process.argv[3];
if (!['small', 'dense', 'multiline', 'manyLines'].includes(fixture)) { throw new Error('Select a known token-store fixture'); }
const lines = fixture === 'manyLines' ? 32768 : fixture === 'dense' ? 1024 : 32;
const count = fixture === 'manyLines' ? 1 : fixture === 'dense' ? 128 : 4;
const text = 'x'.repeat(count * 8);
const inputs = Array.from({ length: lines }, (_, line) => new Uint32Array(Array.from({ length: count }, (_, index) => [(index + 1) * 8, (Math.imul(line + index + 1, 104729) | 0x82010401) >>> 0]).flat()));
const store = new ContiguousTokensStore(new LanguageIdCodec());
for (let index = 0; index < lines; index++) { store.setTokens('plaintext', index, text.length, inputs[index], false); }
const positions = Array.from({ length: 32 }, (_, index) => {
	const line = (Math.imul(index + 1, 7919) >>> 0) % lines + 1;
	return new Range(line, 3, line, 3);
});
let checksum = 0;
const consume = (line: number) => {
	for (const word of store.getTokens('plaintext', line - 1, text).getEncodedTokens()) { checksum = (Math.imul(checksum, 31) + word) >>> 0; }
};
const edit = (index: number) => {
	const position = positions[index % positions.length];
	store.acceptEdit(position, fixture === 'multiline' ? 1 : 0, fixture === 'multiline' ? 5 : 1);
	store.acceptEdit(fixture === 'multiline' ? new Range(position.startLineNumber, 3, position.startLineNumber + 1, 5) : new Range(position.startLineNumber, 3, position.startLineNumber, 4), 0, 0);
	consume(position.startLineNumber);
};
const set = (index: number) => {
	const line = positions[index % positions.length].startLineNumber;
	checksum = (checksum + Number(store.setTokens('plaintext', line - 1, text.length, inputs[line - 1], true))) >>> 0;
	consume(line);
};
const measurements: Record<string, number> = {};
try {
	for (let index = 0; index < 32; index++) { edit(index); set(index); }
	global.gc?.();
	const baseline = process.memoryUsage();
	let start = performance.now();
	for (let index = 0; index < 1000; index++) { edit(index); }
	measurements.store_edit_pairs_ms = performance.now() - start;
	start = performance.now();
	for (let index = 0; index < 1000; index++) { set(index); }
	measurements.store_equality_updates_ms = performance.now() - start;
	start = performance.now();
	for (let index = 0; index < 10000; index++) { consume(positions[index % positions.length].startLineNumber); }
	measurements.store_line_reads_ms = performance.now() - start;
	const observed = process.memoryUsage();
	process.stdout.write(JSON.stringify({
		engine, fixture, inputUtf16Units: lines * text.length, lines, tokensPerLine: count, editPairs: 1000, equalityUpdates: 1000, lineReads: 10000,
		measurements,
		memory: { rssDeltaBytes: observed.rss - baseline.rss, heapUsedDeltaBytes: observed.heapUsed - baseline.heapUsed, peakRssBytes: process.resourceUsage().maxRSS * 1024, wasmLinearMemoryBytes: memory?.buffer.byteLength ?? 0 },
		checksum
	}));
} finally { store.dispose(); registration?.dispose(); }
