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
import { computeRanges } from '../../src/vs/editor/contrib/folding/browser/indentRangeProvider.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<{ memory: WebAssembly.Memory }>;
}

const engine = process.argv[2];
if (engine !== 'existing' && engine !== 'rust') {
	throw new Error('Select the existing or Rust folding engine');
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
	shortLines: 'root\n  #region\n    child\n  #endregion\n\n'.repeat(2048),
	unicode: 'root\u03A9\n  #region\n    \uD800x\uD83D\uDE00\uFEFF\n  #endregion\n\n'.repeat(2048),
	longPrefixes: 'root\n  #region\n' + ' \t'.repeat(65536) + 'child\n  #endregion\n',
	deepIndent: (' '.repeat(1500) + 'root\n' + ' '.repeat(1502) + '#region\n' + ' '.repeat(1504) + 'child\n' + ' '.repeat(1502) + '#endregion\n').repeat(128)
};
const text = fixtures[fixture];
if (text === undefined) {
	throw new Error('Select a known folding fixture');
}
const model = createTextModel(text, null, { tabSize: 4, detectIndentation: false });
let checksum = 0;
const measurements: Record<string, number> = {};
try {
	for (const useMarkers of [false, true]) {
		const markers = useMarkers ? { start: /^\s*#region\b/g, end: /^\s*#endregion\b/g } : undefined;
		for (const limit of [5000, 32]) {
			for (const offSide of [true, false]) {
				checksum += computeRanges(model, offSide, markers, { limit, update: () => { } }).length;
			}
		}
	}
	global.gc?.();
	const baseline = process.memoryUsage();
	for (const useMarkers of [false, true]) {
		const markers = useMarkers ? { start: /^\s*#region\b/g, end: /^\s*#endregion\b/g } : undefined;
		for (const limit of [5000, 32]) {
			let last: ReturnType<typeof computeRanges> | undefined;
			const reporter = { limit, update: (computed: number, limited: number | false) => { checksum += computed + (limited || 0); } };
			const start = performance.now();
			for (let index = 0; index < 100; index++) {
				last = computeRanges(model, index % 2 === 0, markers, reporter);
				checksum += last.length;
			}
			measurements[`${useMarkers ? 'marker' : 'indent'}_folding_${limit}_ms`] = performance.now() - start;
			for (let index = 0; index < last!.length; index++) {
				checksum += last!.getStartLineNumber(index) + last!.getEndLineNumber(index);
			}
		}
	}
	const observed = process.memoryUsage();
	process.stdout.write(JSON.stringify({
		engine, fixture, inputUtf16Units: text.length, foldingQueriesPerWorkload: 100,
		measurements,
		memory: { rssDeltaBytes: observed.rss - baseline.rss, heapUsedDeltaBytes: observed.heapUsed - baseline.heapUsed, peakRssBytes: process.resourceUsage().maxRSS * 1024, wasmLinearMemoryBytes: memory?.buffer.byteLength ?? 0 },
		checksum
	}));
} finally {
	model.dispose();
	registration?.dispose();
}
