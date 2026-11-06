/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import type { AstNode, BracketAstNode, PairAstNode } from './ast.js';
import type { Length } from './length.js';
import type { SmallImmutableSet } from './smallImmutableSet.js';
import type { OpeningBracketId } from './tokenizer.js';

/** Node-specific transforms retain the original public method boundaries. */
export const enum RustBracketTransformOperation { FlattenPair, ClonePair, CloneCompactList, CloneArrayList, FlattenList, MutableCompactList, MutableArrayList, Identity }

/** Original factories, field reads, and iterables retain node identities and exception precedence. */
export interface IRustBracketTransformHost {
	receiver(): AstNode;
	length(): Length;
	height(): number;
	missing(): SmallImmutableSet<OpeningBracketId>;
	pairFactory(): typeof PairAstNode.create;
	pairOpening(clone: boolean): BracketAstNode;
	pairChild(clone: boolean): AstNode | null;
	pairClosing(clone: boolean): BracketAstNode | null;
	createPair(factory: typeof PairAstNode.create, opening: BracketAstNode, child: AstNode | null, closing: BracketAstNode | null): PairAstNode;
	clonePair(length: Length, opening: BracketAstNode, child: AstNode | null, closing: BracketAstNode | null, missing: SmallImmutableSet<OpeningBracketId>): PairAstNode;
	compactItem(index: number, clone: boolean): AstNode | null;
	createCompact(length: Length, height: number, first: AstNode, second: AstNode, third: AstNode | null, missing: SmallImmutableSet<OpeningBracketId>): AstNode;
	cloneArray(): AstNode[];
	indexBeforeCount(index: number): boolean;
	cloneInto(output: AstNode[], index: number): void;
	spreadChildren(): AstNode[];
	createArray(length: Length, height: number, children: AstNode[], missing: SmallImmutableSet<OpeningBracketId>): AstNode;
	emptyItems(): AstNode[];
	iterator(): Generator<AstNode, void, void>;
	next(iterator: Generator<AstNode, void, void>): IteratorResult<AstNode, void>;
	done(step: IteratorResult<AstNode, void>): boolean;
	stepValue(step: IteratorYieldResult<AstNode>): AstNode;
	close(iterator: Generator<AstNode, void, void>): void;
	flattenChild(child: AstNode): AstNode;
	isList(child: AstNode): boolean;
	pushFlattened(items: AstNode[], child: AstNode, expand: boolean): void;
	createFlattened(items: AstNode[]): AstNode;
}

interface IRustBracketTransformResult { take(): AstNode; free(): void }

/** Generated AST transform contract. */
export interface IRustBracketTransformModule {
	bracket_transform_abi_version(): number;
	transform_bracket_ast(host: IRustBracketTransformHost, operation: RustBracketTransformOperation): IRustBracketTransformResult;
}

let registeredModule: IRustBracketTransformModule | undefined;

/** Installs transforms for the initialized core's atomic disposable lifetime. */
export function registerRustBracketTransform(module: IRustBracketTransformModule): IDisposable {
	if (typeof module.bracket_transform_abi_version !== 'function' || module.bracket_transform_abi_version() !== 1 || typeof module.transform_bracket_ast !== 'function') { throw new Error('The Rust bracket transform bindings do not match the AST transform contract'); }
	if (registeredModule) { throw new Error('A Rust bracket transform module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Transforms once without replaying factory reads, child callbacks, or iterator failures. */
export function tryTransformRustBracketAst(operation: RustBracketTransformOperation, createHost: () => IRustBracketTransformHost): { value: AstNode } | undefined {
	if (!registeredModule) { return undefined; }
	const result = registeredModule.transform_bracket_ast(createHost(), operation);
	if (!result || typeof result.take !== 'function' || typeof result.free !== 'function') { throw new Error('The Rust bracket transform result does not match the AST transform contract'); }
	try { return { value: result.take() }; } finally { result.free(); }
}
