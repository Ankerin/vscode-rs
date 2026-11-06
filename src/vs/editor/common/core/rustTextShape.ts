/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { encodeUTF16 } from './utf16Transfer.js';

/** Original line-ending and leading-indentation algorithms beneath existing text consumers. */
export interface IRustTextShapeModule {
	text_shape_abi_version(): number;
	text_eol_count(units: Uint16Array): Uint32Array | undefined;
	text_normalize_indentation(text: string, indentSize: number, insertSpaces: boolean): [number, string] | undefined;
}

let registeredModule: IRustTextShapeModule | undefined;
const stringMethods = ['charCodeAt', 'charAt', 'substring'].map(name => ({ name, descriptor: Object.getOwnPropertyDescriptor(String.prototype, name) }));

/** Installs text-shape computation for the initialized editor core's disposable lifetime. */
export function registerRustTextShape(module: IRustTextShapeModule): IDisposable {
	if (typeof module.text_shape_abi_version !== 'function' || module.text_shape_abi_version() !== 1 || typeof module.text_eol_count !== 'function' || typeof module.text_normalize_indentation !== 'function') { throw new Error('The Rust text shape bindings do not match the current string contract'); }
	if (registeredModule) { throw new Error('A Rust text shape module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Preserves lone surrogates, CR/LF/CRLF coordinates, first/last lengths, and ending masks. */
export function tryCountRustEOL(text: string): [number, number, number, number] | undefined {
	if (!registeredModule || !standardInput(text, false)) { return undefined; }
	const result = registeredModule.text_eol_count(encodeUTF16(text));
	if (result === undefined) { return undefined; }
	if (!(result instanceof Uint32Array) || result.length !== 4 || result[0] > text.length || result[1] > text.length || result[2] > text.length || result[3] > 3) { throw new Error('The Rust EOL count result does not match the string contract'); }
	return [result[0], result[1], result[2], result[3]];
}

/** Reuses the original suffix so Unicode text never crosses a lossy normalized-string boundary. */
export function tryNormalizeRustIndentation(text: string, indentSize: number, insertSpaces: boolean): string | undefined {
	if (!registeredModule || !standardInput(text, true) || typeof indentSize !== 'number' || typeof insertSpaces !== 'boolean') { return undefined; }
	const result = registeredModule.text_normalize_indentation(text, indentSize, insertSpaces);
	if (result === undefined) { return undefined; }
	if (!Array.isArray(result) || result.length !== 2 || !Number.isInteger(result[0]) || result[0] < 0 || result[0] > text.length || typeof result[1] !== 'string') { throw new Error('The Rust indentation result does not match the string contract'); }
	return result[1] + text.substring(result[0]);
}

/** Descriptor checks retain original string callbacks without invoking them during preflight. */
function standardInput(text: string, indentation: boolean): boolean {
	if (typeof text !== 'string' || text.length > 4 * 1024 * 1024) { return false; }
	return stringMethods.every(({ name, descriptor }, index) => {
		if (!indentation && index > 0) { return true; }
		const current = Object.getOwnPropertyDescriptor(String.prototype, name);
		return current?.value === descriptor?.value && current?.get === descriptor?.get;
	});
}
