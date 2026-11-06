/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import type { AstNode } from './ast.js';
import type { Length } from './length.js';

/** Live query capabilities retain node/map identities, callback results, and exact read order. */
export interface IRustBracketCollectionHost {
	truthy(value: AstNode | boolean | null): boolean;
	kind(node: AstNode): number;
	childCount(node: AstNode): number;
	indexBefore(index: number, count: number): boolean;
	child(node: AstNode, index: number): AstNode | null;
	end(start: Length, child: AstNode): Length;
	inRange(start: Length, end: Length): boolean;
	reachesEnd(end: Length): boolean;
	isBracket(node: AstNode): boolean;
	colorize(node: AstNode): boolean;
	hasLevels(): boolean;
	getLevel(node: AstNode): number | undefined;
	isUndefined(value: number | undefined): boolean;
	increment(value: number): number;
	addOne(value: number): number;
	setLevel(node: AstNode, value: number): void;
	restoreLevel(node: AstNode, value: number): void;
	hasClosing(node: AstNode): boolean;
	collect(node: AstNode, start: Length, end: Length, level: number, equalLevel: number, incomplete: boolean): boolean;
	emitUnexpected(start: Length, end: Length, level: number): boolean;
	emitBracket(start: Length, end: Length, level: number, equalLevel: number, incomplete: boolean): boolean;
}

/** Scoped results retain actual callback values while distinguishing an unavailable implementation. */
interface IRustBracketCollectionResult {
	take(): boolean;
	free(): void;
}

/** Generated colorized bracket traversal contract. */
export interface IRustBracketCollectionModule {
	bracket_collection_abi_version(): number;
	collect_brackets(host: IRustBracketCollectionHost, node: AstNode, start: Length, end: Length, level: number, equalLevel: number, incomplete: boolean): IRustBracketCollectionResult;
}

let registeredModule: IRustBracketCollectionModule | undefined;

/** Installs colorized range traversal for the initialized core's atomic disposable lifetime. */
export function registerRustBracketCollection(module: IRustBracketCollectionModule): IDisposable {
	if (typeof module.bracket_collection_abi_version !== 'function' || module.bracket_collection_abi_version() !== 1 || typeof module.collect_brackets !== 'function') { throw new Error('The Rust bracket collection bindings do not match the colorized range contract'); }
	if (registeredModule) { throw new Error('A Rust bracket collection module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Traverses once without replaying callbacks, map mutations, or partial failures. */
export function tryCollectRustBrackets(node: AstNode, start: Length, end: Length, level: number, equalLevel: number, incomplete: boolean, createHost: () => IRustBracketCollectionHost): { continued: boolean } | undefined {
	if (!registeredModule) { return undefined; }
	const result = registeredModule.collect_brackets(createHost(), node, start, end, level, equalLevel, incomplete);
	if (!result || typeof result.take !== 'function' || typeof result.free !== 'function') { throw new Error('The Rust bracket collection result does not match the colorized range contract'); }
	try { return { continued: result.take() }; } finally { result.free(); }
}

