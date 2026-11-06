/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { AstNode, ListAstNode, TextAstNode } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/ast.js';
import { toLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/length.js';
import { IRustBracketMutationModule, registerRustBracketMutation } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketMutation.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustBracketMutationModule = rust): T {
	const registration = registerRustBracketMutation(module);
	try { return compute(); } finally { registration.dispose(); }
}

function snapshot(node: ListAstNode): object {
	return { length: node.length, height: node.listHeight, children: node.children.map(child => child.length), missing: node.missingOpeningBracketIds, cache: Object.getOwnPropertyDescriptor(node, 'cachedMinIndentation')!.value };
}

function mutate(node: ListAstNode, operation: number, incoming: AstNode): AstNode | undefined {
	switch (operation) {
		case 0: node.appendChildOfSameHeight(incoming); return undefined;
		case 1: return node.unappendChild();
		case 2: node.prependChildOfSameHeight(incoming); return undefined;
		default: return node.unprependChild();
	}
}

test('Rust concrete bracket mutations preserve seeded compact/array state, errors, and removed-node identities', () => {
	let seed = 1361;
	let calls = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const module: IRustBracketMutationModule = { ...rust, mutate_bracket_list: (...args) => { calls++; return rust.mutate_bracket_list(...args); } };
	for (let trace = 0; trace < 256; trace++) {
		const operations = Array.from({ length: 32 }, () => [random(4), random(3), random(8)]);
		for (const compact of [false, true]) {
			for (const immutable of [false, true]) {
				const run = () => {
					const items = [new TextAstNode(toLength(0, 1)), new TextAstNode(toLength(1, 2))];
					const node = compact ? ListAstNode.create23(items[0], items[1], null, immutable) : ListAstNode.create(items, immutable);
					return operations.map(([operation, lines, columns]) => {
						const original = node.children.slice();
						let result: AstNode | undefined;
						let errorMessage: string | undefined;
						try { result = mutate(node, operation, new TextAstNode(toLength(lines, columns))); } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
						return { state: snapshot(node), result: result?.length, identity: operation === 1 ? result === original[original.length - 1] : operation === 3 ? result === original[0] : result === undefined, errorMessage };
					});
				};
				assert.deepStrictEqual(withRust(run, module), run(), `Bracket mutation trace ${trace}/${compact}/${immutable}`);
			}
		}
	}
	assert.strictEqual(calls, 32768, 'Every concrete list mutation executes in Rust');
});

test('Rust concrete bracket mutations preserve receiver proxies and readonly compact partial writes', () => {
	for (const readonly of ['none', '_item1', '_item2', '_item3'] as const) {
		const run = () => {
			const observations: string[] = [];
			const node = ListAstNode.create23(new TextAstNode(toLength(0, 1)), new TextAstNode(toLength(0, 2)), null);
			if (readonly !== 'none') { Object.defineProperty(node, readonly, { writable: false }); }
			const receiver = new Proxy(node, {
				get: (target, key, receiver) => { observations.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); },
				set: (target, key, value, receiver) => { observations.push(`set:${String(key)}`); return Reflect.set(target, key, value, receiver); }
			});
			if (readonly === 'none') { receiver.prependChildOfSameHeight(new TextAstNode(toLength(0, 3))); } else { assert.throws(() => receiver.prependChildOfSameHeight(new TextAstNode(toLength(0, 3))), TypeError); }
			return { observations, state: snapshot(node) };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust concrete bracket mutations preserve overridden arrays, metadata failures, and reentrant updates', () => {
	const failure = new Error('Original concrete bracket metadata failure');
	for (const compact of [false, true]) {
		for (const mode of ['throw', 'reentrant'] as const) {
			const run = () => {
				const first = new TextAstNode(toLength(0, 1));
				const second = new TextAstNode(toLength(0, 2));
				const items: AstNode[] = [first, second];
				const node = compact ? ListAstNode.create23(first, second, null) : ListAstNode.create(items);
				const observations: string[] = [];
				if (!compact) { Object.defineProperty(items, 'push', { value: (incoming: AstNode) => { observations.push('array:push'); items[items.length] = incoming; return items.length; } }); }
				const original = node.handleChildrenChanged;
				let nested = false;
				Object.defineProperty(node, 'handleChildrenChanged', {
					get: () => {
						observations.push('update:get');
						return () => {
							observations.push('update:call');
							if (mode === 'throw') { throw failure; }
							if (!nested) { nested = true; node.unappendChild(); }
							Reflect.apply(original, node, []);
						};
					}
				});
				const append = () => node.appendChildOfSameHeight(new TextAstNode(toLength(0, 3)));
				if (mode === 'throw') { assert.throws(append, error => error === failure); } else { append(); }
				return { observations, state: snapshot(node) };
			};
			assert.deepStrictEqual(withRust(run), run());
		}
	}
});

test('Rust concrete bracket mutations release results and reject stale registrations atomically', () => {
	let frees = 0;
	const failure = new Error('Original bracket mutation result consumption failure');
	const module: IRustBracketMutationModule = { ...rust, mutate_bracket_list: () => ({ take: () => { throw failure; }, free: () => { frees++; } }) };
	const node = ListAstNode.create23(new TextAstNode(toLength(0, 1)), new TextAstNode(toLength(0, 1)), null);
	withRust(() => assert.throws(() => node.appendChildOfSameHeight(new TextAstNode(toLength(0, 1))), error => error === failure), module);
	assert.strictEqual(frees, 1);
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_mutation_abi_version: () => 0 }), /list mutation contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketMutation(rust), /already registered/); } finally { registration.dispose(); }
});
