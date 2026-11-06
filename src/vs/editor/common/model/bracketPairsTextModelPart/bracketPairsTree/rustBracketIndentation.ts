/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import type { AstNode } from './ast.js';
import type { Length } from './length.js';

/** Original node-specific indentation methods retain their virtual dispatch boundary. */
export const enum RustBracketIndentationOperation { Pair, List, Text, Leaf }

/** Live node/model capabilities preserve cache state, scalar callbacks, and provider order. */
export interface IRustBracketIndentationHost {
	maximum(): number;
	pairHasChild(): boolean;
	pairCompute(offset: Length): number;
	cacheUncomputed(): boolean;
	cached(): number;
	indexBeforeCount(index: number): boolean;
	child(index: number): AstNode | null;
	truthy(value: AstNode | null): boolean;
	minimumChild(current: number, child: AstNode, offset: Length): number;
	end(offset: Length, child: AstNode): Length;
	setCached(value: number): void;
	startLine(offset: Length): number;
	endLine(offset: Length): number;
	lineBeforeEnd(line: number, end: number): boolean;
	firstColumn(line: number): number;
	lineContent(line: number): string;
	isZero(value: number): boolean;
	visibleColumn(content: string, first: number): number;
	minimum(first: number, second: number): number;
	increment(line: number): number;
}

/** Scoped results preserve original cached values without confusing undefined with unavailable code. */
interface IRustBracketIndentationResult { take(): number; free(): void }

/** Generated bracket AST indentation contract. */
export interface IRustBracketIndentationModule {
	bracket_indentation_abi_version(): number;
	compute_bracket_indentation(host: IRustBracketIndentationHost, operation: RustBracketIndentationOperation, offset: Length): IRustBracketIndentationResult;
}

let registeredModule: IRustBracketIndentationModule | undefined;

/** Installs AST indentation for the initialized core's atomic disposable lifetime. */
export function registerRustBracketIndentation(module: IRustBracketIndentationModule): IDisposable {
	if (typeof module.bracket_indentation_abi_version !== 'function' || module.bracket_indentation_abi_version() !== 1 || typeof module.compute_bracket_indentation !== 'function') { throw new Error('The Rust bracket indentation bindings do not match the AST indentation contract'); }
	if (registeredModule) { throw new Error('A Rust bracket indentation module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Computes once without replaying provider callbacks, recursive failures, or cache writes. */
export function tryComputeRustBracketIndentation(operation: RustBracketIndentationOperation, offset: Length, createHost: () => IRustBracketIndentationHost): { indentation: number } | undefined {
	if (!registeredModule) { return undefined; }
	const result = registeredModule.compute_bracket_indentation(createHost(), operation, offset);
	if (!result || typeof result.take !== 'function' || typeof result.free !== 'function') { throw new Error('The Rust bracket indentation result does not match the AST indentation contract'); }
	try { return { indentation: result.take() }; } finally { result.free(); }
}
