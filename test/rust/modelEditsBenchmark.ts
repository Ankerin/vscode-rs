/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { ApplyEditsResult, DefaultEndOfLine, ITextBuffer, ValidAnnotatedEditOperation } from '../../src/vs/editor/common/model.js';
import { createTextBuffer } from '../../src/vs/editor/common/model/textModel.js';
import { IRustTextBuffer, IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<{ memory: WebAssembly.Memory }>;
}

const engine = process.argv[2];
if (engine !== 'existing' && engine !== 'storage' && engine !== 'rust') {
	throw new Error('Select the existing, storage-only Rust, or complete Rust model edit engine');
}
const fixture = process.argv[3];
const repetitions: Record<string, number> = { typing: 10000, multicursor: 50, fragmented: 30, unicode: 30 };
const count = repetitions[fixture];
if (!count) {
	throw new Error('Select a known model edit fixture');
}
let memory: WebAssembly.Memory | undefined;
let registration: ReturnType<typeof registerRustTextBuffer> | undefined;
if (engine !== 'existing') {
	const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
	const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
	memory = (await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) })).memory;
	class StorageOnlyBuffer extends rust.WasmTextBuffer {
		public static override from_text(text: string): IRustTextBuffer {
			const buffer = rust.WasmTextBuffer.from_text(text);
			buffer.apply_model_edits = () => undefined;
			return buffer;
		}
		public override apply_model_edits(): undefined { return undefined; }
	}
	registration = registerRustTextBuffer(engine === 'storage' ? { ...rust, WasmTextBuffer: StorageOnlyBuffer } : rust);
}
const text = fixture === 'typing' ? ' \ntext\n'.repeat(128) : fixture === 'multicursor' ? 'abcd\n'.repeat(2048) : (fixture === 'unicode' ? '\u03A9\u6F22\uD83D\uDE00\uD800\uFEFF' : 'abcdef').repeat(16384);
const document = createTextBuffer(text, DefaultEndOfLine.LF);
const buffer = document.textBuffer;
let operations: ValidAnnotatedEditOperation[];
if (fixture === 'typing') {
	operations = [new ValidAnnotatedEditOperation(null, new Range(1, 2, 1, 2), 'x', false, true, false)];
} else if (fixture === 'multicursor') {
	operations = Array.from({ length: 1024 }, (_, index) => new ValidAnnotatedEditOperation({ major: index, minor: 1 }, new Range(index * 2 + 1, 2, index * 2 + 1, 3), 'xy', index % 3 === 0, false, true));
} else {
	operations = Array.from({ length: 512 }, (_, index) => new ValidAnnotatedEditOperation({ major: index, minor: 1 }, buffer.getRangeAt(index * 192, 6), 'changed\n', index % 3 === 0, false, true));
}
let checksum = 2166136261;
function observe(result: ApplyEditsResult): void {
	for (const edit of result.reverseEdits ?? []) {
		const change = edit.textChange!;
		checksum = Math.imul(checksum ^ (change.oldPosition + change.newPosition + change.oldLength + change.newLength), 16777619) >>> 0;
	}
	checksum = Math.imul(checksum ^ result.changes.length, 16777619) >>> 0;
}
function applyPair(buffer: ITextBuffer, inverse: ValidAnnotatedEditOperation[]): void {
	observe(buffer.applyEdits(operations, true, true));
	observe(buffer.applyEdits(inverse, true, true));
}
try {
	const first = buffer.applyEdits(operations, true, true);
	const inverse = first.reverseEdits!.map(edit => new ValidAnnotatedEditOperation(edit.identifier ?? null, Range.lift(edit.range), edit.text, false, false, true));
	buffer.applyEdits(inverse, true, true);
	for (let index = 0; index < 3; index++) {
		applyPair(buffer, inverse);
	}
	global.gc?.();
	const baseline = process.memoryUsage();
	const start = performance.now();
	for (let index = 0; index < count; index++) {
		applyPair(buffer, inverse);
	}
	const elapsed = performance.now() - start;
	const observed = process.memoryUsage();
	const snapshot = buffer.createSnapshot(false);
	let chunk: string | null;
	while ((chunk = snapshot.read()) !== null) {
		for (let index = 0; index < chunk.length; index++) {
			checksum = Math.imul(checksum ^ chunk.charCodeAt(index), 16777619) >>> 0;
		}
	}
	process.stdout.write(JSON.stringify({
		engine, fixture, repetitions: count, inputUtf16Units: text.length,
		measurements: { apply_and_reverse_batches_ms: elapsed },
		memory: { rssDeltaBytes: observed.rss - baseline.rss, heapUsedDeltaBytes: observed.heapUsed - baseline.heapUsed, peakRssBytes: process.resourceUsage().maxRSS * 1024, wasmLinearMemoryBytes: memory?.buffer.byteLength ?? 0 },
		checksum
	}));
} finally {
	document.disposable.dispose();
	registration?.dispose();
}
