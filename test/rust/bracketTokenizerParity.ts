/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { LanguageId, MetadataConsts, StandardTokenType } from '../../src/vs/editor/common/encodedTokenAttributes.js';
import { ResolvedLanguageConfiguration } from '../../src/vs/editor/common/languages/languageConfigurationRegistry.js';
import { ILanguageIdCodec } from '../../src/vs/editor/common/languages.js';
import { LanguageAgnosticBracketTokens } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/brackets.js';
import { Length, toLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/length.js';
import { IRustBracketTokenizerModule, registerRustBracketTokenizer } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketTokenizer.js';
import { DenseKeyProvider } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/smallImmutableSet.js';
import { ITokenizerSource, TextBufferTokenizer, Token } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/tokenizer.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';
import { LineTokens } from '../../src/vs/editor/common/tokens/lineTokens.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

interface ITokenPiece {
	text: string;
	metadata: number;
}

interface IReader {
	read(): Token | null;
	setPosition(line: number, column: number): void;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

const codec: ILanguageIdCodec = {
	encodeLanguageId: language => language === 'parity' ? LanguageId.PlainText : 2 as LanguageId,
	decodeLanguageId: language => language === LanguageId.PlainText ? 'parity' : 'alternate'
};

function withRust<T>(compute: () => T, module: IRustBracketTokenizerModule = rust): T {
	const registration = registerRustBracketTokenizer(module);
	try { return compute(); } finally { registration.dispose(); }
}

function source(lines: ITokenPiece[][]): ITokenizerSource {
	const tokens = lines.map(line => LineTokens.createFromTextAndMetadata(line, codec));
	return {
		getValue: () => tokens.map(tokens => tokens.getLineContent()).join('\n'),
		getLineCount: () => tokens.length,
		getLineLength: line => tokens[line - 1].getLineContent().length,
		tokenization: { getLineTokens: line => tokens[line - 1] }
	};
}

function brackets(): LanguageAgnosticBracketTokens {
	return new LanguageAgnosticBracketTokens(new DenseKeyProvider(), language => new ResolvedLanguageConfiguration(language, { brackets: [['(', ')'], ['[', ']'], ['{', '}'], ['begin', 'end']] }));
}

function reader(tokenizer: TextBufferTokenizer): IReader {
	return Object.getOwnPropertyDescriptor(tokenizer, 'reader')!.value as IReader;
}

function snapshot(token: Token | null): object | null {
	return token ? { kind: token.kind, length: token.length, id: token.bracketId, node: token.astNode?.constructor.name } : null;
}

function state(tokenizer: TextBufferTokenizer, lineReader: IReader = reader(tokenizer)): object {
	return {
		offset: tokenizer.offset,
		didPeek: Object.getOwnPropertyDescriptor(tokenizer, 'didPeek')!.value,
		peeked: snapshot(Object.getOwnPropertyDescriptor(tokenizer, 'peeked')!.value as Token | null),
		reader: Object.fromEntries(['lineIdx', 'lineCharOffset', 'lineTokenOffset', 'peekedToken'].map(name => {
			const value = Object.getOwnPropertyDescriptor(lineReader, name)!.value;
			return [name, name === 'peekedToken' ? snapshot(value as Token | null) : value];
		}))
	};
}

test('Rust bracket tokenizer preserves seeded metadata boundaries, languages, complete token streams, and cursor state', () => {
	let seed = 929;
	let reads = 0;
	let peeks = 0;
	let lineReads = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const fragments = ['(', ')', '[', ']', '{', '}', 'be', 'gin', 'end', 'x', ' ', '\t', '😀'];
	const module: IRustBracketTokenizerModule = {
		...rust,
		read_peekable_bracket_token: host => { reads++; return rust.read_peekable_bracket_token(host); },
		peek_bracket_token: host => { peeks++; return rust.peek_bracket_token(host); },
		read_bracket_token: host => { lineReads++; return rust.read_bracket_token(host); }
	};
	for (let trace = 0; trace < 512; trace++) {
		const lines = Array.from({ length: 1 + random(8) }, () => Array.from({ length: 1 + random(24) }, () => ({
			text: fragments[random(fragments.length)],
			metadata: (1 + random(2)) | (random(4) << MetadataConsts.TOKEN_TYPE_OFFSET) | (random(2) << MetadataConsts.BALANCED_BRACKETS_OFFSET)
		})));
		const run = () => {
			const tokenizer = new TextBufferTokenizer(source(lines), brackets());
			const tokens: object[] = [];
			while (tokenizer.peek()) {
				const token = tokenizer.read();
				tokens.push({ token: snapshot(token), state: state(tokenizer) });
				if (tokens.length > 1000) { throw new Error('Unexpected tokenizer loop'); }
			}
			return { tokens, state: state(tokenizer), length: tokenizer.length, text: tokenizer.getText() };
		};
		assert.deepStrictEqual(withRust(run, module), run(), `Bracket tokenizer trace ${trace}`);
	}
	assert.ok(reads > 1000 && peeks > 1000 && lineReads > 1000, 'Actual wrapper and line-reader orchestration execute in Rust');
	const metadata = LanguageId.PlainText | MetadataConsts.BALANCED_BRACKETS_MASK;
	for (const text of ['', 'x'.repeat(4096), Array.from({ length: 128 }, () => 'x').join('\n'), ' begin end (😀)\n[]']) {
		const lines = text.split('\n').map(text => [{ text, metadata }]);
		const run = () => {
			const tokenizer = new TextBufferTokenizer(source(lines), brackets());
			const tokens: (object | null)[] = [];
			while (tokenizer.peek()) { tokens.push(snapshot(tokenizer.read())); }
			return { tokens, state: state(tokenizer) };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust bracket tokenizer retains cached token identities, repeated reads, skips, and unusual position values', () => {
	const metadata = LanguageId.PlainText | MetadataConsts.BALANCED_BRACKETS_MASK;
	const lines = ['x (y)', '[z]', ''].map(text => [{ text, metadata }]);
	const run = () => {
		const tokenizer = new TextBufferTokenizer(source(lines), brackets());
		const peeked = tokenizer.peek();
		const first = tokenizer.read();
		const second = tokenizer.read();
		tokenizer.skip(toLength(0, 0));
		const third = tokenizer.read();
		const next = tokenizer.peek();
		tokenizer.skip(toLength(1, 0));
		return { identities: [first === peeked, second === peeked, third === peeked, next === peeked], tokens: [peeked, next].map(snapshot), state: state(tokenizer) };
	};
	assert.deepStrictEqual(withRust(run), run());
	for (const length of [Number.NaN, Number.POSITIVE_INFINITY, -0, 0.5, -1]) {
		const run = () => {
			const tokenizer = new TextBufferTokenizer(source(lines), brackets());
			tokenizer.peek();
			tokenizer.skip(length as unknown as Length);
			return state(tokenizer);
		};
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust bracket tokenizer preserves receiver/reader/provider/regexp observations and matching callback order', () => {
	const run = () => {
		const observations: string[] = [];
		const observe = <T extends object>(target: T, name: string): T => new Proxy(target, {
			get: (target, key, receiver) => { observations.push(`${name}:${String(key)}`); return Reflect.get(target, key, receiver); },
			set: (target, key, value, receiver) => { observations.push(`${name}:set:${String(key)}`); return Reflect.set(target, key, value, receiver); }
		});
		const metadata = LanguageId.PlainText | MetadataConsts.BALANCED_BRACKETS_MASK;
		const original = source(['be' + 'gin (x)', 'end'].map(text => [{ text, metadata }]));
		const lineTokens = original.tokenization.getLineTokens;
		original.tokenization.getLineTokens = line => observe(lineTokens(line), `line:${line}`);
		const bracketTokens = brackets();
		const single = bracketTokens.getSingleLanguageBracketTokens('parity');
		const regexp = single.regExpGlobal!;
		const exec = regexp.exec;
		Object.defineProperty(regexp, 'exec', {
			get: () => {
				observations.push('regexp:exec'); return (text: string) => {
					const match = Reflect.apply(exec, regexp, [text]) as RegExpExecArray | null;
					return match ? observe(match, 'match') : null;
				};
			}
		});
		const target = new TextBufferTokenizer(observe(original, 'source'), observe(bracketTokens, 'brackets'));
		const lineReader = reader(target);
		const descriptor = Object.getOwnPropertyDescriptor(target, 'reader')!;
		Object.defineProperty(target, 'reader', { ...descriptor, value: observe(lineReader, 'reader') });
		const tokenizer = observe(target, 'tokenizer');
		const tokens: (object | null)[] = [];
		while (tokenizer.peek()) { tokens.push(snapshot(tokenizer.read())); }
		tokenizer.skip(toLength(0, 0));
		return { tokens, state: state(target, lineReader), observations };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust bracket tokenizer preserves provider/regexp failures and partial cursor writes without replay', () => {
	const metadata = LanguageId.PlainText | MetadataConsts.BALANCED_BRACKETS_MASK;
	const failure = new Error('Original bracket tokenizer provider failure');
	for (const failAt of [1, 2]) {
		const run = () => {
			let loads = 0;
			const model = source(['x', '(y)'].map(text => [{ text, metadata }]));
			const getTokens = model.tokenization.getLineTokens;
			model.tokenization.getLineTokens = line => { if (++loads === failAt) { throw failure; } return getTokens(line); };
			const tokenizer = new TextBufferTokenizer(model, brackets());
			assert.throws(() => tokenizer.peek(), error => error === failure);
			return { loads, state: state(tokenizer) };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
	const matching = () => {
		const bracketTokens = brackets();
		const regexp = bracketTokens.getSingleLanguageBracketTokens('parity').regExpGlobal!;
		Object.defineProperty(regexp, 'exec', { value: () => { throw failure; } });
		const tokenizer = new TextBufferTokenizer(source([[{ text: 'x (y)', metadata }]]), bracketTokens);
		assert.throws(() => tokenizer.peek(), error => error === failure);
		return state(tokenizer);
	};
	assert.deepStrictEqual(withRust(matching), matching());
	for (const field of ['_offset', 'didPeek', 'peeked']) {
		const run = () => {
			const tokenizer = new TextBufferTokenizer(source([[{ text: '(x)', metadata }]]), brackets());
			Object.defineProperty(tokenizer, field, { writable: false });
			assert.throws(() => { tokenizer.peek(); tokenizer.read(); }, TypeError);
			return state(tokenizer);
		};
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust bracket tokenizer releases result references and rejects stale core registrations atomically', () => {
	let frees = 0;
	const failure = new Error('Original bracket token result consumption failure');
	const module: IRustBracketTokenizerModule = { ...rust, peek_bracket_token: () => ({ take: () => { throw failure; }, free: () => { frees++; } }) };
	withRust(() => assert.throws(() => new TextBufferTokenizer(source([[{ text: 'x', metadata: StandardTokenType.Other }]]), brackets()).peek(), error => error === failure), module);
	assert.strictEqual(frees, 1);
	assert.throws(() => registerRustTextBuffer({ ...rust, bracket_tokenizer_abi_version: () => 0 }), /line reader contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustBracketTokenizer(rust), /already registered/); } finally { registration.dispose(); }
});

