/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { WordCharacterClassifier } from '../core/wordCharacterClassifier.js';
import { Position } from '../core/position.js';
import { Range } from '../core/range.js';
import { FindMatch, SearchData } from '../model.js';
import { ownRustBracketArray } from './bracketPairsTextModelPart/bracketPairsTree/rustBracketNumberArray.js';

/** Live regex/property capabilities retain exact callbacks, results, and partial state writes. */
export interface IRustTextSearchHost {
	textLength(): number;
	previousStart(): number;
	previousLength(): number;
	add(first: number, second: number): number;
	equal(first: number, second: number): boolean;
	exec(): RegExpExecArray | null;
	matchStart(match: RegExpExecArray): number;
	matchLength(match: RegExpExecArray): number;
	nextCodePoint(textLength: number): number;
	aboveBmp(value: number): boolean;
	advance(count: number): void;
	setPreviousStart(value: number): void;
	setPreviousLength(value: number): void;
	hasWords(): boolean;
	validMatch(textLength: number, start: number, length: number): boolean;
	resetRegex(): void;
}

/** Borrowed character/classifier operations preserve coercions and dynamic method receivers. */
export interface IRustWordBoundaryHost {
	add(first: number, second: number): number;
	subtract(first: number, second: number): number;
	equal(first: number, second: number): boolean;
	positive(value: number): boolean;
	charCode(index: number): number;
	classify(value: number): number;
}

/** Scoped result references distinguish unavailable control from original null/undefined returns. */
interface IRustTextSearchResult { take(): RegExpExecArray | null | undefined; free(): void }

/** Existing searcher methods keep their receivers and may enter other native search scopes. */
interface IRustSearchCursor {
	reset(lastIndex: number): void;
	next(text: string): RegExpExecArray | null;
}

/** Live line-search operations retain result-array aliases, regex methods, and factory ordering. */
export interface IRustLineMatchHost {
	add(first: number, second: number): number;
	negate(value: number): number;
	increment(value: number): [number, number];
	equal(first: number, second: number): boolean;
	atLeast(first: number, second: number): boolean;
	wordSeparators(): WordCharacterClassifier | null;
	captureMatches(): boolean;
	simpleSearch(): string | null;
	searchLength(value: string): number;
	textLength(): number;
	indexOf(search: string, index: number): number;
	validMatch(words: WordCharacterClassifier, textLength: number, start: number, length: number): boolean;
	writeLiteral(index: number, start: number, end: number): void;
	createSearcher(): IRustSearchCursor;
	reset(searcher: IRustSearchCursor): void;
	next(searcher: IRustSearchCursor): RegExpExecArray | null;
	matchStart(matched: RegExpExecArray): number;
	matchLength(matched: RegExpExecArray): number;
	writeRegex(index: number, start: number, end: number, matched: RegExpExecArray): void;
}

/** Borrowed UTF-16 scanning preserves cached length and ordered writes into the LF array. */
export interface IRustLineFeedScanHost {
	textLength(): number;
	below(index: number, length: number): boolean;
	charCode(index: number): number;
	write(index: number, offset: number): void;
}

/** Live offset arrays preserve property observations and target/element coercions. */
export interface IRustLineFeedQueryHost {
	length(): number;
	subtractOne(value: number): number;
	offset(index: number): number;
	atMost(first: number, second: number): boolean;
	atLeast(first: number, second: number): boolean;
}

/** Original LF counters and position/range providers remain caught model capabilities. */
export interface IRustMultilineMatchHost {
	add(first: number, second: number): number;
	subtract(first: number, second: number): number;
	hasCounter(): boolean;
	countBefore(index: number): number;
	matchLength(): number;
	position(offset: number): Position;
	range(start: Position, end: Position): Range;
}

/** Generated text-search control participates in the core's atomic registration lifetime. */
export const enum RustSearchNavigationOperation { FirstInLine = 0, LastInLine = 1, NextLines = 2, PreviousLines = 3 }

/** Original model/searcher providers and virtual first/last methods preserve exact receivers. */
export interface IRustSearchNavigationHost {
	add(first: number, second: number): number;
	subtract(first: number, second: number): number;
	remainder(first: number, second: number): number;
	atMost(first: number, second: number): boolean;
	lineCount(): number;
	startLine(): number;
	line(number: number): string;
	firstAtStart(text: string, line: number): FindMatch | null;
	first(text: string, line: number): FindMatch | null;
	prefixAtStart(text: string): string;
	last(text: string, line: number): FindMatch | null;
	resetFromColumn(): void;
	resetStart(): void;
	next(): RegExpExecArray | null;
	matchStart(matched: RegExpExecArray): number;
	matchLength(matched: RegExpExecArray): number;
	makeMatch(start: number, end: number, matched: RegExpExecArray): FindMatch;
}

