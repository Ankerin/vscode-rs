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
import { Range } from '../../src/vs/editor/common/core/range.js';
import { ResolvedLanguageConfiguration } from '../../src/vs/editor/common/languages/languageConfigurationRegistry.js';
import { AstNode } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/ast.js';
import { TextEditInfo } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/beforeEditPositionMapper.js';
import { BracketPairsTree } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/bracketPairsTree.js';
import { IRustBracketLifecycleModule, registerRustBracketLifecycle } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLifecycle.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';
import { TextModel } from '../../src/vs/editor/common/model/textModel.js';
import { IModelContentChangedEvent } from '../../src/vs/editor/common/textModelEvents.js';
import { BackgroundTokenizationState } from '../../src/vs/editor/common/tokenizationTextModelPart.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustBracketLifecycleModule = rust): T {
	const registration = registerRustBracketLifecycle(module);
	try { return compute(); } finally { registration.dispose(); }
}

function withTree<T>(compute: (tree: BracketPairsTree, model: TextModel, disposables: DisposableStore) => T, tokens: boolean = false, completed: boolean = false): T {
	const disposables = new DisposableStore();
	try {
		const model = disposables.add(createTextModel('({x}\n[y])', 'parity'));
		Object.defineProperty(model.tokenization, 'hasTokens', { configurable: true, get: () => tokens });
		Object.defineProperty(model.tokenization, 'backgroundTokenizationState', { configurable: true, get: () => completed ? BackgroundTokenizationState.Completed : BackgroundTokenizationState.InProgress });
		const tree = disposables.add(new BracketPairsTree(model, language => new ResolvedLanguageConfiguration(language, { brackets: [['(', ')'], ['[', ']'], ['{', '}']] })));
		return compute(tree, model, disposables);
	} finally { disposables.dispose(); }
}

function snapshot(tree: BracketPairsTree): object {
	const initial = Object.getOwnPropertyDescriptor(tree, 'initialAstWithoutTokens')!.value as AstNode | undefined;
	const current = Object.getOwnPropertyDescriptor(tree, 'astWithTokens')!.value as AstNode | undefined;
	const queue = (key: string) => (Object.getOwnPropertyDescriptor(tree, key)!.value as TextEditInfo[]).map(edit => [edit.startOffset, edit.endOffset, edit.newLength]);
	return { initial: initial?.deepClone().flattenLists(), current: current?.deepClone().flattenLists(), same: initial === current, queue: queue('queuedTextEdits'), initialQueue: queue('queuedTextEditsForInitialAstWithoutTokens') };
}

test('Rust bracket lifecycle preserves all construction branches and exact initial tree aliasing', () => {
	let calls = 0;
	const module: IRustBracketLifecycleModule = { ...rust, run_bracket_lifecycle: (...args) => { calls++; rust.run_bracket_lifecycle(...args); } };
	for (const tokens of [false, true]) {
		for (const completed of [false, true]) {
			const run = () => withTree(tree => snapshot(tree), tokens, completed);
			assert.deepStrictEqual(withRust(run, module), run());
		}
	}
	assert.strictEqual(calls, 4, 'Actual constructor tree selection executes in Rust');
});

test('Rust bracket lifecycle preserves seeded lazy edits, query flushing, and token-change events', () => {
	let seed = 1259;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const fragments = ['(', ')', '[', ']', '{', '}', 'x', '\n', '\uD83D\uDE00', ''];
	for (let trace = 0; trace < 64; trace++) {
		const edits = Array.from({ length: 64 }, () => ({ start: random(100), width: random(4), text: fragments[random(fragments.length)], flush: random(3) === 0, tokens: random(4) === 0 }));
		const run = () => withTree((tree, model, disposables) => {
			const events: object[] = [];
			disposables.add(model.onDidChangeContent(change => tree.handleContentChanged(change)));
			disposables.add(tree.onDidChange(() => { events.push(snapshot(tree)); }));
			const states = edits.map(edit => {
				const start = edit.start % (model.getValueLength() + 1);
				const end = Math.min(start + edit.width, model.getValueLength());
				model.applyEdits([{ range: Range.fromPositions(model.getPositionAt(start), model.getPositionAt(end)), text: edit.text }]);
				if (edit.tokens) { tree.handleDidChangeTokens({ ranges: [{ fromLineNumber: 1, toLineNumber: model.getLineCount() }], semanticTokensApplied: false }); }
				if (edit.flush) { tree.getBracketsInRange(model.getFullModelRange(), false).toArray(); }
				return snapshot(tree);
			});
			Object.defineProperty(model.tokenization, 'backgroundTokenizationState', { get: () => BackgroundTokenizationState.Completed });
			tree.handleDidChangeBackgroundTokenizationState();
			tree.handleDidChangeBackgroundTokenizationState();
			tree.handleDidChangeTokens({ ranges: [{ fromLineNumber: 1, toLineNumber: model.getLineCount() }], semanticTokensApplied: false });
			const pairs = tree.getBracketPairsInRange(model.getFullModelRange(), true).toArray();
			return { states, events, final: snapshot(tree), pairs };
		});
		assert.deepStrictEqual(withRust(run), run(), `Bracket lifecycle trace ${trace}`);
	}
});

