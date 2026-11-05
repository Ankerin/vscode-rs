/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { DefaultEndOfLine, EndOfLinePreference, ITextBuffer, ITextSnapshot, ValidAnnotatedEditOperation } from '../../src/vs/editor/common/model.js';
import { createTextBuffer } from '../../src/vs/editor/common/model/textModel.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<{ memory: WebAssembly.Memory }>;
}

const engine = process.argv[2];
if (engine !== 'existing' && engine !== 'rust') {
	throw new Error('Select the existing or rust text buffer');
}

let memory: WebAssembly.Memory | undefined;
let registration: ReturnType<typeof registerRustTextBuffer> | undefined;
if (engine === 'rust') {
	const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
	const moduleUrl = pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href;
	const rust = await import(moduleUrl) as IRustModule;
	const result = await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });
	memory = result.memory;
	registration = registerRustTextBuffer(rust);
}

const text = 'function example() { return "text buffer benchmark"; }\n'.repeat(20000);
const measurements: Record<string, number> = {};
let checksum = 0;

function measure(name: string, operation: () => void): void {
	const start = performance.now();
	operation();
	measurements[name] = performance.now() - start;
}

function edit(buffer: ITextBuffer, offset: number): void {
	const range = buffer.getRangeAt(offset, 0);
	buffer.applyEdits([new ValidAnnotatedEditOperation(null, range, 'inserted', false, false, false)], false, false);
}

const baselineMemory = process.memoryUsage();
try {
	// Warm the adapter and allocator before timing the same input in a fresh process per engine.
	for (let iteration = 0; iteration < 8; iteration++) {
		const warm = createTextBuffer(text, DefaultEndOfLine.LF);
		warm.disposable.dispose();
	}

	measure('create_20_documents_ms', () => {
		for (let iteration = 0; iteration < 20; iteration++) {
			const document = createTextBuffer(text, DefaultEndOfLine.LF);
			checksum += document.textBuffer.getLength();
			document.disposable.dispose();
		}
	});

	const document = createTextBuffer(text, DefaultEndOfLine.LF);
	const current = document.textBuffer;
	try {
		measure('random_2000_edits_ms', () => {
			for (let iteration = 0; iteration < 2000; iteration++) {
				edit(current, (Math.imul(iteration + 1, 7919) >>> 0) % current.getLength());
			}
		});
		measure('position_20000_lookups_ms', () => {
			for (let iteration = 0; iteration < 20000; iteration++) {
				const position = current.getPositionAt((Math.imul(iteration + 1, 104729) >>> 0) % current.getLength());
				checksum += position.lineNumber + position.column;
			}
		});
		measure('read_20000_lines_ms', () => {
			for (let line = 1; line <= 20000; line++) {
				checksum += current.getLineContent(line).length;
			}
		});
		const snapshots: ITextSnapshot[] = [];
		measure('retain_1000_snapshots_ms', () => {
			for (let iteration = 0; iteration < 1000; iteration++) {
				snapshots.push(current.createSnapshot(false));
			}
		});
		measure('drain_10_snapshots_ms', () => {
			for (const snapshot of snapshots.slice(0, 10)) {
				let chunk: string | null;
				while ((chunk = snapshot.read()) !== null) {
					checksum += chunk.length;
				}
			}
		});
		const fullRange = new Range(1, 1, current.getLineCount(), current.getLineLength(current.getLineCount()) + 1);
		measure('extract_entire_document_ms', () => {
			checksum += current.getValueInRange(fullRange, EndOfLinePreference.TextDefined).length;
		});
		const observed = process.memoryUsage();
		process.stdout.write(JSON.stringify({
			engine,
			inputUtf16Units: text.length,
			measurements,
			memory: {
				rssDeltaBytes: observed.rss - baselineMemory.rss,
				heapUsedDeltaBytes: observed.heapUsed - baselineMemory.heapUsed,
				externalDeltaBytes: observed.external - baselineMemory.external,
				wasmLinearMemoryBytes: memory?.buffer.byteLength ?? 0
			},
			checksum
		}));
	} finally {
		document.disposable.dispose();
	}
} finally {
	registration?.dispose();
}