/** Generated text-search control participates in the core's atomic registration lifetime. */
export const enum RustSearchCollectionOperation { LineRanges = 0, MultilineRange = 1 }

interface IRustMultilineSearchContext {
	deltaOffset: number;
	text: string;
	counter: { findLineFeedCountBeforeOffset(offset: number): number } | null;
}

/** Live range collectors retain slicing, virtual methods, scoped context, and result aliases. */
export interface IRustSearchCollectionHost {
	add(first: number, second: number): number;
	increment(value: number): number;
	equal(first: number, second: number): boolean;
	below(first: number, second: number): boolean;
	atLeast(first: number, second: number): boolean;
	createResult(): FindMatch[];
	startLine(): number;
	endLine(): number;
	singleLine(result: FindMatch[], count: number): number;
	firstLine(result: FindMatch[], count: number): number;
	middleLine(line: number, result: FindMatch[], count: number): number;
	lastLine(result: FindMatch[], count: number): number;
	prepareMultiline(): IRustMultilineSearchContext;
	resetMultiline(): void;
	nextMultiline(context: IRustMultilineSearchContext): RegExpExecArray | null;
	writeMultiline(context: IRustMultilineSearchContext, result: FindMatch[], index: number, matched: RegExpExecArray): void;
}

/** Generated text-search control participates in the core's atomic registration lifetime. */
export interface IRustRegexSourceHost {
	sourceTruthy(): boolean;
	length(): number;
	below(index: number, length: number): boolean;
	atEnd(index: number, length: number): boolean;
	charCode(index: number): number;
}

/** Array-like capture reads retain original slot values and the original FindMatch range. */
export interface IRustFindMatchHost {
	captures(): boolean;
	createValues(): string[];
	length(): number;
	below(index: number, length: number): boolean;
	read(index: number): string;
	write(values: string[], index: number, value: string): void;
	make(values: string[] | null): FindMatch;
}

/** Generated text-search control participates in the core's atomic registration lifetime. */
export interface IRustSearchRequestHost {
	searchString(): string;
	isRegex(): boolean;
	multilineRegex(source: string): boolean;
	newlineIndex(source: string): number;
	nonnegative(value: number): boolean;
	createRegex(multiline: boolean): RegExp | null;
	lowercase(source: string): string;
	uppercase(source: string): string;
	matchCase(): boolean;
	wordSeparators(): string | null;
	wordMap(words: string): WordCharacterClassifier;
	makeData(regex: RegExp, words: WordCharacterClassifier | null, simple: string | null): SearchData;
}

/** Generated text-search control participates in the core's atomic registration lifetime. */
export interface IRustTextSearchModule {
	text_search_abi_version(): number;
	run_text_search(host: IRustTextSearchHost, reset: boolean): IRustTextSearchResult;
	is_valid_text_search_match(host: IRustWordBoundaryHost, textLength: number, start: number, length: number): boolean;
	collect_text_search_matches(host: IRustLineMatchHost, count: number, delta: number, limit: number): number;
	scan_text_search_line_feeds(host: IRustLineFeedScanHost): void;
	count_text_search_line_feeds(host: IRustLineFeedQueryHost, target: number): number;
	text_search_multiline_range(host: IRustMultilineMatchHost, delta: number, index: number): Range;
	run_text_search_navigation(host: IRustSearchNavigationHost, operation: RustSearchNavigationOperation): FindMatch | null;
	collect_text_search_range(host: IRustSearchCollectionHost, operation: RustSearchCollectionOperation, limit: number): FindMatch[];
	is_text_search_multiline_source(host: IRustRegexSourceHost): boolean;
	create_text_search_match(host: IRustFindMatchHost): FindMatch;
	parse_text_search_request(host: IRustSearchRequestHost): SearchData | null;
}

let registeredModule: IRustTextSearchModule | undefined;

