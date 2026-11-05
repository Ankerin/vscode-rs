/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { CodePointIterator, GraphemeIterator } from '../../../base/common/strings.js';

/** Generated arithmetic and Unicode contracts for existing model/view cursor columns. */
export interface IRustCursorColumnsModule {
	cursor_columns_abi_version(): number;
	cursor_column(text: string, column: number, tabSize: number, operation: number): number | undefined;
	cursor_tab_stop(column: number, size: number, previous: boolean): number;
	grapheme_break_type(point: number): number | undefined;
}

let registeredModule: IRustCursorColumnsModule | undefined;
const standardMethods = [
	{ target: String.prototype, names: ['charCodeAt', 'substring'] },
	{ target: CodePointIterator.prototype, names: ['offset', 'nextCodePoint', 'setOffset', 'eol'] },
	{ target: GraphemeIterator.prototype, names: ['offset', 'nextGraphemeLength', 'eol'] }
].flatMap(({ target, names }) => names.map(name => ({ target, name, descriptor: Object.getOwnPropertyDescriptor(target, name) })));

/** Installs cursor computation for the same disposable lifetime as the initialized editor core. */
export function registerRustCursorColumns(module: IRustCursorColumnsModule): IDisposable {
	if (typeof module.cursor_columns_abi_version !== 'function' || module.cursor_columns_abi_version() !== 1 || typeof module.cursor_column !== 'function' || typeof module.cursor_tab_stop !== 'function' || typeof module.grapheme_break_type !== 'function') { throw new Error('The Rust cursor bindings do not match the current column contract'); }
	if (registeredModule) { throw new Error('A Rust cursor column module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Uses a borrowed primitive string and leaves overridden iterator/string callbacks on their original path. */
export function tryComputeRustCursorColumn(text: string, column: number, tabSize: number, operation: number): number | undefined {
	if (!registeredModule || typeof text !== 'string' || text.length > 4 * 1024 * 1024 || typeof column !== 'number' || typeof tabSize !== 'number' || standardMethods.some(({ target, name, descriptor }) => {
		const current = Object.getOwnPropertyDescriptor(target, name);
		return current?.value !== descriptor?.value || current?.get !== descriptor?.get;
	})) { return undefined; }
	const result = registeredModule.cursor_column(text, column, tabSize, operation);
	if (result !== undefined && typeof result !== 'number') { throw new Error('The Rust cursor column result does not match the editor contract'); }
	return result;
}

/** Retains every numeric domain, including NaN, infinities, fractions, and signed zero. */
export function tryComputeRustCursorTabStop(column: number, size: number, previous: boolean): number | undefined {
	if (!registeredModule || typeof column !== 'number' || typeof size !== 'number') { return undefined; }
	const result = registeredModule.cursor_tab_stop(column, size, previous);
	if (typeof result !== 'number') { throw new Error('The Rust cursor tab stop does not match the editor contract'); }
	return result;
}
