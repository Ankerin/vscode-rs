/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import type { IViewLineTokens } from '../../../tokens/lineTokens.js';
import type { BracketTokens } from './brackets.js';
import type { Length } from './length.js';
import type { Token } from './tokenizer.js';

/** The peekable wrapper retains its cached references and original offset/position operations. */
export interface IRustPeekableBracketTokenizerHost {
	peeked(): Token | null;
	truthy(token: Token | null): boolean;
	didPeek(): boolean;
	setDidPeek(value: boolean): void;
	setPeeked(token: Token | null): void;
	read(): Token | null;
	advanceToken(token: Token): void;
	advanceLength(length: Length): void;
	updatePosition(): void;
}

/** Caught line-provider capabilities preserve ordered metadata, matching, and live cursor access. */
export interface IRustBracketTokenizerHost {
	add(first: number, second: number): number;
	subtract(first: number, second: number): number;
	greater(first: number, second: number): boolean;
	truthy(value: Token | RegExp | RegExpExecArray | null | undefined): boolean;
	peeked(): Token | null;
	setPeeked(token: Token | null): void;
	consume(token: Token): void;
	atEnd(): boolean;
	lineMissing(): boolean;
	loadTokens(): void;
	loadLine(): void;
	selectIndex(): void;
	lineIndex(): number;
	column(): number;
	tokens(): IViewLineTokens;
	count(tokens: IViewLineTokens): number;
	hasToken(count: number): boolean;
	metadata(tokens: IViewLineTokens): number;
	identical(tokens: IViewLineTokens, count: number, metadata: number): boolean;
	incrementIndex(): void;
	isOther(metadata: number): boolean;
	containsBrackets(metadata: number): boolean;
	endOffset(tokens: IViewLineTokens): number;
	beforeEnd(end: number): boolean;
	language(tokens: IViewLineTokens): string;
	text(end: number): string;
	brackets(language: string): BracketTokens;
	regexp(brackets: BracketTokens): RegExp | null;
	resetRegexp(regexp: RegExp): void;
	exec(regexp: RegExp, text: string): RegExpExecArray | null;
	matchedToken(brackets: BracketTokens, matched: RegExpExecArray): Token | undefined;
	consumeMatch(matched: RegExpExecArray): void;
	changed(line: number, column: number): boolean;
	setColumn(column: number): void;
	lastLine(): boolean;
	incrementLine(): void;
	zeroIndex(): void;
	finishText(line: number, column: number): Token;
	sameLine(line: number): boolean;
	setLine(line: number): void;
	clearLine(): void;
}

/** Scoped references distinguish completed null tokens from an unavailable native implementation. */
interface IRustBracketTokenResult {
	take(): Token | null;
	free(): void;
}

/** Generated line scanning, cached reads, and cursor-position contracts. */
export interface IRustBracketTokenizerModule {
	bracket_tokenizer_abi_version(): number;
	read_bracket_token(host: IRustBracketTokenizerHost): IRustBracketTokenResult;
	set_bracket_token_position(host: IRustBracketTokenizerHost, line: number, column: number): boolean;
	read_peekable_bracket_token(host: IRustPeekableBracketTokenizerHost): IRustBracketTokenResult;
	peek_bracket_token(host: IRustPeekableBracketTokenizerHost): IRustBracketTokenResult;
	skip_bracket_tokens(host: IRustPeekableBracketTokenizerHost, length: Length): boolean;
}

let registeredModule: IRustBracketTokenizerModule | undefined;

/** Installs tokenizer orchestration for the initialized core's atomic disposable lifetime. */
export function registerRustBracketTokenizer(module: IRustBracketTokenizerModule): IDisposable {
	if (typeof module.bracket_tokenizer_abi_version !== 'function' || module.bracket_tokenizer_abi_version() !== 1 || typeof module.read_bracket_token !== 'function' || typeof module.set_bracket_token_position !== 'function' || typeof module.read_peekable_bracket_token !== 'function' || typeof module.peek_bracket_token !== 'function' || typeof module.skip_bracket_tokens !== 'function') { throw new Error('The Rust bracket tokenizer bindings do not match the line reader contract'); }
	if (registeredModule) { throw new Error('A Rust bracket tokenizer module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Reads complete line-aware tokens without replaying source reads or partial cursor mutations. */
export function tryReadRustBracketToken(createHost: () => IRustBracketTokenizerHost): { token: Token | null } | undefined {
	if (!registeredModule) { return undefined; }
	return { token: takeResult(registeredModule.read_bracket_token(createHost())) };
}

/** Positions retain the reader's original same-line and cross-line state transitions. */
export function trySetRustBracketTokenPosition(line: number, column: number, createHost: () => IRustBracketTokenizerHost): boolean {
	if (!registeredModule) { return false; }
	if (registeredModule.set_bracket_token_position(createHost(), line, column) !== true) { throw new Error('The Rust bracket tokenizer position result does not match the line reader contract'); }
	return true;
}

/** Delegates peekable reads beneath the original public read/peek methods. */
export function tryReadRustPeekableBracketToken(peek: boolean, createHost: () => IRustPeekableBracketTokenizerHost): { token: Token | null } | undefined {
	if (!registeredModule) { return undefined; }
	const result = peek ? registeredModule.peek_bracket_token(createHost()) : registeredModule.read_peekable_bracket_token(createHost());
	return { token: takeResult(result) };
}

/** Preserves skip invalidation, offset arithmetic, and positioning failure order. */
export function trySkipRustBracketTokens(length: Length, createHost: () => IRustPeekableBracketTokenizerHost): boolean {
	if (!registeredModule) { return false; }
	if (registeredModule.skip_bracket_tokens(createHost(), length) !== true) { throw new Error('The Rust bracket tokenizer skip result does not match the line reader contract'); }
	return true;
}

/** Consumes and frees every token reference, including failed consumption. */
function takeResult(result: IRustBracketTokenResult): Token | null {
	if (!result || typeof result.take !== 'function' || typeof result.free !== 'function') { throw new Error('The Rust bracket token result does not match the line reader contract'); }
	try { return result.take(); } finally { result.free(); }
}

