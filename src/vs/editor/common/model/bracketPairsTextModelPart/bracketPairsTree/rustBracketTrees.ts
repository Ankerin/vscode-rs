/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import type { AstNode } from './ast.js';

/** Scoped result ownership distinguishes unsupported inputs from an original undefined factory result. */
interface IRustBracketTreeResult {
	take(): AstNode | null;
	free(): void;
}

/** Tree grouping invokes the original factory and slot writes in their original order. */
export interface IRustBracketTreesModule {
	bracket_trees_abi_version(): number;
	concat_bracket_trees_same_height(length: number, create: (target: number, first: number, second: number, third: number) => AstNode): IRustBracketTreeResult | undefined;
	concat_bracket_trees(host: IRustBracketTreeHost): IRustBracketTreeResult;
}

/** AST capabilities retain the original receiver, field/slot reads, and partial virtual-method mutations. */
export interface IRustBracketTreeHost {
	isEnd(index: number): boolean;
	heightAt(index: number): number;
	matchesHeight(index: number, height: number): boolean;
	item(index: number): AstNode;
	group(start: number, end: number): AstNode | null;
	truthy(node: AstNode | null): boolean;
	preferFirst(first: AstNode, second: AstNode, next: AstNode): boolean;
	compareHeight(first: AstNode, second: AstNode, greater: boolean): boolean;
	createPair(first: AstNode, second: AstNode): AstNode;
	toMutable(node: AstNode): AstNode;
	createParents(): AstNode[];
	pushParent(parents: AstNode[], node: AstNode): void;
	parentsLastIndex(parents: AstNode[]): number;
	parentAt(parents: AstNode[], index: number): AstNode;
	isList(node: AstNode): boolean;
	edgeMutable(node: AstNode, append: boolean): AstNode | null | undefined;
	fullChildren(node: AstNode): boolean;
	splitChild(parent: AstNode, carried: AstNode, append: boolean): AstNode;
	addChild(parent: AstNode, carried: AstNode, append: boolean): void;
	childrenChanged(parent: AstNode): void;
	unexpectedError(): Error;
}

let registeredModule: IRustBracketTreesModule | undefined;

/** Installs tree construction for the initialized core's atomic disposable lifetime. */
export function registerRustBracketTrees(module: IRustBracketTreesModule): IDisposable {
	if (typeof module.bracket_trees_abi_version !== 'function' || module.bracket_trees_abi_version() !== 2 || typeof module.concat_bracket_trees_same_height !== 'function' || typeof module.concat_bracket_trees !== 'function') { throw new Error('The Rust bracket tree bindings do not match the tree construction contract'); }
	if (registeredModule) { throw new Error('A Rust bracket tree module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Supported construction either finishes or throws; fallback never repeats partially completed groups. */
export function tryConcatRustBracketTrees(length: number, create: (target: number, first: number, second: number, third: number) => AstNode): { node: AstNode | null } | undefined {
	if (!registeredModule || typeof length !== 'number' || !Number.isSafeInteger(length) || length < 2 || length > 262144) { return undefined; }
	const result = registeredModule.concat_bracket_trees_same_height(length, create);
	if (result === undefined) { return undefined; }
	return consumeResult(result);
}

/** Complete balancing finishes or throws through live host state; it never replays a partially mutated tree. */
export function tryConcatRustBracketTreeList(createHost: () => IRustBracketTreeHost): { node: AstNode | null } | undefined {
	if (!registeredModule) { return undefined; }
	return consumeResult(registeredModule.concat_bracket_trees(createHost()));
}

/** Consuming the result releases its only native reference and immediately frees the native handle. */
function consumeResult(result: IRustBracketTreeResult): { node: AstNode | null } {
	if (!result || typeof result.take !== 'function' || typeof result.free !== 'function') { throw new Error('The Rust bracket tree result does not match the tree construction contract'); }
	try { return { node: result.take() }; } finally { result.free(); }
}
