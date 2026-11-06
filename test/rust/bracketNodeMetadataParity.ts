/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { AstNode, ListAstNode, TextAstNode } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/ast.js';
import { BeforeEditPositionMapper, TextEditInfo } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/beforeEditPositionMapper.js';
import { LanguageAgnosticBracketTokens } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/brackets.js';
import { lengthOfString, toLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/length.js';
import { NodeReader } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/nodeReader.js';
import { parseDocument } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/parser.js';
import { IRustBracketNodeMetadataModule, ownRustBracketNodeMetadata, registerRustBracketNodeMetadata } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketNodeMetadata.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';
import { DenseKeyProvider } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/smallImmutableSet.js';
import { FastTokenizer, TextBufferTokenizer, Token } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/tokenizer.js';
import { LanguageId, MetadataConsts } from '../../src/vs/editor/common/encodedTokenAttributes.js';
import { ResolvedLanguageConfiguration } from '../../src/vs/editor/common/languages/languageConfigurationRegistry.js';
import { LineTokens } from '../../src/vs/editor/common/tokens/lineTokens.js';

interface IRustModule extends IRustTextBufferModule { default(options: { module_or_path: Uint8Array }): Promise<object> }

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustBracketNodeMetadataModule = rust): T {
	const registration = registerRustBracketNodeMetadata(module);
	try { return compute(); } finally { registration.dispose(); }
}

function snapshot(node: AstNode): object {
	return { type: node.constructor.name, length: node.length, height: node.listHeight, keys: Reflect.ownKeys(node), metadata: ['_length', 'listHeight', 'cachedMinIndentation'].map(key => Object.getOwnPropertyDescriptor(node, key)), children: node.children.map(child => snapshot(child)) };
}

test('Rust owning bracket cursor state preserves edit mapping, cache readers, tokens, and incremental parsing', () => {
	const numericDescriptors = (object: object, keys: readonly string[]) => keys.map(key => Object.getOwnPropertyDescriptor(object, key));
	const tokenSnapshot = (token: Token | null) => token ? { kind: token.kind, length: token.length, id: token.bracketId, descriptors: numericDescriptors(token, ['length', 'kind', 'bracketId']) } : null;
	let seed = 1451;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	for (let trace = 0; trace < 64; trace++) {
		const alphabet = ['(', ')', '[', ']', '{', '}', 'text', ' ', '\n', '\t', '😀'];
		const text = Array.from({ length: 32 }, () => alphabet[random(alphabet.length)]).join('');
		const run = () => {
			const edits = [new TextEditInfo(toLength(0, 1), toLength(0, 3), toLength(1, 2)), new TextEditInfo(toLength(2, 1), toLength(2, 2), toLength(0, 4))];
			const mapper = new BeforeEditPositionMapper(edits);
			const mapping = Array.from({ length: 20 }, (_, offset) => ({ offset: mapper.getOffsetBeforeChange(toLength(Math.floor(offset / 5), offset % 5)), distance: mapper.getDistanceToNextChange(toLength(Math.floor(offset / 5), offset % 5)) }));
			const tree = ListAstNode.create23(new TextAstNode(toLength(0, 2)), new TextAstNode(toLength(0, 3)), new TextAstNode(toLength(0, 5)));
			const reader = new NodeReader(tree);
			const nodes = Array.from({ length: 11 }, (_, offset) => { const node = reader.readLongestNodeAt(toLength(0, offset), () => true); return node ? snapshot(node) : null; });
			const brackets = new LanguageAgnosticBracketTokens(new DenseKeyProvider(), language => new ResolvedLanguageConfiguration(language, { brackets: [['(', ')'], ['[', ']'], ['{', '}']] }));
			const singleLanguage = brackets.getSingleLanguageBracketTokens('parity');
			const fast = new FastTokenizer(text, singleLanguage);
			const fastTokens: (object | null)[] = [];
			let token: Token | null;
			while ((token = fast.read()) !== null) { fastTokens.push(tokenSnapshot(token)); }
			const createTokenizer = (value: string) => {
				const lineTokens = value.split('\n').map(text => LineTokens.createFromTextAndMetadata([{ text, metadata: LanguageId.PlainText | MetadataConsts.BALANCED_BRACKETS_MASK }], { encodeLanguageId: () => LanguageId.PlainText, decodeLanguageId: () => 'parity' }));
				return new TextBufferTokenizer({ getValue: () => value, getLineCount: () => lineTokens.length, getLineLength: line => lineTokens[line - 1].getLineContent().length, tokenization: { getLineTokens: line => lineTokens[line - 1] } }, brackets);
			};
			const tokenizer = createTokenizer(text);
			const tokens: object[] = [];
			while (tokenizer.peek()) { tokens.push({ peek: tokenSnapshot(tokenizer.peek()), read: tokenSnapshot(tokenizer.read()), offset: tokenizer.offset }); }
			const lineReader = Object.getOwnPropertyDescriptor(tokenizer, 'reader')!.value as object;
			const initial = parseDocument(new FastTokenizer(text, singleLanguage), [], undefined, true);
			const updated = parseDocument(createTokenizer(text.slice(1)), [new TextEditInfo(toLength(0, 0), lengthOfString(text.slice(0, 1)), toLength(0, 0))], initial, false);
			return { mapping, mapper: numericDescriptors(mapper, ['nextEditIdx', 'deltaOldToNewLineCount', 'deltaOldToNewColumnCount', 'deltaLineIdxInOld']), edits: edits.map(edit => numericDescriptors(edit, ['startOffset', 'endOffset', 'newLength'])), nodes, reader: numericDescriptors(reader, ['lastOffset']), fastTokens, fast: numericDescriptors(fast, ['_offset', 'idx', 'length']), tokens, tokenizer: numericDescriptors(tokenizer, ['textBufferLineCount', 'textBufferLastLineLength', '_offset']), lineReader: numericDescriptors(lineReader, ['textBufferLineCount', 'textBufferLastLineLength', 'lineIdx', 'lineCharOffset', 'lineTokenOffset']), initial: snapshot(initial), updated: snapshot(updated) };
		};
		assert.deepStrictEqual(withRust(run), run(), `Owning bracket cursor trace ${trace}`);
	}
});

