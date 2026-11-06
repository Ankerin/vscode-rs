/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import type { BracketPairColorizationOptions, TextModelResolvedOptions, ITextModelUpdateOptions } from '../model.js';
import type { FormattingOptions } from '../languages.js';
import type { IModelOptionsChangedEvent } from '../textModelEvents.js';
import type { IGuessedIndentation } from './indentationGuesser.js';

/** Model option operations share the atomic core registration lifetime. */
export const enum RustModelOptionsControllerOperation { Resolve = 0, Options = 1, Formatting = 2, Update = 3, DetectIndentation = 4, NormalizeIndentation = 5 }

/** Borrowed request/current values preserve original runtime coercion and aliases. */
type OptionValue = number | 'tabSize' | boolean | BracketPairColorizationOptions | undefined;
type ControllerResult = TextModelResolvedOptions | FormattingOptions | string | void;

/** Original option, factory, guess, virtual update, and event capabilities stay live. */
export interface IRustModelOptionsControllerHost {
	assertAlive(): void;
	request(index: number): OptionValue;
	current(index: number): OptionValue;
	options(): TextModelResolvedOptions;
	resolveSource(): TextModelResolvedOptions;
	construct(tab: number, indent: number | 'tabSize', insert: boolean, eol: number, trim: boolean, brackets: BracketPairColorizationOptions): TextModelResolvedOptions;
	equal(options: TextModelResolvedOptions): boolean;
	changeEvent(options: TextModelResolvedOptions): IModelOptionsChangedEvent;
	assign(options: TextModelResolvedOptions): void;
	notify(index: number, event: IModelOptionsChangedEvent): void;
	guess(tab: number, insert: boolean): IGuessedIndentation;
	guessed(guess: IGuessedIndentation, index: number): number | boolean;
	updateMethod(): (options: ITextModelUpdateOptions) => void;
	update(method: (options: ITextModelUpdateOptions) => void, insert: boolean, tab: number, indent: number): void;
	format(tab: number, insert: boolean): FormattingOptions;
	normalize(text: string, indent: number, insert: boolean): string;
}

/** Generated controller bindings preserve existing option/formatting/void results. */
export interface IRustModelOptionsControllerModule {
	model_options_controller_abi_version(): number;
	run_model_options_controller(host: IRustModelOptionsControllerHost, operation: RustModelOptionsControllerOperation, first: string | number | boolean | undefined, second: number): ControllerResult;
}

let registeredModule: IRustModelOptionsControllerModule | undefined;

/** Installs complete option controller control atomically with the Rust core. */
export function registerRustModelOptionsController(module: IRustModelOptionsControllerModule): IDisposable {
	if (typeof module.model_options_controller_abi_version !== 'function' || module.model_options_controller_abi_version() !== 1 || typeof module.run_model_options_controller !== 'function') { throw new Error('The Rust model option controller bindings do not match the update contract'); }
	if (registeredModule) { throw new Error('A Rust model option controller module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Keeps an original void result distinct from unavailable native control. */
export function tryRustModelOptionsController<T extends ControllerResult>(operation: RustModelOptionsControllerOperation, first: string | number | boolean | undefined, second: number, createHost: () => IRustModelOptionsControllerHost): { value: T } | undefined {
	if (!registeredModule) { return undefined; }
	return { value: registeredModule.run_model_options_controller(createHost(), operation, first, second) as T };
}

