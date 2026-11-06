/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from './lifecycle.js';

/** Shared code-point and stateless grapheme kernels for the existing string iterators. */
export interface IRustUnicodeModule {
	unicode_abi_version(): number;
	unicode_code_point(text: string, length: number, offset: number, previous: boolean): number | undefined;
	unicode_grapheme_offset(text: string, offset: number, previous: boolean): number | undefined;
	unicode_left_delete_offset(text: string, offset: number): number | undefined;
}

let registeredModule: IRustUnicodeModule | undefined;
const characterMethod = Object.getOwnPropertyDescriptor(String.prototype, 'charCodeAt');

/** Avoids iterator preflight work while the native editor core is disabled. */
export function isRustUnicodeRegistered(): boolean {
	return registeredModule !== undefined;
}

/** Installs borrowed-string traversal for the owning editor core's disposable lifetime. */
export function registerRustUnicode(module: IRustUnicodeModule): IDisposable {
	if (typeof module.unicode_abi_version !== 'function' || module.unicode_abi_version() !== 2 || typeof module.unicode_code_point !== 'function' || typeof module.unicode_grapheme_offset !== 'function' || typeof module.unicode_left_delete_offset !== 'function') { throw new Error('The Rust Unicode bindings do not match the current iterator contract'); }
	if (registeredModule) { throw new Error('A Rust Unicode module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Leaves unusual offsets, cached lengths, and string callbacks on the existing implementation. */
export function tryComputeRustCodePoint(text: string, length: number, offset: number, previous: boolean): number | undefined {
	if (!registeredModule || !standardInput(text, length, offset, previous)) { return undefined; }
	const result = registeredModule.unicode_code_point(text, length, offset, previous);
	if (result !== undefined && (!Number.isInteger(result) || result < 0 || result > 0x10FFFF)) { throw new Error('The Rust code point result does not match the iterator contract'); }
	return result;
}

/** Returns the resulting iterator coordinate without retaining a second text copy or iterator. */
export function tryComputeRustGraphemeOffset(text: string, offset: number, previous: boolean): number | undefined {
	if (!registeredModule || typeof text !== 'string' || !standardInput(text, text.length, offset, previous)) { return undefined; }
	const result = registeredModule.unicode_grapheme_offset(text, offset, previous);
	if (result !== undefined && (!Number.isInteger(result) || result < 0 || result > text.length || (previous ? result >= offset : result <= offset))) { throw new Error('The Rust grapheme offset result does not match the iterator contract'); }
	return result;
}

/** Returns one Unicode-aware Backspace boundary without transferring the complete source. */
export function tryComputeRustLeftDeleteOffset(text: string, offset: number): number | undefined {
	if (!registeredModule || typeof text !== 'string' || !standardInput(text, text.length, offset, true)) { return undefined; }
	const result = registeredModule.unicode_left_delete_offset(text, offset);
	if (result !== undefined && (!Number.isInteger(result) || result < 0 || result >= offset)) { throw new Error('The Rust left delete offset does not match the iterator contract'); }
	return result;
}

/** Rejects accessors without invoking them and bounds only the actually supported traversal. */
function standardInput(text: string, length: number, offset: number, previous: boolean): boolean {
	if (typeof text !== 'string' || text.length > 4 * 1024 * 1024 || !Number.isSafeInteger(length) || length < 0 || length > text.length || !Number.isSafeInteger(offset) || (previous ? offset <= 0 || offset > length : offset < 0 || offset >= length)) { return false; }
	const current = Object.getOwnPropertyDescriptor(String.prototype, 'charCodeAt');
	return current?.value === characterMethod?.value && current?.get === characterMethod?.get;
}