test('Rust owning bracket metadata preserves seeded AST mutation, clones, shallow aliases, and descriptors', () => {
	let seed = 1423;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	for (let trace = 0; trace < 128; trace++) {
		const lengths = Array.from({ length: 24 }, () => toLength(random(3), random(8)));
		const run = () => {
			const leaves = lengths.map(length => new TextAstNode(length));
			const immutable = ListAstNode.create23(leaves[0], leaves[1], leaves[2], true);
			const compact = immutable.toMutable();
			compact.unprependChild();
			compact.appendChildOfSameHeight(leaves[3]);
			compact.unappendChild();
			compact.prependChildOfSameHeight(leaves[4]);
			const items = [compact, immutable];
			const array = ListAstNode.create(items);
			array.appendChildOfSameHeight(ListAstNode.create23(leaves[5], leaves[6], null));
			const copy = array.deepClone();
			return { tree: snapshot(array), copy: snapshot(copy), flat: snapshot(array.flattenLists()), immutable: snapshot(immutable), sharedArray: array.children === items, sharedLeaf: compact.getChild(0) === leaves[4] };
		};
		assert.deepStrictEqual(withRust(run), run(), `Owning bracket metadata trace ${trace}`);
	}
	assert.ok(rust.bracket_node_metadata_live_count() > 1000, 'Actual AST constructors allocate native owning records');
});

