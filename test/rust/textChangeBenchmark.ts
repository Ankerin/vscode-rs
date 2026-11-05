/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { compressConsecutiveTextChanges, TextChange } from '../../src/vs/editor/common/core/textChange.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<{ memory: WebAssembly.Memory }>;
}

const engine = process.argv[2];
const fixture = process.argv[3];
if (engine !== 'existing' && engine !== 'rust') {
	throw new Error('Select the existing or rust undo composition engine');
}
const repetitions: Record<string, number> = { typing: 10000, multicursor: 100, fragmented: 30, unicode: 30 };
const count = repetitions[fixture];
if (!count) {
	throw new Error('Select a known undo composition fixture');
}
let memory: WebAssembly.Memory | undefined;
let registration: ReturnType<typeof registerRustTextBuffer> | undefined;
if (engine === 'rust') {
	const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
	const module = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
	memory = (await module.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) })).memory;
	registration = registerRustTextBuffer(module);
}
let previous: TextChange[];
let current: TextChange[];
if (fixture === 'typing') {
	previous = [new TextChange(100, '', 100, 'abcdefgh')];
	current = [new TextChange(108, '', 108, 'i')];
} else if (fixture === 'multicursor') {
	previous = Array.from({ length: 1024 }, (_, index) => new TextChange(index * 4, 'a', index * 5, 'xy'));
	current = Array.from({ length: 1024 }, (_, index) => new TextChange(index * 5, 'xy', index * 4, 'z'));
} else {
	const text = (fixture === 'unicode' ? '\u03A9\u6F22\uD83D\uDE00\uD800\uFEFF' : 'abcdef').repeat(16384);
	previous = [new TextChange(0, '', 0, text)];
	current = Array.from({ length: 512 }, (_, index) => new TextChange(index * 192, text.slice(index * 192, index * 192 + 6), index * 192, 'change'));
}
try {
	for (let index = 0; index < 3; index++) {
		compressConsecutiveTextChanges(previous, current);
	}
	global.gc?.();
	const baseline = process.memoryUsage();
	const start = performance.now();
	let changes: TextChange[] = [];
	for (let index = 0; index < count; index++) {
		changes = compressConsecutiveTextChanges(previous, current);
	}
	const elapsed = performance.now() - start;
	const observed = process.memoryUsage();
	let checksum = 2166136261;
	const text = JSON.stringify(changes);
	for (let index = 0; index < text.length; index++) {
		checksum = Math.imul(checksum ^ text.charCodeAt(index), 16777619) >>> 0;
	}
	process.stdout.write(JSON.stringify({
		engine, fixture, repetitions: count, inputUtf16Units: [...previous, ...current].reduce((length, change) => length + change.oldLength + change.newLength, 0),
		measurements: { compose_batches_ms: elapsed },
		memory: { rssDeltaBytes: observed.rss - baseline.rss, heapUsedDeltaBytes: observed.heapUsed - baseline.heapUsed, peakRssBytes: process.resourceUsage().maxRSS * 1024, wasmLinearMemoryBytes: memory?.buffer.byteLength ?? 0 },
		checksum
	}));
} finally {
	registration?.dispose();
}
