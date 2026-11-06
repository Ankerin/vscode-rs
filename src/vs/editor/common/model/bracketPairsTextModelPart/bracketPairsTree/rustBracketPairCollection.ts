/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import type { AstNode } from './ast.js';
import type { Length } from './length.js';

/** Live pair query capabilities preserve providers, map state, and iterable completion. */
export interface IRustBracketPairCollectionHost {
	truthy(value: boolean): boolean;
	isPair(node: AstNode): boolean;
	hasLevels(): boolean;
	getLevel(node: AstNode): number | undefined;
	isUndefined(value: number | undefined): boolean;
	increment(value: number): number;
	setLevel(node: AstNode, value: number): void;
	restoreLevel(node: AstNode, value: number): void;
	openingEnd(node: AstNode, start: Length): Length;
	includeIndentation(): boolean;
	indentation(node: AstNode, start: Length): number;
	emitPair(node: AstNode, start: Length, end: Length, opening: Length, level: number, equalLevel: number, indentation: number): boolean;
	hasChild(node: AstNode): boolean;
	child(node: AstNode): AstNode;
	end(start: Length, child: AstNode): Length;
	inPairRange(start: Length, end: Length): boolean;
	inListRange(start: Length, end: Length): boolean;
	collect(node: AstNode, start: Length, end: Length, level: number): boolean;
	iterator(node: AstNode): Generator<AstNode, void, void>;
	next(iterator: Generator<AstNode, void, void>): IteratorResult<AstNode, void>;
	done(step: IteratorResult<AstNode, void>): boolean;
	stepValue(step: IteratorYieldResult<AstNode>): AstNode;
	close(iterator: Generator<AstNode, void, void>): void;
}

/** Scoped results distinguish unavailable bindings from original falsy callback values. */
interface IRustBracketPairCollectionResult {
	take(): boolean;
	free(): void;
}

/** Generated pair range traversal contract. */
export interface IRustBracketPairCollectionModule {
	bracket_pair_collection_abi_version(): number;
	collect_bracket_pairs(host: IRustBracketPairCollectionHost, node: AstNode, start: Length, end: Length, level: number): IRustBracketPairCollectionResult;
}

let registeredModule: IRustBracketPairCollectionModule | undefined;

/** Installs pair range traversal for the initialized core's atomic disposable lifetime. */
export function registerRustBracketPairCollection(module: IRustBracketPairCollectionModule): IDisposable {
	if (typeof module.bracket_pair_collection_abi_version !== 'function' || module.bracket_pair_collection_abi_version() !== 1 || typeof module.collect_bracket_pairs !== 'function') { throw new Error('The Rust bracket pair collection bindings do not match the pair range contract'); }
	if (registeredModule) { throw new Error('A Rust bracket pair collection module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Traverses once without replaying callbacks, map mutations, or failed iterable completions. */
export function tryCollectRustBracketPairs(node: AstNode, start: Length, end: Length, level: number, createHost: () => IRustBracketPairCollectionHost): { continued: boolean } | undefined {
	if (!registeredModule) { return undefined; }
	const result = registeredModule.collect_bracket_pairs(createHost(), node, start, end, level);
	if (!result || typeof result.take !== 'function' || typeof result.free !== 'function') { throw new Error('The Rust bracket pair collection result does not match the pair range contract'); }
	try { return { continued: result.take() }; } finally { result.free(); }
}
