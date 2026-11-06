/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import type { AstNode } from './ast.js';

/** Concrete list mutation operations retain existing method entry points. */
export const enum RustBracketMutationOperation { Append, Unappend, Prepend, Unprepend }

/** Live field/array capabilities preserve aliases, virtual dispatch, and partial failure state. */
export interface IRustBracketMutationHost {
	incoming(): AstNode | undefined;
	item(index: number): AstNode | null;
	truthy(value: AstNode | null): boolean;
	invalidCapacity(operation: RustBracketMutationOperation): never;
	throwIfImmutable(): void;
	setItem(index: number, value: AstNode | null): void;
	arrayMutation(operation: RustBracketMutationOperation): AstNode | undefined;
	update(): void;
}

interface IRustBracketMutationResult { take(): AstNode | undefined; free(): void }

/** Generated concrete list mutation contract. */
export interface IRustBracketMutationModule {
	bracket_mutation_abi_version(): number;
	mutate_bracket_list(host: IRustBracketMutationHost, operation: RustBracketMutationOperation, compact: boolean): IRustBracketMutationResult;
}

let registeredModule: IRustBracketMutationModule | undefined;

/** Installs concrete list mutations for the initialized core's atomic disposable lifetime. */
export function registerRustBracketMutation(module: IRustBracketMutationModule): IDisposable {
	if (typeof module.bracket_mutation_abi_version !== 'function' || module.bracket_mutation_abi_version() !== 1 || typeof module.mutate_bracket_list !== 'function') { throw new Error('The Rust bracket mutation bindings do not match the list mutation contract'); }
	if (registeredModule) { throw new Error('A Rust bracket mutation module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Mutates once without replaying validation, slot writes, array operations, or metadata failures. */
export function tryMutateRustBracketList(operation: RustBracketMutationOperation, compact: boolean, createHost: () => IRustBracketMutationHost): { value: AstNode | undefined } | undefined {
	if (!registeredModule) { return undefined; }
	const result = registeredModule.mutate_bracket_list(createHost(), operation, compact);
	if (!result || typeof result.take !== 'function' || typeof result.free !== 'function') { throw new Error('The Rust bracket mutation result does not match the list mutation contract'); }
	try { return { value: result.take() }; } finally { result.free(); }
}
