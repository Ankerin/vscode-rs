/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import type { IFoundBracket } from '../../../textModelBracketPairs.js';
import type { AstNode } from './ast.js';
import type { Length } from './length.js';
import type { SmallImmutableSet } from './smallImmutableSet.js';
import type { OpeningBracketId } from './tokenizer.js';

/** Original temporary array entries preserve observable slot reads and overridden array methods. */
export interface IBracketSearchLengthEntry { nodeOffsetStart: Length; nodeOffsetEnd: Length }
export interface IBracketSearchNodeEntry { node: AstNode; offset: Length }

/** Live search capabilities preserve original AST providers, iterators, and array identities. */
export interface IRustBracketSearchHost {
	truthy(value: IFoundBracket | null): boolean;
	container(node: AstNode): boolean;
	unexpected(node: AstNode): boolean;
	bracket(node: AstNode): boolean;
	found(node: AstNode, start: Length, end: Length): IFoundBracket;
	iterator(node: AstNode): Generator<AstNode, void, void>;
	next(iterator: Generator<AstNode, void, void>): IteratorResult<AstNode, void>;
	done(step: IteratorResult<AstNode, void>): boolean;
	stepValue(step: IteratorYieldResult<AstNode>): AstNode;
	close(iterator: Generator<AstNode, void, void>): void;
	end(start: Length, node: AstNode): Length;
	beforePosition(offset: Length): boolean;
	positionBefore(offset: Length): boolean;
	find(node: AstNode, start: Length, end: Length, before: boolean): IFoundBracket | null;
	lengths(): IBracketSearchLengthEntry[];
	pushLength(lengths: IBracketSearchLengthEntry[], start: Length, end: Length): void;
	lastIndex(lengths: IBracketSearchLengthEntry[]): number;
	validIndex(index: number): boolean;
	lengthEntry(lengths: IBracketSearchLengthEntry[], index: number): IBracketSearchLengthEntry;
	entryStart(entry: IBracketSearchLengthEntry): Length;
	entryEnd(entry: IBracketSearchLengthEntry): Length;
	indexedChild(node: AstNode, index: number): AstNode;
	decrement(index: number): number;
	openingIds(): SmallImmutableSet<OpeningBracketId>;
	intersects(node: AstNode, ids: SmallImmutableSet<OpeningBracketId>): boolean;
	stack(root: AstNode): IBracketSearchNodeEntry[];
	hasStack(stack: IBracketSearchNodeEntry[]): boolean;
	pop(stack: IBracketSearchNodeEntry[]): IBracketSearchNodeEntry;
	entryNode(entry: IBracketSearchNodeEntry): AstNode;
	entryOffset(entry: IBracketSearchNodeEntry): Length;
	afterPosition(offset: Length): boolean;
	pushNode(stack: IBracketSearchNodeEntry[], node: AstNode, offset: Length): void;
}

/** Scoped results distinguish an ordinary null search result from unavailable bindings. */
interface IRustBracketSearchResult { take(): IFoundBracket | null; free(): void }

/** Generated nearest and unmatched bracket search contract. */
export interface IRustBracketSearchModule {
	bracket_search_abi_version(): number;
	find_bracket(host: IRustBracketSearchHost, node: AstNode, start: Length, end: Length, before: boolean): IRustBracketSearchResult;
	has_unmatched_bracket(host: IRustBracketSearchHost, root: AstNode): boolean;
}

let registeredModule: IRustBracketSearchModule | undefined;

/** Installs search traversal for the initialized core's atomic disposable lifetime. */
export function registerRustBracketSearch(module: IRustBracketSearchModule): IDisposable {
	if (typeof module.bracket_search_abi_version !== 'function' || module.bracket_search_abi_version() !== 1 || typeof module.find_bracket !== 'function' || typeof module.has_unmatched_bracket !== 'function') { throw new Error('The Rust bracket search bindings do not match the bracket search contract'); }
	if (registeredModule) { throw new Error('A Rust bracket search module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Finds once without replaying providers or a partially completed iterable. */
export function tryFindRustBracket(node: AstNode, start: Length, end: Length, before: boolean, createHost: () => IRustBracketSearchHost): { bracket: IFoundBracket | null } | undefined {
	if (!registeredModule) { return undefined; }
	const result = registeredModule.find_bracket(createHost(), node, start, end, before);
	if (!result || typeof result.take !== 'function' || typeof result.free !== 'function') { throw new Error('The Rust bracket search result does not match the bracket search contract'); }
	try { return { bracket: result.take() }; } finally { result.free(); }
}

/** Finds unmatched closers without replaying stack changes or provider failures. */
export function tryHasUnmatchedRustBracket(root: AstNode, createHost: () => IRustBracketSearchHost): boolean | undefined {
	if (!registeredModule) { return undefined; }
	return registeredModule.has_unmatched_bracket(createHost(), root);
}
