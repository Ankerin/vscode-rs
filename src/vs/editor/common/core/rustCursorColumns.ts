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
	cursor_whitespace_column(text: string, position: number, tabSize: number): Float64Array | undefined;
	cursor_atomic_position(text: string, position: number, tabSize: number, direction: number): number | undefined;
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
	if (typeof module.cursor_columns_abi_version !== 'function' || module.cursor_columns_abi_version() !== 2 || typeof module.cursor_column !== 'function' || typeof module.cursor_tab_stop !== 'function' || typeof module.cursor_whitespace_column !== 'function' || typeof module.cursor_atomic_position !== 'function' || typeof module.grapheme_break_type !== 'function') { throw new Error('The Rust cursor bindings do not match the current column contract'); }
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

/** Returns initial indentation coordinates without copying the complete source line. */
export function tryComputeRustWhitespaceColumn(text: string, position: number, tabSize: number): [number, number, number] | undefined {
	if (!registeredModule || !standardAtomicInput(text, position, tabSize)) { return undefined; }
	const result = registeredModule.cursor_whitespace_column(text, position, tabSize);
	if (result === undefined) { return undefined; }
	if (!(result instanceof Float64Array) || result.length !== 3) { throw new Error('The Rust whitespace column result does not match the editor contract'); }
	return [result[0], result[1], result[2]];
}

/** Retains every numeric direction, including the original rightward invalid-direction branch. */
export function tryComputeRustAtomicPosition(text: string, position: number, tabSize: number, direction: number): number | undefined {
	if (!registeredModule || !standardAtomicInput(text, position, tabSize) || typeof direction !== 'number') { return undefined; }
	const result = registeredModule.cursor_atomic_position(text, position, tabSize, direction);
	if (result !== undefined && typeof result !== 'number') { throw new Error('The Rust atomic position result does not match the editor contract'); }
	return result;
}

const characterMethod = Object.getOwnPropertyDescriptor(String.prototype, 'charCodeAt');

/** Descriptor checks preserve string overrides without reading their accessors during preflight. */
function standardAtomicInput(text: string, position: number, tabSize: number): boolean {
	if (typeof text !== 'string' || text.length > 4 * 1024 * 1024 || typeof position !== 'number' || typeof tabSize !== 'number') { return false; }
	const current = Object.getOwnPropertyDescriptor(String.prototype, 'charCodeAt');
	return current?.value === characterMethod?.value && current?.get === characterMethod?.get;
}
