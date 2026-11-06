/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { tryCountRustEOL } from '../../../core/rustTextShape.js';
import type { Length } from './length.js';

/** Scalar operations retain the original packed length contracts at their existing public APIs. */
export const enum RustBracketLengthOperation {
	Pack,
	Add,
	NonNegativeDifference,
	Difference,
	Compare,
	LessThan,
	LessThanEqual,
	GreaterThanEqual,
	Equals,
	IsZero,
	Max,
	LineCount
}

/** Generated numeric bracket-coordinate bindings. */
export interface IRustBracketLengthsModule {
	bracket_lengths_abi_version(): number;
	bracket_length(operation: number, first: number, second: number, third: number, fourth: number): number | undefined;
	bracket_length_parts(length: number): Float64Array;
}

let registeredModule: IRustBracketLengthsModule | undefined;
const floor = Object.getOwnPropertyDescriptor(Math, 'floor');
const splitMethods = [
	{ target: String.prototype, name: 'split' },
	{ target: RegExp.prototype, name: 'exec' },
	{ target: RegExp.prototype, name: 'flags' },
	{ target: RegExp.prototype, name: 'global' },
	{ target: RegExp.prototype, name: 'unicode' },
	{ target: RegExp.prototype, name: 'unicodeSets' },
	{ target: RegExp.prototype, name: 'sticky' },
	{ target: RegExp.prototype, name: 'hasIndices' },
	{ target: RegExp.prototype, name: 'ignoreCase' },
	{ target: RegExp.prototype, name: 'multiline' },
	{ target: RegExp.prototype, name: 'dotAll' },
	{ target: RegExp.prototype, name: Symbol.match },
	{ target: RegExp.prototype, name: Symbol.split },
	{ target: RegExp.prototype, name: 'constructor' },
	{ target: RegExp, name: Symbol.species }
].map(({ target, name }) => ({ target, name, descriptor: Object.getOwnPropertyDescriptor(target, name) }));

/** Installs packed lengths for the same atomic disposable lifetime as the rest of the Rust core. */
export function registerRustBracketLengths(module: IRustBracketLengthsModule): IDisposable {
	if (typeof module.bracket_lengths_abi_version !== 'function' || module.bracket_lengths_abi_version() !== 1 || typeof module.bracket_length !== 'function' || typeof module.bracket_length_parts !== 'function') { throw new Error('The Rust bracket length bindings do not match the packed coordinate contract'); }
	if (registeredModule) { throw new Error('A Rust bracket length module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Leaves boxed values and host coercion on the existing implementation without invoking them early. */
export function tryRustBracketLength(operation: RustBracketLengthOperation, first: number | Length, second: number | Length, third?: number, fourth?: number): number | undefined {
	if (!registeredModule || typeof first !== 'number' || typeof second !== 'number' || (operation === RustBracketLengthOperation.Difference && (typeof third !== 'number' || typeof fourth !== 'number')) || !standardFloor()) { return undefined; }
	const result = registeredModule.bracket_length(operation, first, second, third ?? 0, fourth ?? 0);
	if (typeof result !== 'number') { throw new Error('The Rust bracket length result does not match the packed coordinate contract'); }
	return result;
}

/** Keeps the original object constructors outside the numeric conversion boundary. */
export function tryRustBracketLengthParts(length: Length): Float64Array | undefined {
	if (!registeredModule || typeof length !== 'number' || !standardFloor()) { return undefined; }
	const result = registeredModule.bracket_length_parts(length);
	if (!(result instanceof Float64Array) || result.length !== 2) { throw new Error('The Rust bracket length parts do not match the packed coordinate contract'); }
	return result;
}

/** Reuses the native lossless EOL scanner while retaining overridden split and regular-expression callbacks. */
export function tryRustBracketTextLength(text: string): [number, number] | undefined {
	if (!registeredModule || typeof text !== 'string') { return undefined; }
	for (let index = 0; index < splitMethods.length; index++) {
		const { target, name, descriptor } = splitMethods[index];
		const current = Object.getOwnPropertyDescriptor(target, name);
		if (current?.value !== descriptor?.value || current?.get !== descriptor?.get) { return undefined; }
	}
	const result = tryCountRustEOL(text);
	return result === undefined ? undefined : [result[0], result[2]];
}

/** Descriptor comparison preserves an overridden Math.floor callback without invoking its getter. */
function standardFloor(): boolean {
	const current = Object.getOwnPropertyDescriptor(Math, 'floor');
	return current?.value === floor?.value && current?.get === floor?.get;
}
