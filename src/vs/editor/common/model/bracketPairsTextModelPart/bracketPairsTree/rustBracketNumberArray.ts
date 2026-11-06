/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { bracketNumberDescriptor, mergeBracketNumberDescriptor } from './bracketNumericProperties.js';

/** Numeric payloads retain holes and attributes while the host enforces array-length invariants. */
interface IRustBracketNumberArray {
	prepare(index: number): boolean;
	has(index: number): boolean;
	get(index: number): number;
	attributes(index: number): number;
	define(index: number, value: number, writable: boolean, enumerable: boolean): void;
	remove(index: number): void;
	truncate(length: number): void;
	indices(): Uint32Array;
	free(): void;
}

/** Generated owning reader-stack bindings are registered atomically with the editor core. */
export interface IRustBracketNumberArrayModule {
	bracket_number_array_abi_version(): number;
	bracket_number_array_live_count(): number;
	WasmBracketNumberArray: { new(): IRustBracketNumberArray };
}

let registeredModule: IRustBracketNumberArrayModule | undefined;

/** Installs ownership for fresh internal arrays; retained stacks keep their initialized module. */
export function registerRustBracketNumberArray(module: IRustBracketNumberArrayModule): IDisposable {
	if (typeof module.bracket_number_array_abi_version !== 'function' || module.bracket_number_array_abi_version() !== 1 || typeof module.bracket_number_array_live_count !== 'function' || typeof module.WasmBracketNumberArray !== 'function') {
		throw new Error('The Rust bracket number array bindings do not match the owning stack contract');
	}
	if (registeredModule) { throw new Error('A Rust bracket number array module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Recognizes canonical array indices without changing caller-visible string or symbol keys. */
function arrayIndex(key: string | symbol): number | undefined {
	if (typeof key !== 'string' || key.length === 0) { return undefined; }
	const index = Number(key);
	return String(index) === key && Number.isInteger(index) && index >= 0 && index < 0xFFFFFFFF ? index : undefined;
}

/** Transfers a fresh reader stack before its first alias escapes; its facade remains a real array. */
export function ownRustBracketNumberArray<T>(array: T[]): T[] {
	if (!registeredModule) { return array; }
	let record: IRustBracketNumberArray | undefined = new registeredModule.WasmBracketNumberArray();
	if (typeof record.prepare !== 'function' || typeof record.has !== 'function' || typeof record.get !== 'function' || typeof record.attributes !== 'function' || typeof record.define !== 'function' || typeof record.remove !== 'function' || typeof record.truncate !== 'function' || typeof record.indices !== 'function' || typeof record.free !== 'function') {
		record.free?.();
		throw new Error('The Rust bracket number array record does not match the owning stack contract');
	}
	const descriptorOf = (key: string | symbol): PropertyDescriptor | undefined => {
		const index = arrayIndex(key);
		return record && index !== undefined && record.has(index) ? bracketNumberDescriptor(record, index) : Reflect.getOwnPropertyDescriptor(array, key);
	};
	try {
		const entries: { key: string; index: number; descriptor: PropertyDescriptor }[] = [];
		for (const key of Reflect.ownKeys(array)) {
			const index = arrayIndex(key);
			const descriptor = Reflect.getOwnPropertyDescriptor(array, key)!;
			if (typeof key === 'string' && index !== undefined && descriptor.configurable && typeof descriptor.value === 'number' && record.prepare(index)) {
				entries.push({ key, index, descriptor });
			}
		}
		for (const { index, descriptor } of entries) {
			record.define(index, descriptor.value, !!descriptor.writable, !!descriptor.enumerable);
		}
		for (const { key } of entries) { Reflect.deleteProperty(array, key); }
	} catch (error) { record.free(); throw error; }
	return new Proxy(array, {
		get: (target, key, receiver) => {
			const index = arrayIndex(key);
			return record && index !== undefined && record.has(index) ? record.get(index) : Reflect.get(target, key, receiver);
		},
		has: (target, key) => {
			const index = arrayIndex(key);
			return !!(record && index !== undefined && record.has(index)) || Reflect.has(target, key);
		},
		getOwnPropertyDescriptor: (_target, key) => descriptorOf(key),
		defineProperty: (target, key, descriptor) => {
			if (key === 'length') {
				const result = Reflect.defineProperty(target, key, descriptor);
				record?.truncate(target.length);
				return result;
			}
			const index = arrayIndex(key);
			if (!record || index === undefined) { return Reflect.defineProperty(target, key, descriptor); }
			const current = descriptorOf(key);
			if (!current && !Reflect.isExtensible(target)) { return false; }
			const next = mergeBracketNumberDescriptor(key, current, descriptor);
			if (!next) { return false; }
			if (next.configurable && typeof next.value === 'number') {
				if (index >= target.length && !Reflect.getOwnPropertyDescriptor(target, 'length')!.writable) { return false; }
				if (record.prepare(index)) {
					if (index >= target.length && !Reflect.defineProperty(target, 'length', { value: index + 1 })) { return false; }
					record.define(index, next.value, !!next.writable, !!next.enumerable);
					Reflect.deleteProperty(target, key);
					return true;
				}
			}
			if (!Reflect.defineProperty(target, key, next)) { return false; }
			record.remove(index);
			return true;
		},
		set: (target, key, value, receiver) => {
			const index = arrayIndex(key);
			if (!record || index === undefined || !record.has(index)) { return Reflect.set(target, key, value, receiver); }
			const property = Object.create(null) as object;
			Reflect.defineProperty(property, key, descriptorOf(key)!);
			return Reflect.set(property, key, value, receiver);
		},
		deleteProperty: (target, key) => {
			const index = arrayIndex(key);
			if (record && index !== undefined && record.has(index)) { record.remove(index); return true; }
			return Reflect.deleteProperty(target, key);
		},
		ownKeys: target => {
			const keys = Reflect.ownKeys(target);
			if (!record) { return keys; }
			const indices = [...Array.from(record.indices()), ...keys.flatMap(key => { const index = arrayIndex(key); return index === undefined ? [] : [index]; })].sort((a, b) => a - b);
			return [...indices.map(String), ...keys.filter(key => arrayIndex(key) === undefined)];
		},
		preventExtensions: target => {
			if (record) {
				for (const index of record.indices()) { Reflect.defineProperty(target, String(index), bracketNumberDescriptor(record, index)); }
				record.free();
				record = undefined;
			}
			return Reflect.preventExtensions(target);
		}
	});
}
