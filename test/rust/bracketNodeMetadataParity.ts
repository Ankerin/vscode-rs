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
import { BracketScalarValue } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/bracketNumericProperties.js';
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
			return { mapping, mapper: numericDescriptors(mapper, ['nextEditIdx', 'deltaOldToNewLineCount', 'deltaOldToNewColumnCount', 'deltaLineIdxInOld']), edits: edits.map(edit => numericDescriptors(edit, ['startOffset', 'endOffset', 'newLength'])), nodes, reader: numericDescriptors(reader, ['lastOffset']), fastTokens, fast: numericDescriptors(fast, ['_offset', 'idx', 'length', 'text']), tokens, tokenizer: numericDescriptors(tokenizer, ['textBufferLineCount', 'textBufferLastLineLength', '_offset', 'didPeek', 'peeked']), lineReader: numericDescriptors(lineReader, ['textBufferLineCount', 'textBufferLastLineLength', 'lineIdx', 'lineCharOffset', 'lineTokenOffset', 'line', 'peekedToken']), regexp: numericDescriptors(singleLanguage, ['hasRegExp', '_regExpGlobal']), initial: snapshot(initial), updated: snapshot(updated) };
		};
		assert.deepStrictEqual(withRust(run), run(), `Owning bracket cursor trace ${trace}`);
	}
});

test('Rust scalar ownership preserves UTF-16 strings, flags, nullish values, bigint, and host reference transitions', () => {
	const symbol = Symbol('host scalar key');
	const values = [false, true, '', 'borrowed\uD800\r\n\uDC00', undefined, null, 2n ** 80n, -0, Number.NaN, symbol, {}, () => 1];
	const run = () => {
		const node = ownRustBracketNodeMetadata({ _length: values[0], marker: 1, listHeight: null, cachedMinIndentation: undefined });
		const states = values.map(value => {
			Reflect.set(node, '_length', value);
			const stored = Reflect.get(node, '_length');
			return { identical: Object.is(stored, value), descriptors: Reflect.ownKeys(node).map(key => Object.getOwnPropertyDescriptor(node, key)) };
		});
		let reads = 0;
		Object.defineProperty(node, '_length', { get: () => { reads++; return symbol; }, configurable: true });
		const accessor = Object.getOwnPropertyDescriptor(node, '_length');
		const value = Reflect.get(node, '_length');
		Object.defineProperty(node, '_length', { value: undefined, writable: true, configurable: true });
		Object.preventExtensions(node);
		return { states, reads, accessor: { get: typeof accessor!.get, hasValue: Object.hasOwn(accessor!, 'value') }, value, final: Object.getOwnPropertyDescriptors(node), extensible: Object.isExtensible(node) };
	};
	assert.deepStrictEqual(withRust(run), run());
	let reads = 0;
	const source = Object.defineProperty({}, '_length', { get: () => { reads++; return undefined; }, configurable: true });
	withRust(() => {
		const node = ownRustBracketNodeMetadata(source);
		assert.deepStrictEqual({ reads, accessor: typeof Object.getOwnPropertyDescriptor(node, '_length')!.get }, { reads: 0, accessor: 'function' });
		Object.freeze(node);
	});
});

test('Rust scalar records own supported payloads and reject references atomically in all seven slots', () => {
	const before = rust.bracket_node_metadata_live_count();
	const record = new rust.WasmBracketNodeMetadata(7);
	try {
		const values = [-0, true, 'line\uD800\r\n\uDC00', 2n ** 80n, null, undefined, Number.NaN];
		values.forEach((value, index) => record.define(index, value, !!(index % 2), true));
		for (const value of [{}, () => 1, Symbol('weak key')]) {
			assert.throws(() => Reflect.apply(record.define, record, [0, value, true, true]), /Unsupported Rust bracket scalar/);
		}
		assert.throws(() => record.define(7, 1, true, true), /Invalid Rust bracket node/);
		assert.deepStrictEqual(values.map((value, index) => ({ identical: Object.is(record.get(index), value), attributes: record.attributes(index), present: record.has(index) })), values.map((_value, index) => ({ identical: true, attributes: 2 | (index % 2), present: true })));
		values.forEach((_value, index) => record.remove(index));
		assert.deepStrictEqual(values.map((_value, index) => record.has(index)), values.map(() => false));
	} finally { record.free(); }
	assert.strictEqual(rust.bracket_node_metadata_live_count(), before);
});

