/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';

/** Generated bracket identifier set bindings borrow only the words required by each operation. */
export interface IRustSmallSetModule {
	small_set_abi_version(): number;
	small_set_add(word: number, key: number, length: number, reader: (second: boolean, index: number) => number | undefined): Float64Array | undefined;
	small_set_merge(first: number, second: number, firstLength: number, secondLength: number, reader: (second: boolean, index: number) => number | undefined): Float64Array | undefined;
	small_set_query(operation: number, first: number, second: number, key: number, firstLength: number, secondLength: number, reader: (second: boolean, index: number) => number | undefined): boolean | undefined;
}

interface ISetShape {
	readonly word: number;
	readonly additional: readonly number[];
}

let registeredModule: IRustSmallSetModule | undefined;
const standardSets = new WeakMap<object, object>();
const standardItems = new WeakSet<readonly number[]>();
const standardMethods = [
	{ target: Array.prototype, names: ['push', 'slice', 'constructor', Symbol.iterator] },
	{ target: Array, names: [Symbol.species] },
	{ target: Math, names: ['min', 'max'] }
].flatMap(({ target, names }) => names.map(name => ({ target, name, descriptor: Object.getOwnPropertyDescriptor(target, name) })));

/** Records only instances constructed directly by the original set class, rejecting proxy receivers. */
export function trackRustSmallSet(set: object): void {
	standardSets.set(set, Object.getPrototypeOf(set));
}

/** Records arrays created by internal literals, native result reconstruction, or a verified intrinsic slice. */
export function trackRustSmallSetItems(items: readonly number[]): void {
	standardItems.add(items);
}

/** Verifies the complete intrinsic slice construction without invoking caller accessors or proxy traps. */
export function canTrackRustSmallSetSlice(items: readonly number[]): boolean {
	return standardItems.has(items) && Object.getPrototypeOf(items) === Array.prototype && !Object.hasOwn(items, 'slice') && !Object.hasOwn(items, 'constructor') && unchangedMethods();
}

/** Installs set computation for the initialized core's atomic disposable lifetime. */
export function registerRustSmallSet(module: IRustSmallSetModule): IDisposable {
	if (typeof module.small_set_abi_version !== 'function' || module.small_set_abi_version() !== 1 || typeof module.small_set_add !== 'function' || typeof module.small_set_merge !== 'function' || typeof module.small_set_query !== 'function') { throw new Error('The Rust small set bindings do not match the bracket identifier contract'); }
	if (registeredModule) { throw new Error('A Rust small set module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** The original key provider has already run; unsupported state falls back without reading it again. */
export function tryAddRustSmallSet(set: object, key: number): Float64Array | undefined {
	if (!registeredModule || typeof key !== 'number') { return undefined; }
	const shape = setShape(set);
	if (!shape) { return undefined; }
	const result = registeredModule.small_set_add(shape.word, key, shape.additional.length, (_second, index) => readWord(shape.additional, index, false));
	if (result === undefined) { return undefined; }
	if (!(result instanceof Float64Array) || result.length < 3 || result.length > 262147 || (result[1] !== 0 && result[1] !== 1) || (result[2] !== 0 && result[2] !== 1) || (result[2] === 1 && result.length !== 3) || (result[1] === 1 && result[2] !== 1)) { throw new Error('The Rust small set add result does not match the bracket identifier contract'); }
	return result;
}

/** Complete merges retain trailing zero words and leave object/cache selection to the original API. */
export function tryMergeRustSmallSet(first: object, second: object): Float64Array | undefined {
	if (!registeredModule) { return undefined; }
	const left = setShape(first);
	const right = setShape(second);
	if (!left || !right) { return undefined; }
	const result = registeredModule.small_set_merge(left.word, right.word, left.additional.length, right.additional.length, (second, index) => readWord(second ? right.additional : left.additional, index, true));
	if (result !== undefined && (!(result instanceof Float64Array) || result.length !== Math.max(left.additional.length, right.additional.length) + 1)) { throw new Error('The Rust small set merge result does not match the bracket identifier contract'); }
	return result;
}

/** Membership, intersection, and equality preflight only the original required words. */
export function tryQueryRustSmallSet(first: object, second: object | undefined, key: number, operation: number): boolean | undefined {
	if (!registeredModule || typeof key !== 'number') { return undefined; }
	const left = setShape(first);
	const right = second === undefined ? left : setShape(second);
	if (!left || !right) { return undefined; }
	const result = registeredModule.small_set_query(operation, left.word, right.word, key, left.additional.length, right.additional.length, (second, index) => readWord(second ? right.additional : left.additional, index, operation !== 2));
	if (result !== undefined && typeof result !== 'boolean') { throw new Error('The Rust small set query result does not match the bracket identifier contract'); }
	return result;
}

/** Weak membership precedes reflection so unsupported receiver/array proxies retain original traps. */
function setShape(set: object): ISetShape | undefined {
	const prototype = standardSets.get(set);
	if (!prototype || Object.getPrototypeOf(set) !== prototype || !unchangedMethods()) { return undefined; }
	const word = Object.getOwnPropertyDescriptor(set, 'items');
	const additional = Object.getOwnPropertyDescriptor(set, 'additionalItems');
	if (!word || !additional || !Object.hasOwn(word, 'value') || !Object.hasOwn(additional, 'value') || typeof word.value !== 'number' || !standardItems.has(additional.value) || Object.getPrototypeOf(additional.value) !== Array.prototype || Object.hasOwn(additional.value, 'slice') || Object.hasOwn(additional.value, 'constructor') || additional.value.length > 262144) { return undefined; }
	return { word: word.value, additional: additional.value };
}

/** Missing/inherited or accessor slots retain original fallback where equality or copying observes them. */
function readWord(items: readonly number[], index: number, missingAsZero: boolean): number | undefined {
	const key = String(index);
	const slot = Object.getOwnPropertyDescriptor(items, key);
	if (!slot) {
		if (!missingAsZero || Object.hasOwn(Array.prototype, key) || Object.hasOwn(Object.prototype, key)) { return undefined; }
		return 0;
	}
	return Object.hasOwn(slot, 'value') && typeof slot.value === 'number' ? slot.value : undefined;
}

/** Preserves overridden array and loop-limit callbacks without reading their accessors. */
function unchangedMethods(): boolean {
	for (let index = 0; index < standardMethods.length; index++) {
		const { target, name, descriptor } = standardMethods[index];
		const current = Object.getOwnPropertyDescriptor(target, name);
		if (current?.value !== descriptor?.value || current?.get !== descriptor?.get) { return false; }
	}
	return true;
}
