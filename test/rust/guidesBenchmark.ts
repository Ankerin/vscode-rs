/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<{ memory: WebAssembly.Memory }>;
}

const engine = process.argv[2];
if (engine !== 'existing' && engine !== 'rust') {
	throw new Error('Select the existing or Rust guide engine');
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
	shortLines: 'root\n  child\n    nested\n\n'.repeat(2048),
	unicode: 'root\u03A9\n  child\uD800x\n    nested\uD83D\uDE00\uFEFF\n\n'.repeat(2048),
	longPrefixes: 'root\n' + ' \t'.repeat(65536) + 'child\n  root\n    child\n',
	whitespace: 'root\n' + ' \t\n'.repeat(8192) + '    child\n'
};
const text = fixtures[fixture];
if (text === undefined) { throw new Error('Select a known guide fixture'); }
const model = createTextModel(text, null, { tabSize: 4, indentSize: 2, detectIndentation: false });
const count = model.getLineCount();
const ranges = Array.from({ length: 20 }, (_, index) => {
	const start = (Math.imul(index + 1, 7919) >>> 0) % count + 1;
	return [start, Math.min(count, start + 127)];
});
const activeQueries = fixture === 'whitespace' ? 100 : 1000;
let checksum = 0;
const measurements: Record<string, number> = {};
try {
	for (const [start, end] of ranges) {
		for (const indent of model.guides.getLinesIndentGuides(start, end)) { checksum += indent; }
		const active = model.guides.getActiveIndentGuide(start, 1, count);
		checksum += active.startLineNumber + active.endLineNumber + active.indent;
	}
	global.gc?.();
	const baseline = process.memoryUsage();
	let start = performance.now();
	for (let index = 0; index < 100; index++) {
		const [first, last] = ranges[index % ranges.length];
		for (const indent of model.guides.getLinesIndentGuides(first, last)) { checksum += indent; }
	}
	measurements.viewport_guides_ms = performance.now() - start;
	start = performance.now();
	for (let index = 0; index < activeQueries; index++) {
		const line = ranges[index % ranges.length][0];
		const result = model.guides.getActiveIndentGuide(line, 1, count);
		checksum += result.startLineNumber + result.endLineNumber + result.indent;
	}
	measurements.active_guides_ms = performance.now() - start;
	const observed = process.memoryUsage();
	process.stdout.write(JSON.stringify({
		engine, fixture, inputUtf16Units: text.length, viewportQueries: 100, activeQueries,
		measurements,
		memory: { rssDeltaBytes: observed.rss - baseline.rss, heapUsedDeltaBytes: observed.heapUsed - baseline.heapUsed, peakRssBytes: process.resourceUsage().maxRSS * 1024, wasmLinearMemoryBytes: memory?.buffer.byteLength ?? 0 },
		checksum
	}));
} finally {
	model.dispose();
	registration?.dispose();
}