test('Rust reference slots own live AST fields through collector-visible anchors and release frozen records', () => {
	let record: InstanceType<IRustBracketNodeMetadataModule['WasmBracketNodeMetadata']> | undefined;
	const module: IRustBracketNodeMetadataModule = {
		...rust, WasmBracketNodeMetadata: class extends rust.WasmBracketNodeMetadata {
			constructor(fieldCount: number) { super(fieldCount); record = this; }
		}
	};
	const child = { marker: 'child' };
	const callback = () => child;
	const symbol = Symbol('reference anchor');
	const array = [child];
	const target = { _length: 1, child, bracketInfo: symbol, _children: array, closingBracket: callback };
	const before = rust.bracket_node_metadata_live_count();
	const facade = withRust(() => ownRustBracketNodeMetadata(target), module);
	assert.deepStrictEqual({ targetKeys: Reflect.ownKeys(target), references: [4, 5, 11, 13].map(index => record!.reference(index)), identities: [facade.child === child, facade.bracketInfo === symbol, facade._children === array, facade.closingBracket === callback] }, { targetKeys: [], references: [4, 5, 11, 13], identities: [true, true, true, true] });
	const states = [null, child, undefined, symbol, callback, array].map(value => {
		Object.defineProperty(facade, 'child', { value });
		return { identical: Object.is(Reflect.get(facade, 'child'), value), reference: record!.reference(4), value: record!.get(4), targetHasChild: Object.hasOwn(target, 'child') };
	});
	assert.deepStrictEqual(states, [
		{ identical: true, reference: undefined, value: null, targetHasChild: false },
		{ identical: true, reference: 4, value: 4, targetHasChild: false },
		{ identical: true, reference: undefined, value: undefined, targetHasChild: false },
		{ identical: true, reference: 4, value: 4, targetHasChild: false },
		{ identical: true, reference: 4, value: 4, targetHasChild: false },
		{ identical: true, reference: 4, value: 4, targetHasChild: false }
	]);
	Object.freeze(facade);
	assert.deepStrictEqual({ nativeCount: rust.bracket_node_metadata_live_count(), frozen: Object.isFrozen(facade), aliases: [Object.is(facade.child, array), facade._children === array, facade.bracketInfo === symbol, facade.closingBracket === callback] }, { nativeCount: before, frozen: true, aliases: [true, true, true, true] });
});

test('Rust reference definitions validate schema bounds and preserve prior handles on failures', () => {
	const before = rust.bracket_node_metadata_live_count();
	assert.throws(() => new rust.WasmBracketNodeMetadata(17), /Invalid Rust bracket field schema/);
	const record = new rust.WasmBracketNodeMetadata(2);
	try {
		record.define_reference(0, 123, false, true);
		assert.throws(() => record.define_reference(2, 999, true, true), /Invalid Rust bracket node/);
		assert.deepStrictEqual({ reference: record.reference(0), value: record.get(0), attributes: record.attributes(0), missing: record.has(1), outside: record.reference(2) }, { reference: 123, value: 123, attributes: 2, missing: false, outside: undefined });
		record.define(0, false, true, false);
		assert.deepStrictEqual({ reference: record.reference(0), value: record.get(0), attributes: record.attributes(0) }, { reference: undefined, value: false, attributes: 1 });
		record.remove(0);
		assert.strictEqual(record.has(0), false);
	} finally { record.free(); }
	assert.strictEqual(rust.bracket_node_metadata_live_count(), before);
});

