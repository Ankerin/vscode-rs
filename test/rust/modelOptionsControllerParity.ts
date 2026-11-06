/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { ITextBuffer, ITextModelUpdateOptions, TextModelResolvedOptions } from '../../src/vs/editor/common/model.js';
import { TextModel } from '../../src/vs/editor/common/model/textModel.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { IRustModelOptionsControllerModule, registerRustModelOptionsController, RustModelOptionsControllerOperation, tryRustModelOptionsController } from '../../src/vs/editor/common/model/rustModelOptionsController.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }
interface IControllerModel { _buffer: ITextBuffer; _options: TextModelResolvedOptions; _bracketPairs: { handleDidChangeOptions(event: object): void } }
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, core = false, module: IRustModelOptionsControllerModule = rust): T {
	const registration = core ? registerRustTextBuffer(rust) : registerRustModelOptionsController(module);
	try { return compute(); } finally { registration.dispose(); }
}
function options(model: TextModel): object {
	const value = model.getOptions();
	return { ...value, original: value.originalIndentSize, formatting: model.getFormattingOptions(), normalized: model.normalizeIndentation(' \tx') };
}

test('Rust model option control preserves seeded updates, events, formatting, and indentation detection', () => {
	let seed = 4537;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const streams = Array.from({ length: 64 }, () => Array.from({ length: 16 }, () => ({ tabSize: [undefined, 1, 3, 8, NaN][random(5)], indentSize: [undefined, 1, 2, 'tabSize'][random(4)] as number | 'tabSize' | undefined, insertSpaces: Boolean(random(2)), trimAutoWhitespace: Boolean(random(2)) })));
	const run = () => streams.map(updates => {
		const model = createTextModel('  x\n    y\n  z');
		const events: object[] = [];
		const subscription = model.onDidChangeOptions(event => events.push({ ...event }));
		try {
			const states = updates.map(update => { model.updateOptions(update); return options(model); });
			model.detectIndentation(false, 8);
			return { states, detected: options(model), events };
		} finally { subscription.dispose(); model.dispose(); }
	});
	const expected = run();
	assert.deepStrictEqual(withRust(run), expected);
	assert.deepStrictEqual(withRust(run, true), expected);
});

test('Rust option updates preserve repeated request getters, current option lookups, and event order', () => {
	const run = () => {
		const target = createTextModel('abc');
		const internal = target as unknown as IControllerModel;
		const observations: string[] = [];
		internal._options = new Proxy(internal._options, { get: (value, key, receiver) => { observations.push('options:' + String(key)); return Reflect.get(value, key, receiver); } });
		const model = new Proxy(target, {
			get: (value, key, receiver) => {
				if (['_options', '_assertNotDisposed', '_bracketPairs', '_decorationProvider', '_onDidChangeOptions'].includes(String(key))) { observations.push('model:' + String(key)); }
				return Reflect.get(value, key, receiver);
			},
			set: (value, key, replacement, receiver) => { observations.push('set:' + String(key)); return Reflect.set(value, key, replacement, receiver); }
		});
		let indentReads = 0;
		const request: ITextModelUpdateOptions = {
			get tabSize() { observations.push('tab'); return undefined; },
			get indentSize() { observations.push('indent'); return indentReads++ === 0 ? 2 : 'tabSize'; },
			get insertSpaces() { observations.push('insert'); return false; }
		};
		try { model.updateOptions(request); return { value: options(model), observations }; } finally { target.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust option updates retain truthy override short circuits and partial assignment on provider failure', () => {
	const failure = new Error('Original option notification failure');
	const run = () => {
		const model = createTextModel('abc');
		const internal = model as unknown as IControllerModel;
		const original = internal._options;
		const equals = original.equals;
		const opaque = {};
		original.equals = () => opaque as boolean;
		model.updateOptions({ tabSize: 8 });
		const unchanged = internal._options === original;
		original.equals = equals;
		const handle = internal._bracketPairs.handleDidChangeOptions;
		internal._bracketPairs.handleDidChangeOptions = () => { throw failure; };
		try {
			assert.throws(() => model.updateOptions({ tabSize: 8 }), error => error === failure);
			return { unchanged, tabSize: model.getOptions().tabSize };
		} finally { internal._bracketPairs.handleDidChangeOptions = handle; model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust creation option resolution preserves detect/source getter order and original resolved values', () => {
	const run = () => {
		const model = createTextModel('  x\n    y');
		const internal = model as unknown as IControllerModel;
		try {
			return [false, true].map(detectIndentation => {
				const observations: string[] = [];
				const source = new Proxy({ ...TextModel.DEFAULT_CREATION_OPTIONS, detectIndentation }, {
					get: (value, key, receiver) => { observations.push(String(key)); return Reflect.get(value, key, receiver); }
				});
				const result = TextModel.resolveOptions(internal._buffer, source);
				const values = { ...result, original: result.originalIndentSize };
				Object.freeze(result);
				return { values, observations };
			});
		} finally { model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust model option control preserves disposed formatting access and executes every registered operation', () => {
	const calls = new Set<number>();
	const module: IRustModelOptionsControllerModule = { ...rust, run_model_options_controller: (...args) => { calls.add(args[1]); return rust.run_model_options_controller(...args); } };
	withRust(() => {
		const model = createTextModel('  abc');
		try {
			model.getOptions(); model.getFormattingOptions(); model.updateOptions({ tabSize: 8 }); model.detectIndentation(true, 4); model.normalizeIndentation('\tx');
			model.dispose();
			assert.deepStrictEqual(model.getFormattingOptions(), { tabSize: 2, insertSpaces: true });
			assert.throws(() => model.getOptions(), /Model is disposed/);
		} finally { model.dispose(); }
	}, false, module);
	assert.deepStrictEqual([...calls].sort(), [0, 1, 2, 3, 4, 5]);
	assert.throws(() => registerRustTextBuffer({ ...rust, model_options_controller_abi_version: () => 0 }), /update contract/);
	assert.strictEqual(tryRustModelOptionsController(RustModelOptionsControllerOperation.Update, 0, 0, () => { throw new Error('Unavailable option control must not create a host'); }), undefined);
	const registration = registerRustModelOptionsController(rust);
	try { assert.throws(() => registerRustModelOptionsController(rust), /already registered/); } finally { registration.dispose(); }
});

