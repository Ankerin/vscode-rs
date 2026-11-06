/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ArrayQueue } from '../../../../../base/common/arrays.js';
import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import type { Length } from './length.js';

/** Prepared mappings retain original provider traversal before entering the composition kernel. */
export interface IRustBracketLengthMapping {
	readonly modified: boolean;
	readonly lengthBefore: Length | undefined;
	readonly lengthAfter: Length | undefined;
}

/** Queued bracket-tree edit composition beneath the existing edit information API. */
export interface IRustBracketEditsModule {
	bracket_edits_abi_version(): number;
	combine_bracket_edits(first: Float64Array, second: Float64Array): Float64Array | undefined;
}

let registeredModule: IRustBracketEditsModule | undefined;
const standardMethods = [
	{ target: Array.prototype, names: ['push', 'unshift', 'slice', 'reduce', 'constructor', Symbol.iterator] },
	{ target: Array, names: [Symbol.species] },
	{ target: Math, names: ['floor'] },
	{ target: Object.getPrototypeOf([][Symbol.iterator]()), names: ['next'] },
	{ target: ArrayQueue.prototype, names: ['dequeue', 'takeWhile'] }
].flatMap(({ target, names }) => names.map(name => ({ target, name, descriptor: Object.getOwnPropertyDescriptor(target, name) })));

/** Installs bracket edit composition for the initialized editor core's disposable lifetime. */
export function registerRustBracketEdits(module: IRustBracketEditsModule): IDisposable {
	if (typeof module.bracket_edits_abi_version !== 'function' || module.bracket_edits_abi_version() !== 1 || typeof module.combine_bracket_edits !== 'function') { throw new Error('The Rust bracket edit bindings do not match the current composition contract'); }
	if (registeredModule) { throw new Error('A Rust bracket edit module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Composes already prepared mappings without reading caller edits or invoking their providers twice. */
export function tryCombineRustBracketMappings(first: readonly IRustBracketLengthMapping[], second: readonly IRustBracketLengthMapping[], isStandard: (mapping: IRustBracketLengthMapping) => boolean): Float64Array | undefined {
	if (!registeredModule || first.length + second.length - 1 > 262144) { return undefined; }
	for (let index = 0; index < standardMethods.length; index++) {
		const { target, name, descriptor } = standardMethods[index];
		const current = Object.getOwnPropertyDescriptor(target, name);
		if (current?.value !== descriptor?.value || current?.get !== descriptor?.get) { return undefined; }
	}
	const firstPacket = encodeMappings(first, first.length, isStandard);
	const secondPacket = encodeMappings(second, second.length - 1, isStandard);
	if (!firstPacket || !secondPacket) { return undefined; }
	const result = registeredModule.combine_bracket_edits(firstPacket, secondPacket);
	if (result === undefined) { return undefined; }
	if (!(result instanceof Float64Array) || result.length % 4 !== 0 || result.length > 4 * 262144) { throw new Error('The Rust bracket edit result does not match the composition contract'); }
	for (let index = 0; index < result.length; index += 4) {
		for (let field = 0; field < 3; field++) {
			if (!Number.isFinite(result[index + field]) || result[index + field] < 0) { throw new Error('The Rust bracket edit result does not match the composition contract'); }
		}
		if (result[index + 3] !== 0 && result[index + 3] !== 1) { throw new Error('The Rust bracket edit result does not match the composition contract'); }
	}
	return result;
}

/** Own descriptors retain callback-installed mappings and coercion on the prepared fallback path. */
function encodeMappings(mappings: readonly IRustBracketLengthMapping[], count: number, isStandard: (mapping: IRustBracketLengthMapping) => boolean): Float64Array | undefined {
	const result = new Float64Array(count * 3);
	for (let index = 0; index < count; index++) {
		const slot = Object.getOwnPropertyDescriptor(mappings, String(index));
		if (!slot || !Object.hasOwn(slot, 'value') || !isStandard(slot.value) || Object.hasOwn(slot.value, 'splitAt')) { return undefined; }
		const modified = Object.getOwnPropertyDescriptor(slot.value, 'modified');
		const before = Object.getOwnPropertyDescriptor(slot.value, 'lengthBefore');
		const after = Object.getOwnPropertyDescriptor(slot.value, 'lengthAfter');
		if (!modified || !before || !after || !Object.hasOwn(modified, 'value') || !Object.hasOwn(before, 'value') || !Object.hasOwn(after, 'value') || typeof modified.value !== 'boolean' || typeof before.value !== 'number' || typeof after.value !== 'number' || !Number.isSafeInteger(before.value) || !Number.isSafeInteger(after.value) || before.value < 0 || after.value < 0 || before.value > 2 ** 52 || after.value > 2 ** 52 || (!modified.value && before.value !== after.value)) { return undefined; }
		result[index * 3] = modified.value ? 1 : 0;
		result[index * 3 + 1] = before.value;
		result[index * 3 + 2] = after.value;
	}
	return result;
}
