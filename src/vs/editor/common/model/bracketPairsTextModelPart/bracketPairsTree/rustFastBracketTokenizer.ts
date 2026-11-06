/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import type { Length } from './length.js';
import type { Token } from './tokenizer.js';

/** Caught construction capabilities preserve original array/provider/factory evaluation order. */
export interface IRustFastBracketTokenizerHost {
	add(first: number, second: number): number;
	subtract(first: number, second: number): number;
	equal(first: number, second: number): boolean;
	cache(): Token[];
	populate(cache: Token[], line: number, column: number): void;
	hasRegexp(): boolean;
	resetRegexp(): void;
	nextMatch(): RegExpExecArray | null;
	matchIsNull(matched: RegExpExecArray | null): boolean;
	matchIndex(matched: RegExpExecArray): number;
	matchValue(matched: RegExpExecArray): string;
	lineBreak(value: string): boolean;
	afterBreak(index: number): number;
	shortCache(cache: Token[], column: number): boolean;
	cachedToken(cache: Token[], column: number): Token;
	textToken(line: number, column: number): Token;
	pushToken(token: Token): void;
	pushBracket(value: string): void;
	valueLength(value: string): number;
	textLength(): number;
	length(line: number, column: number): Length;
	pushText(length: Length): void;
}

/** A scoped length result prevents fallback after any token/cache/provider mutation. */
interface IRustFastBracketTokenizerResult {
	take(): Length;
	free(): void;
}

/** Generated initial token-stream construction contract. */
export interface IRustFastBracketTokenizerModule {
	fast_bracket_tokenizer_abi_version(): number;
	build_fast_bracket_tokens(host: IRustFastBracketTokenizerHost): IRustFastBracketTokenizerResult;
}

let registeredModule: IRustFastBracketTokenizerModule | undefined;

/** Installs initial token construction for the initialized core's atomic disposable lifetime. */
export function registerRustFastBracketTokenizer(module: IRustFastBracketTokenizerModule): IDisposable {
	if (typeof module.fast_bracket_tokenizer_abi_version !== 'function' || module.fast_bracket_tokenizer_abi_version() !== 1 || typeof module.build_fast_bracket_tokens !== 'function') { throw new Error('The Rust fast bracket tokenizer bindings do not match the initial token stream contract'); }
	if (registeredModule) { throw new Error('A Rust fast bracket tokenizer module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Populates the original token array without replaying matches, factories, or array mutations. */
export function tryBuildRustFastBracketTokens(createHost: () => IRustFastBracketTokenizerHost): { length: Length } | undefined {
	if (!registeredModule) { return undefined; }
	const result = registeredModule.build_fast_bracket_tokens(createHost());
	if (!result || typeof result.take !== 'function' || typeof result.free !== 'function') { throw new Error('The Rust fast bracket tokenizer result does not match the initial token stream contract'); }
	try { return { length: result.take() }; } finally { result.free(); }
}

