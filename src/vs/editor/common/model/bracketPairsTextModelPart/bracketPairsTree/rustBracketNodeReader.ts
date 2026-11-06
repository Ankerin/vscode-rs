/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import type { AstNode } from './ast.js';
import type { Length } from './length.js';

/** Reader capabilities preserve actual state and the original ordered array/node/provider operations. */
export interface IRustBracketNodeReaderHost {
	currentNode(): AstNode | undefined;
	currentOffset(): Length | undefined;
	truthy(node: AstNode | undefined): boolean;
	offsetBefore(first: Length, second: Length): boolean;
	endBefore(node: AstNode, current: Length, requested: Length): boolean;
	predicate(node: AstNode): boolean;
	advance(): void;
	incrementIndex(index?: number): number;
	indexAtEnd(node: AstNode, index: number): boolean;
	childExists(node: AstNode, index: number): boolean;
	missingIndex(index: number): boolean;
	descend(node: AstNode, offset: Length, index: number): void;
	popCurrent(): void;
	noParents(): boolean;
	lastChildIndex(): number;
	moveToChild(parent: AstNode, current: AstNode, offset: Length, index: number): void;
	popParent(): void;
}

/** Scoped result ownership preserves undefined lookup results without falling back after mutation. */
interface IRustBracketNodeResult {
	take(): AstNode | undefined;
	free(): void;
}

/** Generated longest-node lookup and reader-stack advancement contracts. */
export interface IRustBracketNodeReaderModule {
	bracket_node_reader_abi_version(): number;
	read_longest_bracket_node(host: IRustBracketNodeReaderHost, offset: Length): IRustBracketNodeResult;
	advance_bracket_node(host: IRustBracketNodeReaderHost): boolean;
}

let registeredModule: IRustBracketNodeReaderModule | undefined;

/** Installs cache reading for the initialized core's atomic disposable lifetime. */
export function registerRustBracketNodeReader(module: IRustBracketNodeReaderModule): IDisposable {
	if (typeof module.bracket_node_reader_abi_version !== 'function' || module.bracket_node_reader_abi_version() !== 1 || typeof module.read_longest_bracket_node !== 'function' || typeof module.advance_bracket_node !== 'function') { throw new Error('The Rust bracket node reader bindings do not match the cache traversal contract'); }
	if (registeredModule) { throw new Error('A Rust bracket node reader module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Finishes or propagates the original failure through live state; no failed read is replayed. */
export function tryReadRustBracketNode(offset: Length, createHost: () => IRustBracketNodeReaderHost): { node: AstNode | undefined } | undefined {
	if (!registeredModule) { return undefined; }
	const result = registeredModule.read_longest_bracket_node(createHost(), offset);
	if (!result || typeof result.take !== 'function' || typeof result.free !== 'function') { throw new Error('The Rust bracket node reader result does not match the cache traversal contract'); }
	try { return { node: result.take() }; } finally { result.free(); }
}

/** Keeps overridden advancement callbacks at their original call site and delegates the normal implementation. */
export function tryAdvanceRustBracketNode(createHost: () => IRustBracketNodeReaderHost): boolean {
	if (!registeredModule) { return false; }
	if (registeredModule.advance_bracket_node(createHost()) !== true) { throw new Error('The Rust bracket node advancement result does not match the cache traversal contract'); }
	return true;
}
