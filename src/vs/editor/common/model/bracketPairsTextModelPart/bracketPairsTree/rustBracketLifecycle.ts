/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import type { AstNode } from './ast.js';
import type { TextEditInfo } from './beforeEditPositionMapper.js';
import type { BracketTokens } from './brackets.js';
import type { Tokenizer } from './tokenizer.js';

/** Original tree lifecycle operations retain public and private virtual dispatch. */
export const enum RustBracketLifecycleOperation { Initialize, CompleteTokenization, QueueEdits, HandleChange, FlushQueues }

/** Live model/parser/queue capabilities preserve provider order, event identity, and partial writes. */
export interface IRustBracketLifecycleHost {
	truthy(node: AstNode | undefined): boolean;
	isUndefined(node: AstNode | undefined): boolean;
	hasTokens(): boolean;
	completed(constructing: boolean): boolean;
	initialBrackets(): BracketTokens;
	fastTokenizer(brackets: BracketTokens): Tokenizer;
	parseInitial(tokenizer: Tokenizer): AstNode;
	initial(): AstNode | undefined;
	setInitial(node: AstNode | undefined): void;
	setCurrent(node: AstNode | undefined): void;
	parseEmpty(immutable: boolean): AstNode;
	fire(): void;
	combineQueue(initial: boolean): TextEditInfo[];
	setQueue(initial: boolean, edits: TextEditInfo[]): void;
	handleEdits(tokenChange: boolean): void;
	queueNonempty(initial: boolean): boolean;
	parseQueue(initial: boolean): AstNode;
	clearQueue(initial: boolean): void;
}

/** Generated bracket-tree lifecycle contract. */
export interface IRustBracketLifecycleModule {
	bracket_lifecycle_abi_version(): number;
	run_bracket_lifecycle(host: IRustBracketLifecycleHost, operation: RustBracketLifecycleOperation, tokenChange: boolean): void;
}

let registeredModule: IRustBracketLifecycleModule | undefined;

/** Installs lifecycle control for the initialized core's atomic disposable lifetime. */
export function registerRustBracketLifecycle(module: IRustBracketLifecycleModule): IDisposable {
	if (typeof module.bracket_lifecycle_abi_version !== 'function' || module.bracket_lifecycle_abi_version() !== 1 || typeof module.run_bracket_lifecycle !== 'function') { throw new Error('The Rust bracket lifecycle bindings do not match the tree lifecycle contract'); }
	if (registeredModule) { throw new Error('A Rust bracket lifecycle module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Runs once without replaying provider reads, queue writes, parser failures, or event delivery. */
export function tryRunRustBracketLifecycle(operation: RustBracketLifecycleOperation, tokenChange: boolean, createHost: () => IRustBracketLifecycleHost): boolean {
	if (!registeredModule) { return false; }
	registeredModule.run_bracket_lifecycle(createHost(), operation, tokenChange);
	return true;
}
