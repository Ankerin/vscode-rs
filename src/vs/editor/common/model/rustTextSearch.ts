/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';

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

/** Scoped result references distinguish unavailable control from original null/undefined returns. */
interface IRustTextSearchResult { take(): RegExpExecArray | null | undefined; free(): void }

/** Generated text-search control participates in the core's atomic registration lifetime. */
export interface IRustTextSearchModule {
	text_search_abi_version(): number;
	run_text_search(host: IRustTextSearchHost, reset: boolean): IRustTextSearchResult;
}

let registeredModule: IRustTextSearchModule | undefined;

/** Installs text-search control without changing existing Searcher classes or regex objects. */
export function registerRustTextSearch(module: IRustTextSearchModule): IDisposable {
	if (typeof module.text_search_abi_version !== 'function' || module.text_search_abi_version() !== 1 || typeof module.run_text_search !== 'function') { throw new Error('The Rust text search bindings do not match the searcher control contract'); }
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
