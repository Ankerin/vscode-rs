/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { DisposableStore } from '../../src/vs/base/common/lifecycle.js';
import { ResolvedLanguageConfiguration } from '../../src/vs/editor/common/languages/languageConfigurationRegistry.js';
import { LanguageBracketsConfiguration } from '../../src/vs/editor/common/languages/supports/languageBracketsConfiguration.js';
import { AstNode, BracketAstNode, ListAstNode, PairAstNode, TextAstNode } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/ast.js';
import { BracketPairsTree } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/bracketPairsTree.js';
import { toLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/length.js';
import { IRustBracketIndentationModule, registerRustBracketIndentation } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketIndentation.js';
import { SmallImmutableSet } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/smallImmutableSet.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';
import { TextModel } from '../../src/vs/editor/common/model/textModel.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustBracketIndentationModule = rust): T {
	const registration = registerRustBracketIndentation(module);
	try { return compute(); } finally { registration.dispose(); }
}

function withModel<T>(text: string, compute: (model: TextModel, disposables: DisposableStore) => T): T {
	const disposables = new DisposableStore();
	try { return compute(disposables.add(createTextModel(text, 'parity')), disposables); } finally { disposables.dispose(); }
}

test('Rust bracket indentation preserves seeded text, pair queries, tabs, and cached list results', () => {
	let seed = 1291;
	let calls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const prefixes = ['', ' ', '  ', '\t', '\t ', ' \t', '\t\t'];
	const contents = ['(', ')', '[', ']', '{', '}', 'x', '\uD83D\uDE00', ''];
	const module: IRustBracketIndentationModule = { ...rust, compute_bracket_indentation: (...args) => { calls++; return rust.compute_bracket_indentation(...args); } };
	for (let trace = 0; trace < 256; trace++) {
		const text = Array.from({ length: 16 }, () => prefixes[random(prefixes.length)] + contents[random(contents.length)]).join('\n');
		const tabSize = random(8) + 1;
		const run = () => withModel(text, (model, disposables) => {
			model.updateOptions({ tabSize });
			const tree = disposables.add(new BracketPairsTree(model, language => new ResolvedLanguageConfiguration(language, { brackets: [['(', ')'], ['[', ']'], ['{', '}']] })));
			const textNode = new TextAstNode(toLength(model.getLineCount() - 1, model.getLineLength(model.getLineCount())));
			const textIndentation = textNode.computeMinIndentation(toLength(0, 0), model);
			const pairs = tree.getBracketPairsInRange(model.getFullModelRange(), true).toArray();
			const root = Object.getOwnPropertyDescriptor(tree, 'initialAstWithoutTokens')!.value as AstNode;
			const first = root.computeMinIndentation(toLength(0, 0), model);
			const second = root.computeMinIndentation(toLength(0, 0), model);
			return { textIndentation, pairs, first, second };
		});
		assert.deepStrictEqual(withRust(run, module), run(), `Bracket indentation trace ${trace}`);
	}
	assert.ok(calls > 1000, 'Actual text, pair, and list indentation execute in Rust');
});

test('Rust bracket indentation preserves node/model proxies and method-before-offset argument reads', () => {
	const run = () => withModel('  a\n\n\tb\n c', model => {
		const observations: string[] = [];
		const provider = new Proxy(model, { get: (target, key, receiver) => { observations.push(`model:${String(key)}`); return Reflect.get(target, key, receiver); } });
		const text = new TextAstNode(toLength(3, 2));
		const node = new Proxy(text, { get: (target, key, receiver) => { observations.push(`node:${String(key)}`); return Reflect.get(target, key, receiver); } });
		const textResult = node.computeMinIndentation(toLength(0, 0), provider);
		const original = text.computeMinIndentation;
		Object.defineProperty(text, 'computeMinIndentation', { get: () => { observations.push('child:method'); return original; } });
		const configuration = new LanguageBracketsConfiguration('parity', { brackets: [['(', ')']] });
		const opening = BracketAstNode.create(toLength(0, 1), configuration.getOpeningBracketInfo('(')!, SmallImmutableSet.getEmpty());
		Object.defineProperty(opening, 'length', { get: () => { observations.push('opening:length'); return toLength(0, 1); } });
		const pair = PairAstNode.create(opening, text, null);
		const pairResult = pair.computeMinIndentation(toLength(0, 0), provider);
		const list = ListAstNode.create([text]);
		const receiver = new Proxy(list, {
			get: (target, key, receiver) => { observations.push(`list:get:${String(key)}`); return Reflect.get(target, key, receiver); },
			set: (target, key, value, receiver) => { observations.push(`list:set:${String(key)}`); return Reflect.set(target, key, value, receiver); }
		});
		const listResults = [receiver.computeMinIndentation(toLength(0, 0), provider), receiver.computeMinIndentation(toLength(0, 0), provider)];
		return { textResult, pairResult, listResults, observations };
	});
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust bracket indentation retains opaque cache identities, failed cache writes, and reentrant children', () => {
	const opaque = { value: 3 };
	for (const value of [undefined, null, NaN, Infinity, -0, 'cached', opaque]) {
		const run = () => withModel('', model => {
			const node = ListAstNode.getEmpty();
			Object.defineProperty(node, 'cachedMinIndentation', { value });
			return node.computeMinIndentation(toLength(0, 0), model);
		});
		assert.strictEqual(withRust(run), run());
	}
	const failure = new Error('Original indentation child failure');
	for (const mode of ['throw', 'readonly', 'reentrant'] as const) {
		const run = () => withModel(' x', model => {
			const child = new TextAstNode(toLength(0, 2));
			const list = ListAstNode.create([child]);
			const observations: number[] = [];
			let nested = false;
			Object.defineProperty(child, 'computeMinIndentation', {
				value: () => {
					if (mode === 'throw') { throw failure; }
					if (mode === 'reentrant' && !nested) { nested = true; observations.push(list.computeMinIndentation(toLength(0, 0), model)); }
					return 2;
				}
			});
			if (mode === 'readonly') { Object.defineProperty(list, 'cachedMinIndentation', { writable: false }); }
			const compute = () => list.computeMinIndentation(toLength(0, 0), model);
			if (mode === 'throw') { assert.throws(compute, error => error === failure); }
			else if (mode === 'readonly') { assert.throws(compute, TypeError); }
			else { observations.push(compute()); }
			return { observations, cached: Object.getOwnPropertyDescriptor(list, 'cachedMinIndentation')!.value };
		});
		assert.deepStrictEqual(withRust(run), run(), `Indentation cache ${mode}`);
	}
});

test('Rust bracket indentation releases results and rejects incompatible registration atomically', () => {
	let frees = 0;
	const failure = new Error('Original bracket indentation consumption failure');
	const module: IRustBracketIndentationModule = { ...rust, compute_bracket_indentation: () => ({ take: () => { throw failure; }, free: () => { frees++; } }) };
	withRust(() => withModel('x', model => assert.throws(() => new TextAstNode(toLength(0, 1)).computeMinIndentation(toLength(0, 0), model), error => error === failure)), module);
	assert.strictEqual(frees, 1);
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_indentation_abi_version: () => 0 }), /AST indentation contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketIndentation(rust), /already registered/); } finally { registration.dispose(); }
});
