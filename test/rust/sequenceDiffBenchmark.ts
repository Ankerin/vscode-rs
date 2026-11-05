/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { DynamicProgrammingDiffing } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/dynamicProgrammingDiffing.js';
import { MyersDiffAlgorithm } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/myersDiffAlgorithm.js';
import { DefaultLinesDiffComputer } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { ArraySequence } from './testSequence.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<{ memory: WebAssembly.Memory }>;
}

const engine = process.argv[2];
if (engine !== 'existing' && engine !== 'rust') {
	throw new Error('Select the existing or rust sequence diff');
}
const fixture = process.argv[3];
const fixtures: Record<string, number> = { small: 120, medium: 800, large: 4000, unicode: 500 };
const lineCount = fixtures[fixture];
if (!lineCount) {
	throw new Error('Select a known sequence diff fixture');
}
let memory: WebAssembly.Memory | undefined;
let registration: ReturnType<typeof registerRustTextBuffer> | undefined;
if (engine === 'rust') {
	const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
	const module = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
	const result = await module.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });
	memory = result.memory;
	registration = registerRustTextBuffer(module);
}
const original = Array.from({ length: lineCount }, (_, index) => `\tfunction example${index}() { return "${fixture === 'unicode' ? '\u03A9\u6F22\uD83D\uDE00\uD800' : 'source'} ${index % 17}"; }`);
const modified = original.map((line, index) => index % 17 === 0 ? line.replace('return', 'yield') : line);
modified.splice(Math.floor(lineCount / 2), 0, ...modified.splice(20, 8));
const elements = Array.from({ length: Math.min(lineCount, 800) }, (_, index) => index % 97);
const modifiedElements = elements.map((element, index) => index % 13 === 0 ? element + 100 : element);
const sequence1 = new ArraySequence(elements);
const sequence2 = new ArraySequence(modifiedElements);
const computer = new DefaultLinesDiffComputer();
const dynamic = new DynamicProgrammingDiffing();
const myers = new MyersDiffAlgorithm();
const options = { ignoreTrimWhitespace: false, maxComputationTimeMs: 0, computeMoves: true, extendToSubwords: true };
const measurements: Record<string, number> = {};
let checksum = 2166136261;

function repeat<T>(count: number, operation: () => T): T {
	let result = operation();
	for (let iteration = 1; iteration < count; iteration++) {
		result = operation();
	}
	return result;
}

function measure<T>(name: string, operation: () => T): void {
	const start = performance.now();
	const result = operation();
	measurements[name] = performance.now() - start;
	// Check results outside the timing interval without retaining every iteration's output.
	const text = JSON.stringify(result);
	for (let index = 0; index < text.length; index++) {
		checksum = Math.imul(checksum ^ text.charCodeAt(index), 16777619) >>> 0;
	}
}

try {
	for (let iteration = 0; iteration < 3; iteration++) {
		computer.computeDiffWithRawChanges(original, modified, options);
		dynamic.compute(sequence1, sequence2);
		myers.compute(sequence1, sequence2);
	}
	global.gc?.();
	const baseline = process.memoryUsage();
	measure('dynamic_20_alignments_ms', () => repeat(20, () => dynamic.compute(sequence1, sequence2)));
	measure('myers_20_alignments_ms', () => repeat(20, () => myers.compute(sequence1, sequence2)));
	measure('display_10_diffs_ms', () => repeat(10, () => computer.computeDiff(original, modified, options)));
	measure('timed_display_10_diffs_ms', () => repeat(10, () => computer.computeDiff(original, modified, { ...options, maxComputationTimeMs: 30000 })));
	measure('raw_10_diffs_ms', () => repeat(10, () => computer.computeDiffWithRawChanges(original, modified, options)));
	const observed = process.memoryUsage();
	process.stdout.write(JSON.stringify({
		engine, fixture, inputUtf16Units: original.join('\n').length, lineCount, sequenceLength: elements.length,
		measurements,
		memory: {
			rssDeltaBytes: observed.rss - baseline.rss,
			heapUsedDeltaBytes: observed.heapUsed - baseline.heapUsed,
			peakRssBytes: process.resourceUsage().maxRSS * 1024,
			wasmLinearMemoryBytes: memory?.buffer.byteLength ?? 0
		},
		checksum
	}));
} finally {
	registration?.dispose();
}
