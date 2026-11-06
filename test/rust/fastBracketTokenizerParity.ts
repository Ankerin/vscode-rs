/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { ResolvedLanguageConfiguration } from '../../src/vs/editor/common/languages/languageConfigurationRegistry.js';
import { BracketTokens } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/brackets.js';
import { toLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/length.js';
import { IRustFastBracketTokenizerModule, registerRustFastBracketTokenizer } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustFastBracketTokenizer.js';
import { DenseKeyProvider } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/smallImmutableSet.js';
import { FastTokenizer, Token } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/tokenizer.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { RustBracketLengthOperation, tryRustBracketLength } from '../../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T, module: IRustFastBracketTokenizerModule = rust): T {
	const registration = registerRustFastBracketTokenizer(module);
	try { return compute(); } finally { registration.dispose(); }
}

function brackets(empty = false): BracketTokens {
	return BracketTokens.createFromLanguage(new ResolvedLanguageConfiguration('parity', { brackets: empty ? [] : [['(', ')'], ['[', ']'], ['{', '}'], ['begin', 'end'], ['repeat', 'end']] }), new DenseKeyProvider());
}

function snapshot(tokenizer: FastTokenizer): object {
	const tokens: Token[] = [];
	while (tokenizer.peek()) { tokens.push(tokenizer.read()!); }
	const values = tokens.map(token => ({ kind: token.kind, length: token.length, id: token.bracketId, node: token.astNode?.constructor.name }));
	return { values, identities: tokens.map(token => tokens.indexOf(token)), length: tokenizer.length, offset: tokenizer.offset, index: Object.getOwnPropertyDescriptor(tokenizer, 'idx')!.value };
}

test('Rust fast bracket token construction preserves seeded complete streams, short-token identities, and no-bracket behavior', () => {
	let seed = 1031;
	let builds = 0;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const fragments = ['(', ')', '[', ']', '{', '}', 'begin ', 'repeat ', 'end ', '\n', '\r', 'x', '\t', ' ', '😀'];
	const module: IRustFastBracketTokenizerModule = { ...rust, build_fast_bracket_tokens: host => { builds++; return rust.build_fast_bracket_tokens(host); } };
	for (let trace = 0; trace < 1024; trace++) {
		const text = Array.from({ length: random(128) }, () => fragments[random(fragments.length)]).join('');
		for (const empty of [false, true]) {
			const run = () => snapshot(new FastTokenizer(text, brackets(empty)));
			assert.deepStrictEqual(withRust(run, module), run(), `Fast bracket tokenizer trace ${trace}/${empty}`);
		}
	}
	assert.strictEqual(builds, 2048, 'Every initial token stream is constructed in the integrated Rust core');
	for (const length of [0, 1, 59, 60, 61, 4096]) {
		const text = `(${'x'.repeat(length)})(${'x'.repeat(length)})\n(${'x'.repeat(length)})\n\n(${'x'.repeat(length)})`;
		const run = () => snapshot(new FastTokenizer(text, brackets()));
		assert.deepStrictEqual(withRust(run), run());
	}
	assert.strictEqual(withRust(() => new FastTokenizer('a\nb', brackets(true)).length), toLength(0, 3));
});

test('Rust fast bracket token construction preserves provider proxy/getter order and coercing source text', () => {
	const run = () => {
		const observations: string[] = [];
		const provider = new Proxy(brackets(), { get: (target, key, receiver) => { observations.push(`brackets:${String(key)}`); return Reflect.get(target, key, receiver); } });
		const text = {
			get length() { observations.push('text:length'); return 21; },
			[Symbol.toPrimitive]: (hint: string) => { observations.push(`text:${hint}`); return '(x)\n begin end repeat'; }
		};
		const tokenizer = new FastTokenizer(text as unknown as string, provider);
		const tokens = snapshot(tokenizer);
		return { tokens, observations, identity: tokenizer.getText() === text as unknown as string };
	};
	assert.deepStrictEqual(withRust(run), run());
});

test('Rust fast bracket token construction preserves provider failures without repeating matches or source reads', () => {
	const failure = new Error('Original initial bracket token provider failure');
	for (const failAt of [1, 2, 3]) {
		const run = () => {
			let calls = 0;
			const observations: string[] = [];
			const provider = brackets();
			const getToken = provider.getToken;
			Object.defineProperty(provider, 'getToken', {
				get: () => {
					observations.push('getToken');
					return (value: string) => { observations.push(value); if (++calls === failAt) { throw failure; } return Reflect.apply(getToken, provider, [value]); };
				}
			});
			assert.throws(() => new FastTokenizer('(x)[]', provider), error => error === failure);
			return { calls, observations };
		};
		assert.deepStrictEqual(withRust(run), run());
	}
});

test('Rust fast bracket token construction releases result references and rejects stale registrations atomically', () => {
	let frees = 0;
	const failure = new Error('Original initial token length result failure');
	const module: IRustFastBracketTokenizerModule = { ...rust, build_fast_bracket_tokens: () => ({ take: () => { throw failure; }, free: () => { frees++; } }) };
	withRust(() => assert.throws(() => new FastTokenizer('x', brackets()), error => error === failure), module);
	assert.strictEqual(frees, 1);
	assert.throws(() => registerRustTextBuffer({ ...rust, fast_bracket_tokenizer_abi_version: () => 0 }), /initial token stream contract/);
	assert.strictEqual(tryRustBracketLength(RustBracketLengthOperation.Pack, 1, 2), undefined);
	const registration = registerRustTextBuffer(rust);
	try { assert.throws(() => registerRustFastBracketTokenizer(rust), /already registered/); } finally { registration.dispose(); }
});