/** Installs text-search control without changing existing Searcher classes or regex objects. */
export function registerRustTextSearch(module: IRustTextSearchModule): IDisposable {
	if (typeof module.text_search_abi_version !== 'function' || module.text_search_abi_version() !== 8 || typeof module.run_text_search !== 'function' || typeof module.is_valid_text_search_match !== 'function' || typeof module.collect_text_search_matches !== 'function' || typeof module.scan_text_search_line_feeds !== 'function' || typeof module.count_text_search_line_feeds !== 'function' || typeof module.text_search_multiline_range !== 'function' || typeof module.run_text_search_navigation !== 'function' || typeof module.collect_text_search_range !== 'function' || typeof module.is_text_search_multiline_source !== 'function' || typeof module.create_text_search_match !== 'function' || typeof module.parse_text_search_request !== 'function') { throw new Error('The Rust text search bindings do not match the searcher control contract'); }
	if (registeredModule) { throw new Error('A Rust text search module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Executes once and releases the scoped result on both successful and failed consumption. */
export function tryRunRustTextSearch(reset: boolean, createHost: () => IRustTextSearchHost): { match: RegExpExecArray | null | undefined } | undefined {
	if (!registeredModule) { return undefined; }
	const result = registeredModule.run_text_search(createHost(), reset);
	if (!result || typeof result.take !== 'function' || typeof result.free !== 'function') { throw new Error('The Rust text search result does not match the searcher control contract'); }
	try { return { match: result.take() }; } finally { result.free(); }
}

/** Uses native boundary control with the original borrowed text and classifier capabilities. */
export function tryRustWordBoundary(textLength: number, start: number, length: number, createHost: () => IRustWordBoundaryHost): boolean | undefined {
	return registeredModule?.is_valid_text_search_match(createHost(), textLength, start, length);
}

/** Collects into the original result array, including original partial writes on failure. */
export function tryRustLineMatches(count: number, delta: number, limit: number, createHost: () => IRustLineMatchHost): { count: number } | undefined {
	if (!registeredModule) { return undefined; }
	return { count: registeredModule.collect_text_search_matches(createHost(), count, delta, limit) };
}

/** Reuses the core's generic owning array facade before an LF index escapes its constructor. */
export function createRustSearchOffsets(): number[] {
	return ownRustBracketArray<number>([]);
}

/** Scans cached-length UTF-16 text into the original LF-offset array. */
export function tryRustLineFeedScan(createHost: () => IRustLineFeedScanHost): boolean {
	if (!registeredModule) { return false; }
	registeredModule.scan_text_search_line_feeds(createHost());
	return true;
}

/** Counts LFs strictly before the requested offset through live array observations. */
export function tryRustLineFeedCount(target: number, createHost: () => IRustLineFeedQueryHost): number | undefined {
	return registeredModule?.count_text_search_line_feeds(createHost(), target);
}

/** Compensates CRLF offsets and retains the model's original range object and exceptions. */
export function tryRustMultilineMatchRange(delta: number, index: number, createHost: () => IRustMultilineMatchHost): { range: Range } | undefined {
	if (!registeredModule) { return undefined; }
	return { range: registeredModule.text_search_multiline_range(createHost(), delta, index) };
}

/** Runs wrapped line navigation or first/last match selection through the existing model. */
export function tryRustSearchNavigation(operation: RustSearchNavigationOperation, createHost: () => IRustSearchNavigationHost): { match: FindMatch | null } | undefined {
	if (!registeredModule) { return undefined; }
	return { match: registeredModule.run_text_search_navigation(createHost(), operation) };
}

/** Collects a model range without replacing the original result array or overridable methods. */
export function tryRustSearchCollection(operation: RustSearchCollectionOperation, limit: number, createHost: () => IRustSearchCollectionHost): FindMatch[] | undefined {
	return registeredModule?.collect_text_search_range(createHost(), operation, limit);
}

/** Scans borrowed search syntax with original strict character and numeric-domain behavior. */
export function tryRustRegexSource(createHost: () => IRustRegexSourceHost): boolean | undefined {
	return registeredModule?.is_text_search_multiline_source(createHost());
}

/** Copies array-like capture slots through their original providers and preserves range identity. */
export function tryRustFindMatch(createHost: () => IRustFindMatchHost): FindMatch | undefined {
	return registeredModule?.create_text_search_match(createHost());
}

/** Parses live request properties while preserving the original regex-construction catch scope. */
export function tryRustSearchRequest(createHost: () => IRustSearchRequestHost): { data: SearchData | null } | undefined {
	if (!registeredModule) { return undefined; }
	return { data: registeredModule.parse_text_search_request(createHost()) };
}
