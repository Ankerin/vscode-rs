/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { IRustTokensModule, registerRustTokens } from '../../src/vs/editor/common/tokens/rustTokens.js';
import { LineTokens } from '../../src/vs/editor/common/tokens/lineTokens.js';
import { SparseMultilineTokens } from '../../src/vs/editor/common/tokens/sparseMultilineTokens.js';
import { SparseTokensStore } from '../../src/vs/editor/common/tokens/sparseTokensStore.js';
import { LanguageIdCodec } from '../../src/vs/editor/common/services/languagesRegistry.js';

interface IRustModule extends IRustTokensModule {
	default(options: { module_or_path: Uint8Array }): Promise<{ memory: WebAssembly.Memory }>;
}

const engine = process.argv[2];
if (engine !== 'existing' && engine !== 'rust') { throw new Error('Select the existing or Rust token engine'); }
let memory: WebAssembly.Memory | undefined;
let registration: ReturnType<typeof registerRustTokens> | undefined;
if (engine === 'rust') {
	const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
	const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
	memory = (await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) })).memory;
	registration = registerRustTokens(rust);
}
const fixture = process.argv[3];
if (!['shortLines', 'dense', 'unicode', 'clamped'].includes(fixture)) { throw new Error('Select a known token fixture'); }
const count = fixture === 'shortLines' ? 8 : 2048;
const text = (fixture === 'unicode' ? 'a\uD800\uD83D\uDE00' : 'text').repeat(count);
const codec = new LanguageIdCodec();
const syntax = new LineTokens(new Uint32Array(Array.from({ length: count }, (_, index) => [4 * (index + 1), (Math.imul(index + 1, 7919) | 0x82010407) >>> 0]).flat()), text, codec);
const store = new SparseTokensStore(codec);
store.set([SparseMultilineTokens.create(1, new Uint32Array(Array.from({ length: count / 2 }, (_, index) => [
	0, index * (fixture === 'clamped' ? 12 : 8) + 1, index * (fixture === 'clamped' ? 12 : 8) + 7, (Math.imul(index + 1, 104729) | 63) >>> 0
]).flat()))], true);
const calls = fixture === 'shortLines' ? 100000 : 1000;
let checksum = 0;
const merge = () => {
	const result = store.addSparseTokens(1, syntax).getEncodedTokens();
	for (const word of result) { checksum = (Math.imul(checksum, 31) + word) >>> 0; }
};
try {
	for (let index = 0; index < 128; index++) { merge(); }
	global.gc?.();
	const baseline = process.memoryUsage();
	const start = performance.now();
	for (let index = 0; index < calls; index++) { merge(); }
	const elapsed = performance.now() - start;
	const observed = process.memoryUsage();
	process.stdout.write(JSON.stringify({
		engine, fixture, inputUtf16Units: text.length, calls, syntaxTokens: count, semanticTokens: count / 2,
		measurements: { semantic_merge_ms: elapsed },
		memory: { rssDeltaBytes: observed.rss - baseline.rss, heapUsedDeltaBytes: observed.heapUsed - baseline.heapUsed, peakRssBytes: process.resourceUsage().maxRSS * 1024, wasmLinearMemoryBytes: memory?.buffer.byteLength ?? 0 },
		checksum
	}));
} finally {
	store.dispose();
	registration?.dispose();
}
