/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { IPosition } from '../core/position.js';
import { IRange, Range } from '../core/range.js';
import { ITextSnapshot } from '../model.js';
import { ResourceEditStackSnapshot } from '../../../platform/undoRedo/common/undoRedo.js';
import { IRustModelValidationHost } from './rustModelValidation.js';

/** Complete reading operations share the core registration lifetime. */
export const enum RustModelQueryOperation {
	Offset = 0,
	Position = 1,
	Value = 2,
	ValueLength = 3,
	RangeValue = 4,
	RangeLength = 5,
	CharacterCount = 6,
	LineCount = 7,
	LineContent = 8,
	LineLength = 9,
	Lines = 10,
	Eol = 11,
	EndSequence = 12,
	MinColumn = 13,
	MaxColumn = 14,
	FirstNonWhitespace = 15,
	LastNonWhitespace = 16,
	ModifyPosition = 17,
	FullRange = 18,
	DominatedByLongLines = 19,
	Snapshot = 20,
	Version = 21,
	AlternativeVersion = 22,
	InitialSnapshot = 23,
	Rtl = 24,
	UnusualTerminators = 25,
	NonBasicAscii = 26
}

/** Provider selection is stable within the model-query ABI. */
export const enum RustModelQueryMethod {
	FullRange = 0,
	ValueRange = 1,
	LengthRange = 2,
	LineCount = 3,
	Offset = 4,
	Position = 5,
	ValidateRange = 6,
	ValidatePosition = 7,
	TooLargeHeap = 8,
	TooLargeTokens = 9,
	MaxColumn = 10,
	BufferLength = 11,
	BufferOffset = 12,
	BufferPosition = 13,
	BufferBom = 14,
	BufferValueRange = 15,
	BufferLengthRange = 16,
	BufferCharacterCount = 17,
	BufferLineCount = 18,
	BufferLineContent = 19,
	BufferLineLength = 20,
	BufferLines = 21,
	BufferEol = 22,
	BufferFirstWhitespace = 23,
	BufferLastWhitespace = 24,
	BufferSnapshot = 25,
	BufferRtl = 26,
	BufferUnusualTerminators = 27,
	BufferNonBasicAscii = 28
}

/** Capturing a method retains its receiver before Rust evaluates inline arguments. */
export const rustModelQueryMethodNames = [
	'getFullModelRange',
	'getValueInRange',
	'getValueLengthInRange',
	'getLineCount',
	'getOffsetAt',
	'getPositionAt',
	'validateRange',
	'_validatePosition',
	'isTooLargeForHeapOperation',
	'isTooLargeForTokenization',
	'getLineMaxColumn',
	'getLength',
	'getOffsetAt',
	'getPositionAt',
	'getBOM',
	'getValueInRange',
	'getValueLengthInRange',
	'getCharacterCountInRange',
	'getLineCount',
	'getLineContent',
	'getLineLength',
	'getLinesContent',
	'getEOL',
	'getLineFirstNonWhitespaceColumn',
	'getLineLastNonWhitespaceColumn',
	'createSnapshot',
	'mightContainRTL',
	'mightContainUnusualLineTerminators',
	'mightContainNonBasicASCII'
] as const;

/** Borrowed results and arguments keep their existing public representation. */
export type RustModelQueryValue = number | string | boolean | IPosition | IRange | string[] | ITextSnapshot | ResourceEditStackSnapshot | null | undefined;
type QueryMethod = (...args: RustModelQueryValue[]) => RustModelQueryValue;

/** Live model and buffer capabilities preserve method identity, arity, and exceptions. */
export interface IRustModelQueryHost extends Pick<IRustModelValidationHost, 'coordinate' | 'compare'> {
	assertAlive(): void;
	fail(heap: boolean): never;
	method(method: RustModelQueryMethod): QueryMethod;
	call0(method: QueryMethod): RustModelQueryValue;
	call1(method: QueryMethod, first: RustModelQueryValue): RustModelQueryValue;
	call2(method: QueryMethod, first: RustModelQueryValue, second: RustModelQueryValue): RustModelQueryValue;
	call3(method: QueryMethod, first: RustModelQueryValue, second: RustModelQueryValue, third: RustModelQueryValue): RustModelQueryValue;
	add(first: number, second: number): number;
	boundOffset(length: number, offset: number): number;
	length(value: string): number;
	state(index: number): RustModelQueryValue;
	snapshot(source: ITextSnapshot): ITextSnapshot;
	range(count: number, maxColumn: number): Range;
}

/** Generated bindings return existing text, object, and scalar values. */
export interface IRustModelQueryModule {
	model_query_abi_version(): number;
	run_model_query(host: IRustModelQueryHost, operation: RustModelQueryOperation, first: RustModelQueryValue, second: RustModelQueryValue, preserveBOM: boolean): RustModelQueryValue;
}

let registeredModule: IRustModelQueryModule | undefined;

/** Installs read control atomically with the rest of the Rust core. */
export function registerRustModelQuery(module: IRustModelQueryModule): IDisposable {
	if (typeof module.model_query_abi_version !== 'function' || module.model_query_abi_version() !== 1 || typeof module.run_model_query !== 'function') {
		throw new Error('The Rust model query bindings do not match the reading contract');
	}
	if (registeredModule) { throw new Error('A Rust model query module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Distinguishes an unavailable implementation from an original null/undefined result. */
export function tryRustModelQuery<T extends RustModelQueryValue>(operation: RustModelQueryOperation, first: RustModelQueryValue, second: RustModelQueryValue, preserveBOM: boolean, createHost: () => IRustModelQueryHost): { value: T } | undefined {
	if (!registeredModule) { return undefined; }
	return { value: registeredModule.run_model_query(createHost(), operation, first, second, preserveBOM) as T };
}

