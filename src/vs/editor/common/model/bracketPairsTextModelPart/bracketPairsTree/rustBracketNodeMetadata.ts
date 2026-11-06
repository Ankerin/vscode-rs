/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { IBracketNativeProperties, bracketNumberDescriptor, createBracketPropertyAccess, mergeBracketNumberDescriptor } from './bracketNumericProperties.js';

/** Native properties retain primitive payloads or handles into a collector-visible host anchor table. */
interface IRustBracketNodeMetadata extends IBracketNativeProperties {
	has(index: number): boolean;
	free(): void;
}

/** Owning AST scalar metadata bindings share the core registration's atomic lifetime. */
export interface IRustBracketNodeMetadataModule {
	bracket_node_metadata_abi_version(): number;
	bracket_node_metadata_live_count(): number;
	WasmBracketNodeMetadata: { new(fieldCount: number): IRustBracketNodeMetadata };
}

let registeredModule: IRustBracketNodeMetadataModule | undefined;
const ownedStateReleases = new WeakMap<object, () => void>();
const fieldNames = ['_length', 'listHeight', 'cachedMinIndentation', 'openingBracket', 'child', 'closingBracket', 'missingOpeningBracketIds', '_missingOpeningBracketIds', '_item1', '_item2', '_item3', 'bracketInfo', 'bracketIds', '_children'] as const;

/** Model fields are installed through the facade before services and callbacks capture it. */
export const rustTextModelStateFields = ['_store', '_onWillDispose', 'onWillDispose', '_onDidChangeDecorations', 'onDidChangeDecorations', '_onDidChangeOptions', '_onDidChangeAttached', '_onDidChangeLineHeight', '_onDidChangeFont', '_eventEmitter', 'id', 'isForSimpleWidget', '_associatedResource', '_attachedEditorCount', '_buffer', '_bufferDisposable', '_options', '_languageSelectionListener', '_isDisposed', '__isDisposing', '_versionId', '_alternativeVersionId', '_initialUndoRedoSnapshot', '_isTooLargeForSyncing', '_isTooLargeForTokenization', '_isTooLargeForHeapOperation', '_commandManager', '_isUndoing', '_isRedoing', '_trimAutoWhitespaceLines', '_instanceId', '_deltaDecorationCallCnt', '_lastDecorationId', '_decorations', '_decorationsTree', '_decorationProvider', '_fontTokenDecorationsProvider', '_tokenizationTextModelPart', '_bracketPairs', '_guidesTextModelPart', '_attachedViews', '_viewModels', '_undoRedoService', '_languageService', '_languageConfigurationService', 'instantiationService'] as const;

/** Scalar state schemas preserve each subsystem's existing field names and source shape. */
export const enum RustBracketNumericStateKind {
	PositionMapper,
	NodeReader,
	EditInfo,
	Parser,
	TextBufferTokenizer,
	NonPeekableTokenizer,
	FastTokenizer,
	Token,
	SmallSet,
	BracketTokens,
	EditCache,
	SearchParams,
	Searcher,
	ModelSnapshot,
	ModelOptions,
	TextModel,
	ModelContentEmitter
}

const stateFieldNames: readonly (readonly string[])[] = [
	['nextEditIdx', 'deltaOldToNewLineCount', 'deltaOldToNewColumnCount', 'deltaLineIdxInOld', 'edits'],
	['lastOffset', 'nextNodes', 'offsets', 'idxs'],
	['startOffset', 'endOffset', 'newLength'],
	['_itemsConstructed', '_itemsFromCache', 'createImmutableLists', 'tokenizer', 'oldNodeReader', 'positionMapper'],
	['textBufferLineCount', 'textBufferLastLineLength', '_offset', 'didPeek', 'peeked', 'textModel', 'bracketTokens', 'reader'],
	['textBufferLineCount', 'textBufferLastLineLength', 'lineIdx', 'lineCharOffset', 'lineTokenOffset', 'line', 'peekedToken', 'textModel', 'bracketTokens', 'lineTokens'],
	['_offset', 'idx', 'length', 'text', 'tokens'],
	['length', 'kind', 'bracketId', 'bracketIds', 'astNode'],
	['items', 'additionalItems'],
	['hasRegExp', '_regExpGlobal', 'map'],
	['endOffsetBeforeObj', 'endOffsetAfterObj', 'offsetObj'],
	['searchString', 'isRegex', 'matchCase', 'wordSeparators'],
	['_wordSeparators', '_searchRegex', '_prevMatchStartIndex', '_prevMatchLength'],
	['_source', '_eos'],
	['tabSize', 'indentSize', '_indentSizeIsTabSize', 'insertSpaces', 'defaultEOL', 'trimAutoWhitespace', 'bracketPairColorizationOptions'],
	rustTextModelStateFields,
	['_store', '_emitter', 'event', '_deferredCnt', '_deferredEvent']
];

