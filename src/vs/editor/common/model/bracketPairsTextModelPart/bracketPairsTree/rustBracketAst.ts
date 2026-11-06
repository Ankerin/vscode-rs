/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import type { AstNode } from './ast.js';
import type { Length } from './length.js';
import type { SmallImmutableSet } from './smallImmutableSet.js';
import type { OpeningBracketId } from './tokenizer.js';

/** Original AST algorithms retain their node-specific virtual dispatch boundaries. */
export const enum RustBracketAstOperation { CreatePair, CreateCompactList, CreateArrayList, UpdateChildren, ReusePair, ReuseList, ReuseInvalid, ReuseText, ReuseBracket, MakeLastMutable, MakeFirstMutable }

/** Native child selection retains the original node-specific property and array protocols. */
export const enum RustBracketChildOperation { CompactCount, ReadChild, WriteChild, PairChildren, CompactChildren }

type BracketAstResult = AstNode | boolean | undefined;
type BracketChildResult = AstNode | readonly AstNode[] | number | null | undefined;

/** Only the capabilities used by the selected child operation are supplied. */
export interface IRustBracketChildHost {
	item(index: number): AstNode | null;
	isIndex?(index: number): boolean;
	invalidIndex?(): never;
	setItem?(index: number): void;
	createArray?(): AstNode[];
	pushItem?(array: AstNode[], index: number): void;
	array2?(first: AstNode, second: AstNode): readonly AstNode[];
	array3?(first: AstNode, second: AstNode, third: AstNode | null): readonly AstNode[];
}

/** Live node/set/factory capabilities preserve reference identity and ordered partial writes. */
export interface IRustBracketAstHost {
	receiver(): AstNode;
	item(index: number): AstNode | null;
	truthy(value: AstNode | null): boolean;
	length(node: AstNode): Length;
	missing(node: AstNode): SmallImmutableSet<OpeningBracketId>;
	emptyIds(): SmallImmutableSet<OpeningBracketId>;
	addLength(length: Length, node: AstNode): Length;
	mergeIds(ids: SmallImmutableSet<OpeningBracketId>, node: AstNode): SmallImmutableSet<OpeningBracketId>;
	mergeItem(ids: SmallImmutableSet<OpeningBracketId>, index: number): SmallImmutableSet<OpeningBracketId>;
	equalHeights(first: AstNode, second: AstNode): boolean;
	invalidHeights(): never;
	createPair(length: Length, ids: SmallImmutableSet<OpeningBracketId>): AstNode;
	createList(length: Length, ids: SmallImmutableSet<OpeningBracketId>, compact: boolean): AstNode;
	itemCount(): number;
	isZero(value: number): boolean;
	indexBefore(index: number, count: number): boolean;
	emptyList(): AstNode;
	throwIfImmutable(): void;
	childCount(node: AstNode): number;
	child(node: AstNode, index: number): AstNode | null;
	setLength(value: Length): void;
	setMissing(value: SmallImmutableSet<OpeningBracketId>): void;
	resetIndentation(): void;
	closingMissing(): boolean;
	intersectsNode(node: AstNode): boolean;
	isList(node: AstNode): boolean;
	invalidEmptyChild(): never;
	edgeChild(node: AstNode, count: number, last: boolean): AstNode;
	reuseLeaf(node: AstNode): boolean;
	toMutable(node: AstNode): AstNode;
	same(first: AstNode, second: AstNode): boolean;
	setEdge(count: number, child: AstNode, last: boolean): void;
}

/** Scoped references distinguish original undefined returns from unavailable implementations. */
interface IRustBracketAstResult { take(): BracketAstResult; free(): void }
interface IRustBracketChildResult { take(): BracketChildResult; free(): void }

/** Generated bracket AST algorithm contract. */
export interface IRustBracketAstModule {
	bracket_ast_abi_version(): number;
	run_bracket_ast(host: IRustBracketAstHost, operation: RustBracketAstOperation): IRustBracketAstResult;
	run_bracket_child_access(host: IRustBracketChildHost, operation: RustBracketChildOperation): IRustBracketChildResult;
}

let registeredModule: IRustBracketAstModule | undefined;

/** Installs AST algorithms for the initialized core's atomic disposable lifetime. */
export function registerRustBracketAst(module: IRustBracketAstModule): IDisposable {
	if (typeof module.bracket_ast_abi_version !== 'function' || module.bracket_ast_abi_version() !== 2 || typeof module.run_bracket_ast !== 'function' || typeof module.run_bracket_child_access !== 'function') { throw new Error('The Rust bracket AST bindings do not match the AST algorithm contract'); }
	if (registeredModule) { throw new Error('A Rust bracket AST module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Executes once without replaying factory/provider reads, mutations, or partial failures. */
export function tryRunRustBracketAst(operation: RustBracketAstOperation, createHost: () => IRustBracketAstHost): { value: BracketAstResult } | undefined {
	if (!registeredModule) { return undefined; }
	const result = registeredModule.run_bracket_ast(createHost(), operation);
	if (!result || typeof result.take !== 'function' || typeof result.free !== 'function') { throw new Error('The Rust bracket AST result does not match the AST algorithm contract'); }
	try { return { value: result.take() }; } finally { result.free(); }
}

/** Runs child access once and releases the scoped result even when consumption fails. */
export function tryAccessRustBracketChild(operation: RustBracketChildOperation, createHost: () => IRustBracketChildHost): { value: BracketChildResult } | undefined {
	if (!registeredModule) { return undefined; }
	const result = registeredModule.run_bracket_child_access(createHost(), operation);
	if (!result || typeof result.take !== 'function' || typeof result.free !== 'function') { throw new Error('The Rust bracket child result does not match the AST algorithm contract'); }
	try { return { value: result.take() }; } finally { result.free(); }
}
