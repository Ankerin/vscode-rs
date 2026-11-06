/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import type { AstNode } from './ast.js';
import type { Length } from './length.js';
import type { SmallImmutableSet } from './smallImmutableSet.js';
import type { Token } from './tokenizer.js';

/** Caught parser capabilities preserve token/cache methods, node factories, and host item arrays. */
export interface IRustBracketParserHost {
	nodeExists(node: AstNode | null | undefined): boolean;
	resetCounters(): void;
	parseRoot(): AstNode | null;
	empty(): AstNode;
	newItems(): AstNode[];
	cached(opened: SmallImmutableSet<number>): AstNode | undefined;
	peek(): Token | null;
	tokenExists(token: Token | null): boolean;
	closesOpened(token: Token, opened: SmallImmutableSet<number>): boolean;
	parseChild(opened: SmallImmutableSet<number>, level: number): AstNode;
	emptyList(node: AstNode): boolean;
	push(items: AstNode[], node: AstNode): void;
	concat(items: AstNode[]): AstNode | null;
	hasReader(): boolean;
	cacheableLength(): Length | null;
	cacheable(length: Length | null): boolean;
	readCache(length: Length | null, opened: SmallImmutableSet<number>): AstNode | undefined;
	incrementCached(): void;
	skipNode(node: AstNode): void;
	lengthAccepts(node: AstNode, maximum: Length | null): boolean;
	canReuse(node: AstNode, opened: SmallImmutableSet<number>): boolean;
	incrementConstructed(): void;
	read(): Token | null;
	tokenKind(token: Token): number;
	invalid(token: Token): AstNode;
	text(token: Token): AstNode;
	newText(token: Token): AstNode;
	merge(opened: SmallImmutableSet<number>, token: Token): SmallImmutableSet<number>;
	parseList(opened: SmallImmutableSet<number>, level: number): AstNode | null;
	closesPair(closing: Token, opening: Token): boolean;
	pair(opening: Token, child: AstNode | null, closing: Token | null): AstNode;
	unexpected(): Error;
}

/** Scoped reference results distinguish completed null/undefined nodes from an unavailable core. */
interface IRustBracketParserResult {
	take(): AstNode | null | undefined;
	free(): void;
}

/** Generated document/list/child/cache orchestration contracts. */
export interface IRustBracketParserModule {
	bracket_parser_abi_version(): number;
	parse_bracket_document(host: IRustBracketParserHost): IRustBracketParserResult;
	parse_bracket_list(host: IRustBracketParserHost, opened: SmallImmutableSet<number>, level: number): IRustBracketParserResult;
	parse_bracket_child(host: IRustBracketParserHost, opened: SmallImmutableSet<number>, level: number): IRustBracketParserResult;
	read_bracket_parser_cache(host: IRustBracketParserHost, opened: SmallImmutableSet<number>): IRustBracketParserResult;
	can_reuse_bracket_parser_node(host: IRustBracketParserHost, node: AstNode, maximum: Length | null, opened: SmallImmutableSet<number>): boolean;
}

/** Entry points remain beneath the original parser methods so their virtual calls retain order. */
export const enum RustBracketParserOperation {
	Document,
	List,
	Child,
	Cache
}

let registeredModule: IRustBracketParserModule | undefined;

/** Installs parser orchestration for the initialized core's atomic disposable lifetime. */
export function registerRustBracketParser(module: IRustBracketParserModule): IDisposable {
	if (typeof module.bracket_parser_abi_version !== 'function' || module.bracket_parser_abi_version() !== 1 || typeof module.parse_bracket_document !== 'function' || typeof module.parse_bracket_list !== 'function' || typeof module.parse_bracket_child !== 'function' || typeof module.read_bracket_parser_cache !== 'function' || typeof module.can_reuse_bracket_parser_node !== 'function') { throw new Error('The Rust bracket parser bindings do not match the parser orchestration contract'); }
	if (registeredModule) { throw new Error('A Rust bracket parser module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Finishes or propagates each parse without replaying consumed tokens, factories, or mutations. */
export function tryParseRustBrackets(operation: RustBracketParserOperation, opened: SmallImmutableSet<number> | undefined, level: number, createHost: () => IRustBracketParserHost): { node: AstNode | null | undefined } | undefined {
	if (!registeredModule) { return undefined; }
	const host = createHost();
	const result = operation === RustBracketParserOperation.Document ? registeredModule.parse_bracket_document(host)
		: operation === RustBracketParserOperation.List ? registeredModule.parse_bracket_list(host, opened!, level)
			: operation === RustBracketParserOperation.Child ? registeredModule.parse_bracket_child(host, opened!, level)
				: registeredModule.read_bracket_parser_cache(host, opened!);
	if (!result || typeof result.take !== 'function' || typeof result.free !== 'function') { throw new Error('The Rust bracket parser result does not match the parser orchestration contract'); }
	try { return { node: result.take() }; } finally { result.free(); }
}

/** Applies native cache acceptance beneath the reader's original callback invocation. */
export function tryCanReuseRustBracketNode(node: AstNode, maximum: Length | null, opened: SmallImmutableSet<number>, createHost: () => IRustBracketParserHost): boolean | undefined {
	if (!registeredModule) { return undefined; }
	const result = registeredModule.can_reuse_bracket_parser_node(createHost(), node, maximum, opened);
	if (typeof result !== 'boolean') { throw new Error('The Rust bracket parser predicate result does not match the parser orchestration contract'); }
	return result;
}
