/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { BracketPairColorizationOptions, TextModelResolvedOptions } from '../../src/vs/editor/common/model.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';
import { IRustModelOptionsModule, IRustModelOptionsSource, registerRustModelOptions, RustModelOptionsOperation, tryRustModelOptions } from '../../src/vs/editor/common/model/rustModelOptions.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }
const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, core = false, module: IRustModelOptionsModule = rust): T {
	const registration = core ? registerRustTextBuffer(rust) : registerRustModelOptions(module);
	try { return compute(); } finally { registration.dispose(); }
}
function input(tabSize: number = 4, indentSize: number | 'tabSize' = 'tabSize'): IRustModelOptionsSource {
	return { tabSize, indentSize, insertSpaces: true, defaultEOL: 1, trimAutoWhitespace: true, bracketPairColorizationOptions: { enabled: true, independentColorPoolPerBracketType: false } };
}

test('Rust resolved options preserve seeded coercions, field descriptors, original indent, equality, and change flags', () => {
	const values = [NaN, Infinity, -Infinity, -0, -1, 1.7, 3, 0x80000000, 0x100000004, 'tabSize', '3', null, undefined, false, {}, 3n, Symbol('option')];
	let seed = 677;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const cases = Array.from({ length: 256 }, () => Array.from({ length: 5 }, () => values[random(values.length)]));
	const run = () => cases.map(values => {
		const source: IRustModelOptionsSource = { tabSize: values[0] as number, indentSize: values[1] as number, insertSpaces: values[2] as boolean, defaultEOL: values[3] as number, trimAutoWhitespace: values[4] as boolean, bracketPairColorizationOptions: { enabled: true, independentColorPoolPerBracketType: false } };
		try {
			const options = new TextModelResolvedOptions(source);
			const other = new TextModelResolvedOptions(input());
			const result = { descriptors: Object.getOwnPropertyDescriptors(options), indent: options.originalIndentSize, equals: options.equals(other), event: options.createChangeEvent(other), keys: Reflect.ownKeys(options) };
			Object.freeze(options); Object.freeze(other);
			return result;
		} catch (error) { return { error: error instanceof Error ? error.name : error }; }
	});
	const expected = run();
	assert.deepStrictEqual(withRust(run), expected);
	assert.deepStrictEqual(withRust(run, true), expected);
});

test('Rust resolved options retain source getters, repeated indent reads, object coercions, and partial source failures', () => {
	const run = () => {
		const observations: string[] = [];
		const base = input();
		let reads = 0;
		const scalar = { [Symbol.toPrimitive]: (hint: string) => { observations.push('coerce:' + hint); return 4; } };
		const source = new Proxy(base, {
			get: (target, key, receiver) => {
				observations.push('source:' + String(key));
				if (key === 'indentSize') { return reads++ === 0 ? 2 : scalar; }
				if (key === 'tabSize') { return scalar; }
				return Reflect.get(target, key, receiver);
			}
		});
		const options = new TextModelResolvedOptions(source);
		const result = { fields: Object.getOwnPropertyDescriptors(options), indent: options.originalIndentSize, observations };
		Object.freeze(options);
		return result;
	};
	assert.deepStrictEqual(withRust(run), run());
	const failure = new Error('Original option getter failure');
	for (const compute of [run => withRust(run), run => run()] as ((run: () => void) => void)[]) {
		compute(() => {
			const source = input();
			Object.defineProperty(source, 'indentSize', { get: () => { throw failure; } });
			assert.throws(() => new TextModelResolvedOptions(source), error => error === failure);
		});
	}
});

