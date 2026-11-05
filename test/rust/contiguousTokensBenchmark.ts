/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { IRustTokensModule, registerRustTokens } from '../../src/vs/editor/common/tokens/rustTokens.js';
import { ContiguousTokensEditing, toUint32Array } from '../../src/vs/editor/common/tokens/contiguousTokensEditing.js';

interface IRustModule extends IRustTokensModule {
	default(options: { module_or_path: Uint8Array }): Promise<{ memory: WebAssembly.Memory }>;
}

const engine = process.argv[2];
if (engine !== 'existing' && engine !== 'rust') { throw new Error('Select the existing or Rust contiguous token engine'); }
let memory: WebAssembly.Memory | undefined;
let registration: ReturnType<typeof registerRustTokens> | undefined;
if (engine === 'rust') {
	const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
	const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
	memory = (await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) })).memory;
	registration = registerRustTokens(rust);
}
const fixture = process.argv[3];
if (!['small', 'dense', 'suffix', 'longLine'].includes(fixture)) { throw new Error('Select a known contiguous token fixture'); }
const count = fixture === 'small' ? 8 : fixture === 'longLine' ? 1 : 8192;
const width = fixture === 'longLine' ? 1048576 : 8;
const tokens = new Uint32Array(Array.from({ length: count }, (_, index) => [(index + 1) * width, (Math.imul(index + 1, 104729) | 0x82010407) >>> 0]).flat());
const calls = count < 16 ? 10000 : 1000;
const character = fixture === 'suffix' ? count * width - 2 : 2;
let checksum = 0;
const consume = (words: Uint32Array) => { for (const word of words) { checksum = (Math.imul(checksum, 31) + word) >>> 0; } };
const edit = () => {
	ContiguousTokensEditing.insert(tokens, character, 1);
	ContiguousTokensEditing.delete(tokens, character, character + 1);
	consume(tokens);
};
const append = () => {
	const result = ContiguousTokensEditing.append(tokens, tokens);
	if (result === null) { throw new Error('Unexpected missing appended tokens'); }
	consume(toUint32Array(result));
};
const measurements: Record<string, number> = {};
try {
	for (let index = 0; index < 32; index++) { edit(); append(); }
	global.gc?.();
	const baseline = process.memoryUsage();
	let start = performance.now();
	for (let index = 0; index < calls; index++) { edit(); }
	measurements.contiguous_edit_pairs_ms = performance.now() - start;
	start = performance.now();
	for (let index = 0; index < calls; index++) { append(); }
	measurements.contiguous_append_ms = performance.now() - start;
	const observed = process.memoryUsage();
	process.stdout.write(JSON.stringify({
		engine, fixture, inputUtf16Units: count * width, tokens: count, calls,
		measurements,
		memory: { rssDeltaBytes: observed.rss - baseline.rss, heapUsedDeltaBytes: observed.heapUsed - baseline.heapUsed, peakRssBytes: process.resourceUsage().maxRSS * 1024, wasmLinearMemoryBytes: memory?.buffer.byteLength ?? 0 },
		checksum
	}));
} finally { registration?.dispose(); }