test('Rust reference replacement and deletion release former children while their parent remains live', async () => {
	assert.ok(global.gc, 'The compatibility runner exposes garbage collection');
	const parent = withRust(() => ownRustBracketNodeMetadata({ child: null }));
	const children: WeakRef<object>[] = [];
	withRust(() => {
		for (let index = 0; index < 256; index++) {
			const child = new TextAstNode(toLength(0, index));
			children.push(new WeakRef(child));
			Object.defineProperty(parent, 'child', { value: child, writable: true, enumerable: true, configurable: true });
			if (index % 2) { Reflect.deleteProperty(parent, 'child'); }
		}
	});
	Object.defineProperty(parent, 'child', { value: null, writable: true, enumerable: true, configurable: true });
	for (let attempt = 0; attempt < 100; attempt++) {
		await setTimeout(10);
		global.gc();
		if (children.every(child => child.deref() === undefined)) { break; }
	}
	assert.deepStrictEqual({ retained: children.filter(child => child.deref()).length, child: parent.child }, { retained: 0, child: null });
	Object.freeze(parent);
});

test('Rust tokenizer constructors store flags, borrowed text, and nullable caches in actual native records', () => {
	const writes: BracketScalarValue[] = [];
	const module: IRustBracketNodeMetadataModule = {
		...rust, WasmBracketNodeMetadata: class extends rust.WasmBracketNodeMetadata {
			override define(index: number, value: BracketScalarValue, writable: boolean, enumerable: boolean): void {
				writes.push(value);
				super.define(index, value, writable, enumerable);
			}
		}
	};
	const text = 'prefix\uD800(x)\uDC00';
	withRust(() => {
		const provider = new LanguageAgnosticBracketTokens(new DenseKeyProvider(), language => new ResolvedLanguageConfiguration(language, { brackets: [['(', ')']] }));
		const single = provider.getSingleLanguageBracketTokens('parity');
		const fast = new FastTokenizer(text, single);
		const tokens = LineTokens.createFromTextAndMetadata([{ text, metadata: LanguageId.PlainText | MetadataConsts.BALANCED_BRACKETS_MASK }], { encodeLanguageId: () => LanguageId.PlainText, decodeLanguageId: () => 'parity' });
		const tokenizer = new TextBufferTokenizer({ getValue: () => text, getLineCount: () => 1, getLineLength: () => text.length, tokenization: { getLineTokens: () => tokens } }, provider);
		while (tokenizer.peek()) { tokenizer.read(); }
		parseDocument(fast, [], undefined, true);
	}, module);
	assert.deepStrictEqual({ text: writes.filter(value => value === text).length >= 2, false: writes.includes(false), true: writes.includes(true), null: writes.includes(null) }, { text: true, false: true, true: true, null: true });
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
	// Cached immutable identifier sets retain their original permanent cache lifetime.
	for (let attempt = 0; attempt < 5; attempt++) { global.gc(); await setTimeout(10); }
	const retained = rust.bracket_node_metadata_live_count();
	const symbols = new WeakMap<symbol, object>();
	withRust(() => {
		for (let index = 0; index < 256; index++) {
			const node = ListAstNode.create23(new TextAstNode(toLength(0, 1)), new TextAstNode(toLength(0, 2)), null);
			Object.defineProperty(node, '_item1', { value: node });
			const symbol = Symbol('cyclic weak key');
			const scalar = ownRustBracketNodeMetadata({ _length: symbol });
			symbols.set(symbol, scalar);
		}
	});
	for (let attempt = 0; attempt < 100 && rust.bracket_node_metadata_live_count() > retained; attempt++) {
		global.gc();
		await setTimeout(10);
	}
	assert.strictEqual(rust.bracket_node_metadata_live_count(), retained);
	assert.ok(symbols instanceof WeakMap);
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
	let definitions = 0;
	const source = { _length: 1, listHeight: 2, cachedMinIndentation: -1 };
	const partial: IRustBracketNodeMetadataModule = {
		...rust, WasmBracketNodeMetadata: class extends rust.WasmBracketNodeMetadata {
			override define(index: number, value: BracketScalarValue, writable: boolean, enumerable: boolean): void {
				if (++definitions === 2) { throw failure; }
				super.define(index, value, writable, enumerable);
			}
			override free(): void { frees++; super.free(); }
		}
	};
	withRust(() => assert.throws(() => ownRustBracketNodeMetadata(source), error => error === failure), partial);
	assert.deepStrictEqual({ source, frees, definitions }, { source: { _length: 1, listHeight: 2, cachedMinIndentation: -1 }, frees: 2, definitions: 2 });
});
