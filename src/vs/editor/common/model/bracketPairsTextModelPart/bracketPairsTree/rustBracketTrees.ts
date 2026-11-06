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
}

let registeredModule: IRustBracketTreesModule | undefined;

/** Installs tree construction for the initialized core's atomic disposable lifetime. */
export function registerRustBracketTrees(module: IRustBracketTreesModule): IDisposable {
	if (typeof module.bracket_trees_abi_version !== 'function' || module.bracket_trees_abi_version() !== 1 || typeof module.concat_bracket_trees_same_height !== 'function') { throw new Error('The Rust bracket tree bindings do not match the tree construction contract'); }
	if (registeredModule) { throw new Error('A Rust bracket tree module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Supported construction either finishes or throws; fallback never repeats partially completed groups. */
export function tryConcatRustBracketTrees(length: number, create: (target: number, first: number, second: number, third: number) => AstNode): { node: AstNode | null } | undefined {
	if (!registeredModule || typeof length !== 'number' || !Number.isSafeInteger(length) || length < 2 || length > 262144) { return undefined; }
	const result = registeredModule.concat_bracket_trees_same_height(length, create);
	if (result === undefined) { return undefined; }
	if (!result || typeof result.take !== 'function' || typeof result.free !== 'function') { throw new Error('The Rust bracket tree result does not match the tree construction contract'); }
	try { return { node: result.take() }; } finally { result.free(); }
}