test('Rust bracket lifecycle preserves receiver proxies, parser dispatch, and partial queue commits', () => {
	const failure = new Error('Original provisional tree parse failure');
	const run = () => withTree((tree, model, disposables) => {
		const observations: string[] = [];
		const receiver = new Proxy(tree, {
			get: (target, key, receiver) => { observations.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); },
			set: (target, key, value, receiver) => { observations.push(`set:${String(key)}`); return Reflect.set(target, key, value, receiver); }
		});
		let change: IModelContentChangedEvent | undefined;
		disposables.add(model.onDidChangeContent(event => { change = event; }));
		model.applyEdits([{ range: new Range(1, 3, 1, 4), text: 'yy' }]);
		receiver.handleContentChanged(change!);
		const parser = Reflect.get(tree, 'parseDocumentFromTextBuffer') as (edits: TextEditInfo[], previous: AstNode | undefined, immutable: boolean) => AstNode;
		Object.defineProperty(tree, 'parseDocumentFromTextBuffer', {
			value: (edits: TextEditInfo[], previous: AstNode | undefined, immutable: boolean) => {
				observations.push('parse');
				if (previous === Object.getOwnPropertyDescriptor(tree, 'initialAstWithoutTokens')!.value && previous !== Object.getOwnPropertyDescriptor(tree, 'astWithTokens')!.value) { throw failure; }
				return Reflect.apply(parser, tree, [edits, previous, immutable]) as AstNode;
			}
		});
		// Make the initial tree independently observable before the two queued parses.
		const initial = Object.getOwnPropertyDescriptor(tree, 'initialAstWithoutTokens')!.value as AstNode;
		Object.defineProperty(tree, 'initialAstWithoutTokens', { value: initial.deepClone() });
		assert.throws(() => receiver.getBracketsInRange(model.getFullModelRange(), false), error => error === failure);
		return { observations, state: snapshot(tree) };
	});
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust bracket lifecycle preserves readonly queue failures and reentrant event listeners', () => {
	const run = () => withTree((tree, model, disposables) => {
		let change: IModelContentChangedEvent | undefined;
		disposables.add(model.onDidChangeContent(event => { change = event; }));
		model.applyEdits([{ range: new Range(1, 3, 1, 4), text: 'yy' }]);
		Object.defineProperty(tree, 'queuedTextEditsForInitialAstWithoutTokens', { writable: false });
		assert.throws(() => tree.handleContentChanged(change!), TypeError);
		const partial = snapshot(tree);
		Object.defineProperty(tree, 'queuedTextEditsForInitialAstWithoutTokens', { writable: true });
		const events: object[] = [];
		let nested = false;
		disposables.add(tree.onDidChange(() => { events.push(snapshot(tree)); if (!nested) { nested = true; events.push(tree.getBracketPairsInRange(model.getFullModelRange(), false).toArray()); tree.handleDidChangeBackgroundTokenizationState(); } }));
		Object.defineProperty(model.tokenization, 'backgroundTokenizationState', { get: () => BackgroundTokenizationState.Completed });
		tree.handleDidChangeBackgroundTokenizationState();
		return { partial, events, final: snapshot(tree) };
	});
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust bracket lifecycle propagates original operation failures and rejects stale registration atomically', () => {
	const failure = new Error('Original bracket lifecycle operation failure');
	const module: IRustBracketLifecycleModule = { ...rust, run_bracket_lifecycle: () => { throw failure; } };
	withTree(tree => withRust(() => assert.throws(() => tree.handleDidChangeBackgroundTokenizationState(), error => error === failure), module));
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_lifecycle_abi_version: () => 0 }), /tree lifecycle contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketLifecycle(rust), /already registered/); } finally { registration.dispose(); }
});