test('Rust bracket metadata preserves reflection, property order, receiver traps, and unsupported descriptors', () => {
	const symbol = Symbol('metadata');
	const run = () => {
		const observations: string[] = [];
		const node = ownRustBracketNodeMetadata({ _length: -0, marker: 1, listHeight: 2, cachedMinIndentation: -1 });
		const receiver = new Proxy(node, {
			get: (target, key, receiver) => { observations.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); },
			set: (target, key, value, receiver) => { observations.push(`set:${String(key)}`); return Reflect.set(target, key, value, receiver); },
			getOwnPropertyDescriptor: (target, key) => { observations.push(`descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
			defineProperty: (target, key, descriptor) => { observations.push(`define:${String(key)}`); return Reflect.defineProperty(target, key, descriptor); }
		});
		const signedZero = Object.is(receiver._length, -0);
		receiver._length = Number.NaN;
		Object.defineProperty(receiver, 'listHeight', { writable: false });
		assert.throws(() => { receiver.listHeight = 3; }, TypeError);
		Object.defineProperty(receiver, 'cachedMinIndentation', { get: () => { observations.push('cache:get'); return 11; }, configurable: true });
		const cached = receiver.cachedMinIndentation;
		Reflect.deleteProperty(receiver, '_length');
		Object.defineProperty(receiver, '_length', { value: Number.POSITIVE_INFINITY, enumerable: false, writable: true, configurable: true });
		Reflect.set(receiver, '10', 10);
		Reflect.set(receiver, '2', 2);
		Reflect.set(receiver, symbol, 'symbol');
		const other = {};
		const assigned = Reflect.set(receiver, '_length', 7, other);
		const primitive = Reflect.set(receiver, '_length', 7, 0);
		Object.defineProperty(receiver, '_length', { value: { tag: 'unsupported' } });
		Object.defineProperty(receiver, 'listHeight', { configurable: false });
		const keys = Reflect.ownKeys(receiver);
		const descriptors = keys.map(key => {
			const descriptor = Object.getOwnPropertyDescriptor(receiver, key)!;
			return { ...descriptor, get: typeof descriptor.get, set: typeof descriptor.set };
		});
		return { observations, signedZero, cached, assigned, primitive, other, keys, descriptors };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust bracket metadata releases records when frozen and retains live nodes after registration disposal', () => {
	const before = rust.bracket_node_metadata_live_count();
	const node = withRust(() => ListAstNode.create23(new TextAstNode(toLength(0, 1)), new TextAstNode(toLength(0, 2)), null));
	const retained = snapshot(node);
	assert.strictEqual(rust.bracket_node_metadata_live_count(), before + 3);
	for (const child of node.children) { Object.freeze(child); }
	Object.freeze(node);
	assert.deepStrictEqual({ length: node.length, height: node.listHeight, count: rust.bracket_node_metadata_live_count(), frozen: Object.isFrozen(node), childrenFrozen: node.children.every(child => Object.isFrozen(child)) }, { length: toLength(0, 3), height: 1, count: before, frozen: true, childrenFrozen: true });
	assert.deepStrictEqual(Reflect.ownKeys(node), (retained as { keys: (string | symbol)[] }).keys);
});

test('Rust numeric bracket records release unreachable and cyclic AST facades without retaining a graph', async () => {
	assert.ok(global.gc, 'The compatibility runner exposes garbage collection');
	withRust(() => {
		for (let index = 0; index < 256; index++) {
			const node = ListAstNode.create23(new TextAstNode(toLength(0, 1)), new TextAstNode(toLength(0, 2)), null);
			Object.defineProperty(node, '_item1', { value: node });
		}
	});
	for (let attempt = 0; attempt < 100 && rust.bracket_node_metadata_live_count() > 0; attempt++) {
		global.gc();
		await setTimeout(10);
	}
	assert.strictEqual(rust.bracket_node_metadata_live_count(), 0);
});

test('Rust owning bracket metadata rejects stale registrations and frees failed record construction', () => {
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_node_metadata_abi_version: () => 0 }), /owning AST contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketNodeMetadata(rust), /already registered/); } finally { registration.dispose(); }
	let frees = 0;
	const failure = new Error('Original native bracket metadata definition failure');
	const module: IRustBracketNodeMetadataModule = {
		...rust,
		WasmBracketNodeMetadata: class extends rust.WasmBracketNodeMetadata {
			override define(): void { throw failure; }
			override free(): void { frees++; super.free(); }
		}
	};
	withRust(() => assert.throws(() => new TextAstNode(toLength(0, 1)), error => error === failure), module);
	assert.strictEqual(frees, 1);
});
