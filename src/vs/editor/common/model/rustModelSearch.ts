/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import type { IPosition, Position } from '../core/position.js';
import type { IRange, Range } from '../core/range.js';
import type { FindMatch, SearchData } from '../model.js';

/** Public model searches share the registered core lifetime. */
export const enum RustModelSearchOperation { Matches = 0, Next = 1, Previous = 2 }

/** Original scope inputs remain borrowed, including caller-owned arrays. */
export type RustModelSearchInput = boolean | IRange | IRange[] | IPosition | null;

/** Array species, callbacks, aliases, and product factories retain ECMAScript ownership. */
export interface IRustModelSearchHost {
	assertAlive(): void;
	singleton(value: IRange): IRange[];
	everyRange(value: IRange[]): boolean;
	validateRanges(value: IRange[]): Range[];
	fullRange(): Range;
	sort(value: Range[]): Range[];
	unique(value: Range[]): Range[];
	isRegex(): boolean;
	noNewline(): boolean;
	parse(): SearchData | null;
	empty(): FindMatch[];
	mapMatches(ranges: Range[], data: SearchData, literal: boolean): FindMatch[][];
	flatten(matches: FindMatch[][]): FindMatch[];
	validateStart(value: IPosition): Position;
	coordinate(value: IRange | IPosition, index: number): number;
	subtract(first: number, second: number): number;
	intersects(first: Range, second: Range): boolean;
	plus(first: Range, second: Range): Range;
	push(array: Range[], value: Range): void;
	lineCount(): number;
	maxColumn(line: number): number;
	maxStartColumn(start: IPosition): number;
	range(startLine: number, startColumn: number, endLine: number, endColumn: number): Range;
	lineMatches(range: Range, data: SearchData): FindMatch[];
	navigate(start: Position, previous: boolean): FindMatch | null;
	hasMatches(matches: FindMatch[]): boolean;
	firstMatch(matches: FindMatch[]): FindMatch;
}

/** Generated search control also serves synchronous array comparison/reduction callbacks. */
export interface IRustModelSearchModule {
	model_search_abi_version(): number;
	run_model_search(host: IRustModelSearchHost, operation: RustModelSearchOperation, input: RustModelSearchInput): FindMatch[] | FindMatch | null;
	compare_model_search_ranges(host: IRustModelSearchHost, first: Range, second: Range): number;
	merge_model_search_ranges(host: IRustModelSearchHost, unique: Range[], previous: Range, current: Range): Range;
}

let registeredModule: IRustModelSearchModule | undefined;

/** Rejects stale or partial bindings before installing the public model search boundary. */
export function registerRustModelSearch(module: IRustModelSearchModule): IDisposable {
	if (typeof module.model_search_abi_version !== 'function' || module.model_search_abi_version() !== 1 || typeof module.run_model_search !== 'function' || typeof module.compare_model_search_ranges !== 'function' || typeof module.merge_model_search_ranges !== 'function') { throw new Error('The Rust model search bindings do not match the scope contract'); }
	if (registeredModule) { throw new Error('A Rust model search module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Keeps an original null result distinct from unavailable native control. */
export function tryRustModelSearch<T extends FindMatch[] | FindMatch | null>(operation: RustModelSearchOperation, input: RustModelSearchInput, createHost: (module: IRustModelSearchModule) => IRustModelSearchHost): { value: T } | undefined {
	if (!registeredModule) { return undefined; }
	return { value: registeredModule.run_model_search(createHost(registeredModule), operation, input) as T };
}
