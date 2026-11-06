/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { AstNode, AstNodeKind, BracketAstNode, ListAstNode, PairAstNode, TextAstNode } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/ast.js';
import { TextEditInfo } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/beforeEditPositionMapper.js';
import { BracketTokens } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/brackets.js';
import { Length, lengthAdd, lengthOfString, toLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/length.js';
import { parseDocument } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/parser.js';
import { IRustBracketParserModule, registerRustBracketParser } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketParser.js';
import { identityKeyProvider, SmallImmutableSet } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/smallImmutableSet.js';
import { FastTokenizer, Token, Tokenizer, TokenKind } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/tokenizer.js';
import { LanguageBracketsConfiguration } from '../../src/vs/editor/common/languages/supports/languageBracketsConfiguration.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

interface INodeSnapshot {
	kind: AstNodeKind;
	height: number;
	length: object;
	type: string;
	missing: number[];
	children: (INodeSnapshot | null)[];
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustBracketParserModule = rust): T {
	const registration = registerRustBracketParser(module);
	try { return compute(); } finally { registration.dispose(); }
}

function bracketTokens(): BracketTokens {
	const configuration = new LanguageBracketsConfiguration('parity', { brackets: [['(', ')'], ['[', ']'], ['{', '}'], ['begin', 'end'], ['repeat', 'end']] });
	const ids = new Map(configuration.openingBrackets.map((bracket, index) => [bracket, index]));
	const tokens = new Map<string, Token>();
	for (const bracket of configuration.openingBrackets) {
		const id = ids.get(bracket)!;
		const set = SmallImmutableSet.getEmpty<number>().add(id, identityKeyProvider);
		const length = toLength(0, bracket.bracketText.length);
		tokens.set(bracket.bracketText, new Token(length, TokenKind.OpeningBracket, id, set, BracketAstNode.create(length, bracket, set)));
	}
	for (const bracket of configuration.closingBrackets) {
		const opening = bracket.getOpeningBrackets();
		const set = opening.reduce((set, bracket) => set.add(ids.get(bracket)!, identityKeyProvider), SmallImmutableSet.getEmpty<number>());
		const length = toLength(0, bracket.bracketText.length);
		tokens.set(bracket.bracketText, new Token(length, TokenKind.ClosingBracket, ids.get(opening[0])!, set, BracketAstNode.create(length, bracket, set)));
	}
	return new BracketTokens(tokens);
}

function snapshot(node: AstNode | null): INodeSnapshot | null {
	if (!node) { return null; }
	return {
		kind: node.kind, height: node.listHeight, length: node.length, type: node.constructor.name,
		missing: [0, 1, 2, 3, 4].filter(id => node.missingOpeningBracketIds.has(id, identityKeyProvider)),
		children: Array.from({ length: node.childrenLength }, (_, index) => snapshot(node.getChild(index)))
	};
}

class CharacterTokenizer implements Tokenizer {
	offset = toLength(0, 0);
	readonly length: Length;
	index = 0;
	readonly tokens: Token[];

	constructor(private readonly text: string, brackets: BracketTokens) {
		this.length = lengthOfString(text);
		this.tokens = Array.from(text, character => {
			const length = lengthOfString(character);
			return brackets.getToken(character) ?? new Token(length, TokenKind.Text, -1, SmallImmutableSet.getEmpty(), new TextAstNode(length));
		});
	}

	read(): Token | null {
		const token = this.tokens[this.index++] ?? null;
		if (token) { this.offset = lengthAdd(this.offset, token.length); }
		return token;
	}

	peek(): Token | null { return this.tokens[this.index] ?? null; }

	skip(length: Length): void {
		const target = lengthAdd(this.offset, length);
		while (this.offset < target && this.index < this.tokens.length) { this.read(); }
		if (this.offset !== target) { throw new Error('Invalid cached token boundary'); }
	}

	getText(): string { return this.text; }
}

test('Rust bracket parser preserves seeded initial trees, immutable classes, ambiguous closers, and depth guard', () => {
	let seed = 607;
	let documents = 0;
	let lists = 0;
	let children = 0;
	let caches = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const module: IRustBracketParserModule = {
		...rust,
		parse_bracket_document: host => { documents++; return rust.parse_bracket_document(host); },
		parse_bracket_list: (...args) => { lists++; return rust.parse_bracket_list(...args); },
		parse_bracket_child: (...args) => { children++; return rust.parse_bracket_child(...args); },
		read_bracket_parser_cache: (...args) => { caches++; return rust.read_bracket_parser_cache(...args); }
	};
	const brackets = bracketTokens();
	const fragments = ['(', ')', '[', ']', '{', '}', 'begin ', 'repeat ', 'end ', 'x', '\n', '\t', '😀'];
	for (let trace = 0; trace < 512; trace++) {
		const text = Array.from({ length: random(128) }, () => fragments[random(fragments.length)]).join('');
		for (const immutable of [false, true]) {
			const run = () => snapshot(parseDocument(new FastTokenizer(text, brackets), [], undefined, immutable));
			assert.deepStrictEqual(withRust(run, module), run(), `Bracket parser trace ${trace}/${immutable}`);
		}
	}
	assert.strictEqual(documents, 1024);
	assert.ok(lists > 1024 && children > 1000 && caches > 1000, 'Actual recursive list, child, and cache orchestration execute in Rust');
	for (const text of ['', '('.repeat(512) + ')'.repeat(512), 'begin repeat end end', '{ [ } )']) {
		const run = () => snapshot(parseDocument(new FastTokenizer(text, brackets), [], undefined, true));
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust bracket parser preserves seeded incremental cache identities, touching edit exclusions, and token skips', () => {
	let seed = 811;
	let predicates = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const brackets = bracketTokens();
	const characters = ['(', ')', '[', ']', '{', '}', 'x', ' ', '\n', '\t'];
	const module: IRustBracketParserModule = { ...rust, can_reuse_bracket_parser_node: (...args) => { predicates++; return rust.can_reuse_bracket_parser_node(...args); } };
	for (let trace = 0; trace < 256; trace++) {
		const text = Array.from({ length: 128 }, () => characters[random(characters.length)]).join('');
		const start = random(text.length);
		const end = Math.min(text.length, start + random(9));
		const inserted = Array.from({ length: random(9) }, () => characters[random(characters.length)]).join('');
		const changed = text.slice(0, start) + inserted + text.slice(end);
		const edits = [new TextEditInfo(lengthOfString(text.slice(0, start)), lengthOfString(text.slice(0, end)), lengthOfString(inserted))];
		const run = () => {
			const original = parseDocument(new CharacterTokenizer(text, brackets), [], undefined, false);
			const nodes = new Set<AstNode>();
			const collect = (node: AstNode) => { nodes.add(node); for (let index = 0; index < node.childrenLength; index++) { const child = node.getChild(index); if (child) { collect(child); } } };
			collect(original);
			const tokenizer = new CharacterTokenizer(changed, brackets);
			const node = parseDocument(tokenizer, edits, original, false);
			const reused: AstNode[] = [];
			const visit = (node: AstNode) => { if (nodes.has(node)) { reused.push(node); } for (let index = 0; index < node.childrenLength; index++) { const child = node.getChild(index); if (child) { visit(child); } } };
			visit(node);
			return { tree: snapshot(node), reused: reused.map(node => [node.kind, node.length]), offset: tokenizer.offset, index: tokenizer.index };
		};
		assert.deepStrictEqual(withRust(run, module), run(), `Incremental parser trace ${trace}`);
	}
	assert.ok(predicates > 1000, 'Actual incremental reader predicates execute in the native parser');
});

test('Rust bracket parser preserves token/provider/factory observations and original returned text node identities', () => {
	const pair = Object.getOwnPropertyDescriptor(PairAstNode, 'create')!;
	const list = Object.getOwnPropertyDescriptor(ListAstNode, 'create23')!;
	const run = () => {
		const observations: string[] = [];
		const observe = <T extends object>(target: T, name: string): T => new Proxy(target, { get: (target, key, receiver) => { observations.push(`${name}:${String(key)}`); return Reflect.get(target, key, receiver); } });
		const tokenizer = new CharacterTokenizer('{(x)[y]} )', bracketTokens());
		for (let index = 0; index < tokenizer.tokens.length; index++) { tokenizer.tokens[index] = observe(tokenizer.tokens[index], `token:${index}`); }
		Object.defineProperty(PairAstNode, 'create', { ...pair, value: (...args: Parameters<typeof PairAstNode.create>) => { observations.push('pair'); return Reflect.apply(pair.value, PairAstNode, args); } });
		Object.defineProperty(ListAstNode, 'create23', { ...list, value: (...args: Parameters<typeof ListAstNode.create23>) => { observations.push('list'); return Reflect.apply(list.value, ListAstNode, args); } });
		try {
			const node = parseDocument(observe(tokenizer, 'tokenizer'), [], undefined, true);
			const textNodes: AstNode[] = [];
			const visit = (node: AstNode) => { if (node.kind === AstNodeKind.Text) { textNodes.push(node); } for (let index = 0; index < node.childrenLength; index++) { const child = node.getChild(index); if (child) { visit(child); } } };
			visit(node);
			const identities = textNodes.map(node => tokenizer.tokens.some(token => token.astNode === node));
			return { tree: snapshot(node), observations, identities };
		} finally { Object.defineProperty(PairAstNode, 'create', pair); Object.defineProperty(ListAstNode, 'create23', list); }
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust bracket parser preserves tokenizer/cache failure identity and consumed-token partial state', () => {
	const failure = new Error('Original bracket parser callback failure');
	for (const failAt of [1, 2, 3, 4]) {
		const run = () => {
			let reads = 0;
			const tokenizer = new CharacterTokenizer('(x){y}', bracketTokens());
			const read = tokenizer.read;
			Object.defineProperty(tokenizer, 'read', { value: () => { if (++reads === failAt) { throw failure; } return Reflect.apply(read, tokenizer, []); } });
			assert.throws(() => parseDocument(tokenizer, [], undefined, true), error => error === failure);
			return { reads, index: tokenizer.index, offset: tokenizer.offset };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
	const cached = () => {
		const original = new TextAstNode(toLength(0, 1));
		Object.defineProperty(original, 'canBeReused', { value: () => { throw failure; } });
		const tokenizer = new CharacterTokenizer('x', bracketTokens());
		assert.throws(() => parseDocument(tokenizer, [], original, false), error => error === failure);
		return { index: tokenizer.index, offset: tokenizer.offset };
	};
	assert.deepStrictEqual(withRust(cached), cached());
	for (const kind of [3, '1', Number.NaN, undefined]) {
		const run = () => {
			const tokenizer = new CharacterTokenizer('x', bracketTokens());
			Object.defineProperty(tokenizer.tokens[0], 'kind', { value: kind });
			assert.throws(() => parseDocument(tokenizer, [], undefined, false), /unexpected/);
			return { index: tokenizer.index, offset: tokenizer.offset };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust bracket parser releases scoped results and rejects stale core registrations atomically', () => {
	const node = new TextAstNode(toLength(0, 1));
	let frees = 0;
	const module: IRustBracketParserModule = { ...rust, parse_bracket_document: () => ({ take: () => node, free: () => { frees++; } }) };
	assert.strictEqual(withRust(() => parseDocument(new CharacterTokenizer('x', bracketTokens()), [], undefined, true), module), node);
	assert.strictEqual(frees, 1);
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_parser_abi_version: () => 0 }), /parser orchestration contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketParser(rust), /already registered/); } finally { registration.dispose(); }
});

