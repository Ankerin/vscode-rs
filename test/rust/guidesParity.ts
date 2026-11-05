/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { DisposableStore } from '../../src/vs/base/common/lifecycle.js';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { encodeUTF16 } from '../../src/vs/editor/common/core/utf16Transfer.js';
import { GuidesTextModelPart } from '../../src/vs/editor/common/model/guidesTextModelPart.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { TestLanguageConfigurationService } from '../../src/vs/editor/test/common/modes/testLanguageConfigurationService.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function createPair(text: string, tabSize: number, indentSize: number, offSide: boolean) {
	const disposables = new DisposableStore();
	try {
		const options = { tabSize, indentSize, detectIndentation: false };
		const reference = disposables.add(createTextModel(text, null, options));
		const registration = registerRustTextBuffer(rust);
		let actual: ReturnType<typeof createTextModel>;
		try { actual = disposables.add(createTextModel(text, null, options)); } finally { registration.dispose(); }
		const configurations = disposables.add(new TestLanguageConfigurationService());
		disposables.add(configurations.register(reference.getLanguageId(), { folding: { offSide } }));
		return {
			disposables, reference, actual,
			referenceGuides: disposables.add(new GuidesTextModelPart(reference, configurations)),
			actualGuides: disposables.add(new GuidesTextModelPart(actual, configurations))
		};
	} catch (error) {
		disposables.dispose();
		throw error;
	}
}

test('Rust guides preserve seeded viewport levels, active scopes, option changes, and edited models', () => {
	let seed = 139;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const prefixes = ['', ' ', '  ', '    ', '      ', '\t', '\t \t', '  \t', '        '];
	const contents = ['', 'value', '\uD800x\uD83D\uDE00\uFEFF', '\u00A0', '\u2028'];
	for (let iteration = 0; iteration < 256; iteration++) {
		const text = Array.from({ length: 1 + random(64) }, () => prefixes[random(prefixes.length)] + contents[random(contents.length)]).join(iteration % 2 === 0 ? '\n' : '\r\n');
		const pair = createPair(text, [2, 3, 4, 8][iteration % 4], [2, 3, 4, 6][iteration % 4], iteration % 2 === 0);
		const compare = () => {
			const count = pair.reference.getLineCount();
			assert.deepStrictEqual(pair.actualGuides.getLinesIndentGuides(1, count), pair.referenceGuides.getLinesIndentGuides(1, count));
			for (let index = 0; index < 32; index++) {
				const start = 1 + random(count);
				const end = start + random(count - start + 1);
				const line = 1 + random(count);
				assert.deepStrictEqual(pair.actualGuides.getLinesIndentGuides(start, end), pair.referenceGuides.getLinesIndentGuides(start, end));
				for (const [minimum, maximum] of [[1, count], [start, end], [start + 0.5, end - 0.5], [Number.NaN, Number.NaN], [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]]) {
					assert.deepStrictEqual(pair.actualGuides.getActiveIndentGuide(line, minimum, maximum), pair.referenceGuides.getActiveIndentGuide(line, minimum, maximum), `Active guide ${iteration}/${line}/${minimum}/${maximum}`);
				}
			}
		};
		try {
			compare();
			const edits = [{ range: new Range(1, 1, 1, 1), text: 'root\n\tchild\n \t\n' }];
			pair.reference.applyEdits(edits);
			pair.actual.applyEdits(edits);
			pair.reference.updateOptions({ tabSize: 3, indentSize: 2 });
			pair.actual.updateOptions({ tabSize: 3, indentSize: 2 });
			compare();
		} finally {
			pair.disposables.dispose();
		}
	}
});

test('Rust guides preserve long whitespace runs, cutoff bounds, empty windows, and original errors', () => {
	for (const text of ['root\n' + ' \t\n'.repeat(1024) + '    child\n', 'root\n' + '  child\n'.repeat(100004), 'root\n' + ' \t'.repeat(65536) + 'child\n']) {
		const pair = createPair(text, 4, 2, false);
		try {
			const count = pair.reference.getLineCount();
			for (const line of [1, 2, Math.floor(count / 2), count]) {
				assert.deepStrictEqual(pair.actualGuides.getActiveIndentGuide(line, 1, count), pair.referenceGuides.getActiveIndentGuide(line, 1, count));
			}
			assert.deepStrictEqual(pair.actualGuides.getLinesIndentGuides(2, 1), pair.referenceGuides.getLinesIndentGuides(2, 1));
			for (const [start, end] of [[0, 1], [1, count + 1], [3, 1]]) {
				assert.throws(() => pair.actualGuides.getLinesIndentGuides(start, end));
				assert.throws(() => pair.referenceGuides.getLinesIndentGuides(start, end));
			}
		} finally {
			pair.disposables.dispose();
		}
	}
});

test('Rust guide queries avoid line transfers and reject malformed result shapes', () => {
	let rejectTransfers = false;
	let malformed = false;
	class GuideBuffer extends rust.WasmTextBuffer {
		public static override from_text(text: string): GuideBuffer { return new GuideBuffer(encodeUTF16(text)); }
		public override line_batch(line: number, count: number, units: number) {
			if (rejectTransfers) { throw new Error('Decoded guide line transfer'); }
			return super.line_batch(line, count, units);
		}
		public override indent_guides(start: number, end: number, tabSize: number, indentSize: number, offSide: boolean) {
			return malformed ? new Float64Array([1]) : super.indent_guides(start, end, tabSize, indentSize, offSide);
		}
		public override active_indent_guide(line: number, minimum: number, maximum: number, tabSize: number, indentSize: number, offSide: boolean) {
			return malformed ? new Float64Array([1]) : super.active_indent_guide(line, minimum, maximum, tabSize, indentSize, offSide);
		}
	}
	const text = 'root\n  child\n\nroot';
	const options = { tabSize: 4, indentSize: 2, detectIndentation: false };
	const reference = createTextModel(text, null, options);
	const expected = [reference.guides.getLinesIndentGuides(1, 4), reference.guides.getActiveIndentGuide(1, 1, 4)];
	reference.dispose();
	const registration = registerRustTextBuffer({ ...rust, WasmTextBuffer: GuideBuffer });
	let model: ReturnType<typeof createTextModel>;
	try { model = createTextModel(text, null, options); } finally { registration.dispose(); }
	try {
		rejectTransfers = true;
		assert.deepStrictEqual([model.guides.getLinesIndentGuides(1, 4), model.guides.getActiveIndentGuide(1, 1, 4)], expected);
		malformed = true;
		assert.throws(() => model.guides.getLinesIndentGuides(1, 4), /guide result/);
		assert.throws(() => model.guides.getActiveIndentGuide(1, 1, 4), /active guide result/);
	} finally {
		rejectTransfers = false;
		model.dispose();
	}
	const buffer = rust.WasmTextBuffer.from_text('root\n  child');
	try {
		for (const [tabSize, indentSize] of [[0, 2], [4, 0], [Number.NaN, 2], [4, 2.5]]) {
			assert.strictEqual(buffer.indent_guides(1, 2, tabSize, indentSize, false), undefined);
			assert.strictEqual(buffer.active_indent_guide(1, 1, 2, tabSize, indentSize, false), undefined);
		}
		assert.strictEqual(buffer.indent_guides(1.5, 2, 4, 2, false), undefined);
	} finally { buffer.free(); }
});