/** Installs ownership for subsequently constructed AST nodes; existing nodes retain their owners. */
export function registerRustBracketNodeMetadata(module: IRustBracketNodeMetadataModule): IDisposable {
	if (typeof module.bracket_node_metadata_abi_version !== 'function' || module.bracket_node_metadata_abi_version() !== 5 || typeof module.bracket_node_metadata_live_count !== 'function' || typeof module.WasmBracketNodeMetadata !== 'function') {
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

/** Transfers configurable AST data properties while preserving the original descriptor protocol. */
export function ownRustBracketNodeMetadata<T extends object>(node: T): T {
	return ownRustBracketNumbers(node, fieldNames);
}

/** Transfers live parser/tokenizer state and reference handles through the same property contract. */
export function ownRustBracketNumericState<T extends object>(state: T, kind: RustBracketNumericStateKind): T {
	return ownRustBracketNumbers(state, stateFieldNames[kind]);
}

/** Releases native state without changing the original extensibility or property descriptors. */
export function releaseRustBracketNumericState(state: object): void {
	ownedStateReleases.get(state)?.();
	ownedStateReleases.delete(state);
}

/** Shares descriptor compatibility while each subsystem retains its own native scalar record. */
function ownRustBracketNumbers<T extends object>(node: T, fieldNames: readonly string[]): T {
	if (!registeredModule) {
		return node;
	}
	const order = Reflect.ownKeys(node);
	let record: IRustBracketNodeMetadata | undefined = new registeredModule.WasmBracketNodeMetadata(fieldNames.length);
	if (typeof record.has !== 'function' || typeof record.get !== 'function' || typeof record.attributes !== 'function' || typeof record.define !== 'function' || typeof record.reference !== 'function' || typeof record.define_reference !== 'function' || typeof record.remove !== 'function' || typeof record.free !== 'function') {
		record.free?.();
		throw new Error('The Rust bracket node metadata record does not match the owning AST contract');
	}
	const properties = createBracketPropertyAccess(record);
	const indexOf = (key: string | symbol) => typeof key === 'string' ? fieldNames.findIndex(name => name === key) : -1;
	const descriptorOf = (key: string | symbol): PropertyDescriptor | undefined => {
		const index = indexOf(key);
		if (!record || index < 0 || !record.has(index)) {
			return Reflect.getOwnPropertyDescriptor(node, key);
		}
		return bracketNumberDescriptor(properties, index);
	};
	const transferred: { key: string; descriptor: PropertyDescriptor }[] = [];
	let deleted = 0;
	try {
		for (let index = 0; index < fieldNames.length; index++) {
			const key = fieldNames[index];
			const descriptor = Reflect.getOwnPropertyDescriptor(node, key);
			if (descriptor?.configurable && Object.hasOwn(descriptor, 'value')) {
				properties.define(index, descriptor);
				transferred.push({ key, descriptor });
			}
		}
		for (const { key } of transferred) {
			if (!Reflect.deleteProperty(node, key)) {
				throw new Error('Cannot transfer the Rust bracket scalar property');
			}
			deleted++;
		}
	} catch (error) {
		for (const { key, descriptor } of transferred.slice(0, deleted)) {
			Reflect.defineProperty(node, key, descriptor);
		}
		record.free();
		throw error;
	}
	const materialize = () => {
		if (record) {
			for (const key of fieldNames) {
				const index = indexOf(key);
				if (record.has(index)) {
					Reflect.defineProperty(node, key, descriptorOf(key)!);
				}
			}
			record.free();
			record = undefined;
			properties.clearReferences();
		}
	};
	const facade = new Proxy(node, {
		get: (target, key, receiver) => {
			const index = indexOf(key);
			return record && index >= 0 && record.has(index) ? properties.get(index) : Reflect.get(target, key, receiver);
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
				if (next.configurable && Object.hasOwn(next, 'value')) {
					properties.define(index, next);
					Reflect.deleteProperty(target, key);
				} else {
					if (!Reflect.defineProperty(target, key, next)) {
						return false;
					}
					properties.remove(index);
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
				properties.remove(index);
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
			materialize();
			return Reflect.preventExtensions(target);
		}
	});
	ownedStateReleases.set(facade, materialize);
	return facade;
}
