/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { FoldingMarkers } from '../../src/vs/editor/common/languages/languageConfiguration.js';
import { ITextModel } from '../../src/vs/editor/common/model.js';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { encodeUTF16 } from '../../src/vs/editor/common/core/utf16Transfer.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { computeRanges } from '../../src/vs/editor/contrib/folding/browser/indentRangeProvider.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function createPair(text: string, tabSize: number): [ITextModel, ITextModel] {
	const options = { tabSize, detectIndentation: false };
	const reference = createTextModel(text, null, options);
	const registration = registerRustTextBuffer(rust);
	try {
		return [reference, createTextModel(text, null, options)];
	} catch (error) {
		reference.dispose();
		throw error;
	} finally {
		registration.dispose();
	}
}

function capture(model: ITextModel, offSide: boolean, markers: FoldingMarkers | undefined, limit: number) {
	const updates: [number, number | false][] = [];
	const regions = computeRanges(model, offSide, markers, { limit, update: (computed, limited) => updates.push([computed, limited]) });
	return {
		updates,
		ranges: Array.from({ length: regions.length }, (_, index) => [regions.getStartLineNumber(index), regions.getEndLineNumber(index), regions.getParentIndex(index)]),
		markerIndices: markers ? [markers.start.lastIndex, markers.end.lastIndex] : []
	};
}

test('Rust indentation folding preserves seeded nesting, marker flags, limits, and edited models', () => {
	let seed = 137;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const prefixes = ['', ' ', '  ', '    ', '\t', '\t  ', ' \t ', '  \t', '      '];
	const contents = ['', 'value', '#region', '#endregion', '#REGION', '#ENDREGION', '\uD800x\uFEFF\uD83D\uDE00', '\u00A0'];
	const configurations: Array<() => FoldingMarkers | undefined> = [
		() => undefined,
		() => ({ start: /^\s*#region\b/, end: /^\s*#endregion\b/ }),
		() => ({ start: /^\s*#region\b/g, end: /^\s*#endregion\b/g }),
		() => ({ start: /^\s*#region\b/gi, end: /^\s*#endregion\b/g }),
		() => ({ start: /^\s*#region\b/g, end: /^\s*#endregion\b/gi }),
		() => ({ start: /^/, end: /#endregion/ }),
		() => ({ start: /(?<=#)region/u, end: /(?<=#)endregion/u })
	];
	for (let iteration = 0; iteration < 512; iteration++) {
		const text = Array.from({ length: random(128) }, () => prefixes[random(prefixes.length)] + contents[random(contents.length)]).join(iteration % 2 === 0 ? '\n' : '\r\n');
		const [reference, actual] = createPair(text, [2, 3, 4, 8][iteration % 4]);
		const markers = configurations[iteration % configurations.length];
		const compare = () => {
			for (const offSide of [false, true]) {
				for (const limit of [0, 1, 3, 10, 5000]) {
					assert.deepStrictEqual(capture(actual, offSide, markers(), limit), capture(reference, offSide, markers(), limit), `Folding ${iteration}/${offSide}/${limit}`);
				}
			}
		};
		try {
			compare();
			const edits = [{ range: new Range(1, 1, 1, 1), text: '#region\n  \uD800value\n#endregion\n' }];
			reference.applyEdits(edits);
			actual.applyEdits(edits);
			compare();
		} finally {
			reference.dispose();
			actual.dispose();
		}
	}
});

test('Rust folding keeps deep-indent limit selection, long prefixes, and unsupported option fallback', () => {
	for (const text of [
		' '.repeat(1500) + 'root\n' + ' '.repeat(1502) + 'child\n' + ' '.repeat(1500) + 'root\n' + ' '.repeat(1502) + 'child',
		'root\n' + ' \t'.repeat(65536) + 'child\r\n  root\n    child\n',
		Array.from({ length: 256 }, (_, index) => ' '.repeat(index % 32) + 'value').join('\n')
	]) {
		const [reference, actual] = createPair(text, 4);
		try {
			for (const limit of [0, 1, 2, 7, 5000, 2.5, 65536]) {
				for (const offSide of [true, false]) {
					assert.deepStrictEqual(capture(actual, offSide, undefined, limit), capture(reference, offSide, undefined, limit));
				}
			}
		} finally {
			reference.dispose();
			actual.dispose();
		}
	}
});

test('Rust folding avoids line transfers without markers and scopes callback failures', () => {
	let queries = 0;
	let markerBatches = 0;
	let rejectTransfers = false;
	class FoldingBuffer extends rust.WasmTextBuffer {
		public static override from_text(text: string): FoldingBuffer { return new FoldingBuffer(encodeUTF16(text)); }
		public override line_batch(start: number, lines: number, units: number) {
			if (rejectTransfers) { throw new Error('Decoded folding line transfer'); }
			return super.line_batch(start, lines, units);
		}
		public override indentation_folding(tabSize: number, offSide: boolean, limit: number, getMarker?: (lineNumber: number) => number | Uint8Array) {
			queries++;
			return super.indentation_folding(tabSize, offSide, limit, getMarker ? line => { markerBatches++; return getMarker(line); } : undefined);
		}
	}
	const text = 'root\n  child\n\n'.repeat(1024);
	const reference = createTextModel(text, null, { detectIndentation: false });
	const registration = registerRustTextBuffer({ ...rust, WasmTextBuffer: FoldingBuffer });
	let actual: ITextModel;
	try { actual = createTextModel(text, null, { detectIndentation: false }); } finally { registration.dispose(); }
	try {
		rejectTransfers = true;
		assert.deepStrictEqual(capture(actual, true, undefined, 5000), capture(reference, true, undefined, 5000));
		assert.strictEqual(queries, 1);
		rejectTransfers = false;
		const markers = () => ({ start: /^\s*#region\b/g, end: /^\s*#endregion\b/g });
		assert.deepStrictEqual(capture(actual, true, markers(), 5000), capture(reference, true, markers(), 5000));
		assert.ok(markerBatches > 0 && markerBatches <= Math.ceil(actual.getLineCount() / 64) + 1);
	} finally {
		rejectTransfers = false;
		reference.dispose();
		actual.dispose();
	}
	const buffer = rust.WasmTextBuffer.from_text('root\n \t\n  child\r\n');
	try {
		const visited: number[] = [];
		buffer.indentation_folding(4, false, 5000, line => { visited.push(line); return 0; });
		assert.deepStrictEqual(visited, [3, 1]);
		const error = new Error('Marker callback failed');
		assert.throws(() => buffer.indentation_folding(4, false, 5000, () => { throw error; }), value => value === error);
		assert.throws(() => buffer.indentation_folding(4, false, 5000, () => 3), /folding marker/);
		for (const values of [[], [3], Array.from({ length: 65 }, () => 0)]) {
			assert.throws(() => buffer.indentation_folding(4, false, 5000, () => new Uint8Array(values)), /folding marker batch/);
		}
		for (const [tabSize, limit] of [[0, 5000], [2.5, 5000], [Number.NaN, 5000], [4, -1], [4, 2.5], [4, 65536]]) {
			assert.strictEqual(buffer.indentation_folding(tabSize, false, limit, () => { throw error; }), undefined);
		}
		assert.deepStrictEqual(buffer.indentation_folding(4, false, 5000), new Uint32Array([1, 1, 4]));
	} finally {
		buffer.free();
	}
});
