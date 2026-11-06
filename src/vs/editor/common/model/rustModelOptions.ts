/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import type { BracketPairColorizationOptions, DefaultEndOfLine } from '../model.js';
import type { IModelOptionsChangedEvent } from '../textModelEvents.js';
import { ownRustBracketNumericState, RustBracketNumericStateKind } from './bracketPairsTextModelPart/bracketPairsTree/rustBracketNodeMetadata.js';

/** Complete resolved-option operations share the core's atomic registration lifetime. */
export const enum RustModelOptionsOperation { Initialize = 0, OriginalIndent = 1, Equal = 2, ChangeEvent = 3 }

/** Source options retain the existing constructor contract. */
export interface IRustModelOptionsSource {
	tabSize: number;
	indentSize: number | 'tabSize';
	insertSpaces: boolean;
	defaultEOL: DefaultEndOfLine;
	trimAutoWhitespace: boolean;
	bracketPairColorizationOptions: BracketPairColorizationOptions;
}

export const rustModelOptionsFields = ['tabSize', 'indentSize', '_indentSizeIsTabSize', 'insertSpaces', 'defaultEOL', 'trimAutoWhitespace', 'bracketPairColorizationOptions'] as const;
export const rustModelOptionsSourceFields = ['tabSize', 'indentSize', 'insertSpaces', 'defaultEOL', 'trimAutoWhitespace', 'bracketPairColorizationOptions'] as const;

/** Borrowed option values preserve bracket configuration aliases. */
export type RustModelOptionValue = number | 'tabSize' | boolean | BracketPairColorizationOptions;
type ModelOptionsResult = number | 'tabSize' | boolean | IModelOptionsChangedEvent | void;
type WritableOptionsEvent = { -readonly [K in keyof IModelOptionsChangedEvent]: IModelOptionsChangedEvent[K] };

/** Live source/field/event operations retain getter and factory ordering. */
export interface IRustModelOptionsHost {
	source(index: number): RustModelOptionValue;
	get(other: boolean, index: number): RustModelOptionValue;
	set(index: number, value: RustModelOptionValue): void;
	integer(value: number, minimum: boolean): number;
	bracketsEqual(first: BracketPairColorizationOptions, second: BracketPairColorizationOptions): boolean;
	createEvent(): IModelOptionsChangedEvent;
	eventField(event: WritableOptionsEvent, index: number, changed: boolean): void;
}

/** Generated option control returns existing scalar/event representations. */
export interface IRustModelOptionsModule {
	model_options_abi_version(): number;
	run_model_options(host: IRustModelOptionsHost, operation: RustModelOptionsOperation): ModelOptionsResult;
}

let registeredModule: IRustModelOptionsModule | undefined;

/** Installs resolved-option control atomically with the Rust core. */
export function registerRustModelOptions(module: IRustModelOptionsModule): IDisposable {
	if (typeof module.model_options_abi_version !== 'function' || module.model_options_abi_version() !== 1 || typeof module.run_model_options !== 'function') { throw new Error('The Rust model options bindings do not match the resolved-option contract'); }
	if (registeredModule) { throw new Error('A Rust model options module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Preserves original void/scalar/event results without confusing unavailable control. */
export function tryRustModelOptions<T extends ModelOptionsResult>(operation: RustModelOptionsOperation, createHost: () => IRustModelOptionsHost): { value: T } | undefined {
	if (!registeredModule) { return undefined; }
	return { value: registeredModule.run_model_options(createHost(), operation) as T };
}

/** Owns fresh resolved fields and bracket configuration handles before an instance escapes. */
export function ownRustModelOptions<T extends object>(options: T): T {
	return ownRustBracketNumericState(options, RustBracketNumericStateKind.ModelOptions);
}

