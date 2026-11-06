/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { bracketNumberDescriptor, mergeBracketNumberDescriptor } from './bracketNumericProperties.js';

/** Native numeric fields do not retain facade/child references or introduce graph ownership cycles. */
interface IRustBracketNodeMetadata {
	has(index: number): boolean;
	get(index: number): number;
	attributes(index: number): number;
	define(index: number, value: number, writable: boolean, enumerable: boolean): void;
	remove(index: number): void;
	free(): void;
}

/** Owning AST scalar metadata bindings share the core registration's atomic lifetime. */
export interface IRustBracketNodeMetadataModule {
	bracket_node_metadata_abi_version(): number;
	bracket_node_metadata_live_count(): number;
	WasmBracketNodeMetadata: { new(): IRustBracketNodeMetadata };
}

let registeredModule: IRustBracketNodeMetadataModule | undefined;
const fieldNames = ['_length', 'listHeight', 'cachedMinIndentation'] as const;

/** Numeric state schemas preserve each subsystem's existing field names and source shape. */
export const enum RustBracketNumericStateKind {
	PositionMapper,
	NodeReader,
	EditInfo,
	Parser,
	TextBufferTokenizer,
	NonPeekableTokenizer,
	FastTokenizer,
	Token,
	SmallSet
}

const stateFieldNames: readonly (readonly string[])[] = [
	['nextEditIdx', 'deltaOldToNewLineCount', 'deltaOldToNewColumnCount', 'deltaLineIdxInOld'],
	['lastOffset'],
	['startOffset', 'endOffset', 'newLength'],
	['_itemsConstructed', '_itemsFromCache'],
	['textBufferLineCount', 'textBufferLastLineLength', '_offset'],
	['textBufferLineCount', 'textBufferLastLineLength', 'lineIdx', 'lineCharOffset', 'lineTokenOffset'],
	['_offset', 'idx', 'length'],
	['length', 'kind', 'bracketId'],
	['items']
];

/** Installs ownership for subsequently constructed AST nodes; existing nodes retain their owners. */
export function registerRustBracketNodeMetadata(module: IRustBracketNodeMetadataModule): IDisposable {
	if (typeof module.bracket_node_metadata_abi_version !== 'function' || module.bracket_node_metadata_abi_version() !== 2 || typeof module.bracket_node_metadata_live_count !== 'function' || typeof module.WasmBracketNodeMetadata !== 'function') {
		throw new Error('The Rust bracket node metadata bindings do not match the owning AST contract');
	}
	if (registeredModule) {
		throw new Error('A Rust bracket node metadata module is already registered');
	}
	registeredModule = module;
	return toDisposable(() => {
		if (registeredModule === module) {
			registeredModule = undefined;
		}
	});
}

/** Transfers configurable numeric data properties while preserving the original descriptor protocol. */
export function ownRustBracketNodeMetadata<T extends object>(node: T): T {
	return ownRustBracketNumbers(node, fieldNames);
}

/** Transfers live parser/tokenizer counters and coordinates through the same property contract. */
export function ownRustBracketNumericState<T extends object>(state: T, kind: RustBracketNumericStateKind): T {
	return ownRustBracketNumbers(state, stateFieldNames[kind]);
}

/** Shares descriptor compatibility while each subsystem retains its own native scalar record. */
function ownRustBracketNumbers<T extends object>(node: T, fieldNames: readonly string[]): T {
	if (!registeredModule) {
		return node;
	}
	let record: IRustBracketNodeMetadata | undefined = new registeredModule.WasmBracketNodeMetadata();
	if (typeof record.has !== 'function' || typeof record.get !== 'function' || typeof record.attributes !== 'function' || typeof record.define !== 'function' || typeof record.remove !== 'function' || typeof record.free !== 'function') {
		record.free?.();
		throw new Error('The Rust bracket node metadata record does not match the owning AST contract');
	}
	const order = Reflect.ownKeys(node);
	const indexOf = (key: string | symbol) => typeof key === 'string' ? fieldNames.findIndex(name => name === key) : -1;
	const descriptorOf = (key: string | symbol): PropertyDescriptor | undefined => {
		const index = indexOf(key);
		if (!record || index < 0 || !record.has(index)) {
			return Reflect.getOwnPropertyDescriptor(node, key);
		}
		return bracketNumberDescriptor(record, index);
	};
	try {
		for (let index = 0; index < fieldNames.length; index++) {
			const key = fieldNames[index];
			const descriptor = Reflect.getOwnPropertyDescriptor(node, key);
			if (descriptor?.configurable && typeof descriptor.value === 'number') {
				record.define(index, descriptor.value, !!descriptor.writable, !!descriptor.enumerable);
				Reflect.deleteProperty(node, key);
			}
		}
	} catch (error) {
		record.free();
		throw error;
	}
	return new Proxy(node, {
		get: (target, key, receiver) => {
			const index = indexOf(key);
			return record && index >= 0 && record.has(index) ? record.get(index) : Reflect.get(target, key, receiver);
		},
		has: (target, key) => {
			const index = indexOf(key);
			return !!(record && index >= 0 && record.has(index)) || Reflect.has(target, key);
		},
		getOwnPropertyDescriptor: (_target, key) => descriptorOf(key),
		defineProperty: (target, key, descriptor) => {
			const index = indexOf(key);
			const current = descriptorOf(key);
			if (!current && !Reflect.isExtensible(target)) {
				return false;
			}
			if (record && index >= 0) {
				const next = mergeBracketNumberDescriptor(key, current, descriptor);
				if (!next) {
					return false;
				}
				if (next.configurable && typeof next.value === 'number') {
					record.define(index, next.value, !!next.writable, !!next.enumerable);
					Reflect.deleteProperty(target, key);
				} else {
					if (!Reflect.defineProperty(target, key, next)) {
						return false;
					}
					record.remove(index);
				}
			} else if (!Reflect.defineProperty(target, key, descriptor)) {
				return false;
			}
			if (!current) {
				order.push(key);
			}
			return true;
		},
		set: (target, key, value, receiver) => {
			const index = indexOf(key);
			if (!record || index < 0 || !record.has(index)) {
				return Reflect.set(target, key, value, receiver);
			}
			// Ordinary [[Set]] retains receiver descriptor checks and overridden proxy traps.
			const property = Object.create(null) as object;
			Reflect.defineProperty(property, key, descriptorOf(key)!);
			return Reflect.set(property, key, value, receiver);
		},
		deleteProperty: (target, key) => {
			const index = indexOf(key);
			if (record && index >= 0 && record.has(index)) {
				record.remove(index);
			} else if (!Reflect.deleteProperty(target, key)) {
				return false;
			}
			const position = order.indexOf(key);
			if (position >= 0) {
				order.splice(position, 1);
			}
			return true;
		},
		ownKeys: () => {
			const indices = order.filter((key): key is string => typeof key === 'string' && String(Number(key)) === key && Number.isInteger(Number(key)) && Number(key) >= 0 && Number(key) < 0xFFFFFFFF).sort((a, b) => Number(a) - Number(b));
			return [...indices, ...order.filter(key => typeof key === 'string' && !indices.includes(key)), ...order.filter(key => typeof key === 'symbol')];
		},
		preventExtensions: target => {
			// Nonconfigurable/nonextensible proxy invariants require real target properties.
			if (record) {
				for (const key of fieldNames) {
					const index = indexOf(key);
					if (record.has(index)) {
						Reflect.defineProperty(target, key, descriptorOf(key)!);
					}
				}
				record.free();
				record = undefined;
			}
			return Reflect.preventExtensions(target);
		}
	});
}