test('Rust option equality and change events preserve receiver traps, short circuits, and original bracket aliases', () => {
	const run = () => {
		const observations: string[] = [];
		const first = new TextModelResolvedOptions(input(4, 2));
		const second = new TextModelResolvedOptions(input(4, 2));
		const wrap = (options: TextModelResolvedOptions, label: string) => new Proxy(options, {
			get: (target, key, receiver) => {
				if (!String(key).startsWith('_createRust')) { observations.push(label + ':' + String(key)); }
				return Reflect.get(target, key, receiver);
			}
		});
		const left = wrap(first, 'left');
		const right = wrap(second, 'right');
		const before = left.equals(right);
		Reflect.defineProperty(second, 'tabSize', { value: 8 });
		const after = left.equals(right);
		const event = left.createChangeEvent(right);
		const alias = first.bracketPairColorizationOptions === second.bracketPairColorizationOptions;
		Object.freeze(first); Object.freeze(second);
		return { before, after, event, alias, observations };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust resolved options are used by real model updates with original event behavior', () => {
	const run = () => {
		const model = createTextModel('\tabc\n  def');
		const events: object[] = [];
		const subscription = model.onDidChangeOptions(event => events.push({ ...event }));
		try {
			const first = model.getOptions();
			model.updateOptions({ tabSize: 8, indentSize: 2, insertSpaces: false });
			model.updateOptions({ tabSize: 8, indentSize: 2, insertSpaces: false });
			model.updateOptions({ indentSize: 'tabSize' });
			const last = model.getOptions();
			const result = { first: Object.getOwnPropertyDescriptors(first), last: Object.getOwnPropertyDescriptors(last), indent: last.originalIndentSize, formatting: model.getFormattingOptions(), events };
			Object.freeze(first); Object.freeze(last);
			return result;
		} finally { subscription.dispose(); model.dispose(); }
	};
	assert.deepStrictEqual(withRust(run), run());
	assert.deepStrictEqual(withRust(run, true), run());
});

test('Rust resolved fields own native records, retain configuration identities, and materialize frozen values', () => {
	withRust(() => {
		const baseline = rust.bracket_node_metadata_live_count();
		const source = input();
		const options = new TextModelResolvedOptions(source);
		assert.deepStrictEqual([rust.bracket_node_metadata_live_count(), options.bracketPairColorizationOptions === source.bracketPairColorizationOptions, options.originalIndentSize], [baseline + 1, true, 'tabSize']);
		Object.freeze(options);
		assert.deepStrictEqual([rust.bracket_node_metadata_live_count(), Object.getOwnPropertyDescriptor(options, 'tabSize')], [baseline, { value: 4, writable: false, enumerable: true, configurable: false }]);
	}, true);
	const options = withRust(() => new TextModelResolvedOptions(input()), true);
	assert.strictEqual(options.originalIndentSize, 'tabSize');
	Object.freeze(options);
});

function cyclicOptions(): [WeakRef<TextModelResolvedOptions>, WeakRef<BracketPairColorizationOptions>] {
	const bracketOptions: BracketPairColorizationOptions & { owner?: TextModelResolvedOptions } = { enabled: true, independentColorPoolPerBracketType: false };
	const options = new TextModelResolvedOptions({ ...input(), bracketPairColorizationOptions: bracketOptions });
	bracketOptions.owner = options;
	return [new WeakRef(options), new WeakRef(bracketOptions)];
}

test('Rust owning model option reference cycles remain visible to the host collector', async () => {
	const registration = registerRustTextBuffer(rust);
	try {
		const baseline = rust.bracket_node_metadata_live_count();
		const references = cyclicOptions();
		for (let attempt = 0; attempt < 64; attempt++) {
			await setTimeout(0); globalThis.gc?.();
			if (references.every(reference => reference.deref() === undefined) && rust.bracket_node_metadata_live_count() <= baseline) { return; }
		}
		assert.deepStrictEqual(references.map(reference => reference.deref() === undefined), [true, true]);
	} finally { registration.dispose(); }
});

test('Rust option control executes every entry point and rejects stale registration atomically', () => {
	const calls = new Set<number>();
	const module: IRustModelOptionsModule = { ...rust, run_model_options: (...args) => { calls.add(args[1]); return rust.run_model_options(...args); } };
	withRust(() => {
		const first = new TextModelResolvedOptions(input());
		const second = new TextModelResolvedOptions(input());
		assert.strictEqual(first.originalIndentSize, 'tabSize'); first.equals(second); first.createChangeEvent(second);
	}, false, module);
	assert.deepStrictEqual([...calls].sort(), [0, 1, 2, 3]);
	assert.throws(() => registerRustTextBuffer({ ...rust, model_options_abi_version: () => 0 }), /resolved-option contract/);
	assert.strictEqual(tryRustModelOptions(RustModelOptionsOperation.Initialize, () => { throw new Error('Unavailable options must not create a host'); }), undefined);
	const registration = registerRustModelOptions(rust);
	try { assert.throws(() => registerRustModelOptions(rust), /already registered/); } finally { registration.dispose(); }
});

