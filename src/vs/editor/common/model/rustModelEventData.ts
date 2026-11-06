/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import type { IModelContentChange } from './mirrorTextModel.js';
import type { IModelContentChangedEvent, InternalModelContentChangeEvent, ModelRawChange, ModelRawContentChangedEvent } from '../textModelEvents.js';
import type { TextModelEditSource } from '../textModelEditSource.js';
import { ownRustBracketNumericState, RustBracketNumericStateKind } from './bracketPairsTextModelPart/bracketPairsTree/rustBracketNodeMetadata.js';

/** Event data operations share the atomic core registration lifetime. */
export const enum RustModelEventDataOperation { RawMerge = 0, ContentMerge = 1, InternalMerge = 2, Contains = 3 }
export const rustModelEventDataFields = ['changes', 'versionId', 'isUndoing', 'isRedoing', 'eol', 'isFlush', 'isEolChange', 'detailedReasons', 'detailedReasonsChangeLengths'] as const;
export type RustModelEventArray = (ModelRawChange | IModelContentChange | TextModelEditSource | number)[];
export type RustModelEventValue = RustModelEventArray | ModelRawContentChangedEvent | IModelContentChangedEvent | InternalModelContentChangeEvent | number | boolean | string;
export type RustModelEventConcat = (incoming: RustModelEventArray) => RustModelEventArray;
export type RustModelEventMerge = (first: RustModelEventValue, second: RustModelEventValue) => RustModelEventValue;

/** Raw records share their original field shapes while owning their native slots. */
export const enum RustRawModelChangeKind { TypeOnly, Line, Deleted, Inserted }

/** Endpoint fields are observed before JavaScript addition/subtraction coercions. */
export interface IRustInsertedModelLineEndHost {
	start(): number;
	count(): number;
	add(start: number, count: number): number;
	minusOne(value: number): number;
}

/** Original methods and aliases preserve callback lookup before argument property reads. */
export interface IRustModelEventDataHost {
	get(event: ModelRawContentChangedEvent | IModelContentChangedEvent, index: number): RustModelEventValue;
	empty(): RustModelEventArray;
	concatMethod(array: RustModelEventArray): RustModelEventConcat;
	concat(method: RustModelEventConcat, input: RustModelEventArray): RustModelEventArray;
	raw(changes: RustModelEventArray, version: number, undo: boolean, redo: boolean): ModelRawContentChangedEvent;
	content(changes: RustModelEventArray, eol: string, eolChange: boolean, version: number, undo: boolean, redo: boolean, flush: boolean, reasons: RustModelEventArray, lengths: RustModelEventArray): IModelContentChangedEvent;
	mergeMethod(raw: boolean): RustModelEventMerge;
	internalField(event: InternalModelContentChangeEvent, raw: boolean): ModelRawContentChangedEvent | IModelContentChangedEvent;
	merge(method: RustModelEventMerge, first: RustModelEventValue, second: RustModelEventValue): RustModelEventValue;
	internal(raw: ModelRawContentChangedEvent, content: IModelContentChangedEvent): InternalModelContentChangeEvent;
	length(array: RustModelEventArray): number;
	less(index: number, length: number): boolean;
	changeType(event: ModelRawContentChangedEvent, index: number): number;
}

/** Generated bindings retain existing event and boolean result shapes. */
export interface IRustModelEventDataModule {
	model_event_data_abi_version(): number;
	inserted_model_line_end(host: IRustInsertedModelLineEndHost): number;
	run_model_event_data(host: IRustModelEventDataHost, operation: RustModelEventDataOperation, first: RustModelEventValue, second: RustModelEventValue): ModelRawContentChangedEvent | IModelContentChangedEvent | InternalModelContentChangeEvent | boolean;
}

let registeredModule: IRustModelEventDataModule | undefined;

/** Rejects stale bindings before enabling event representation and merge control. */
export function registerRustModelEventData(module: IRustModelEventDataModule): IDisposable {
	if (typeof module.model_event_data_abi_version !== 'function' || module.model_event_data_abi_version() !== 2 || typeof module.run_model_event_data !== 'function' || typeof module.inserted_model_line_end !== 'function') { throw new Error('The Rust model event data bindings do not match the merge contract'); }
	if (registeredModule) { throw new Error('A Rust model event data module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Distinguishes unavailable control from original false/event results. */
export function tryRustModelEventData<T extends ModelRawContentChangedEvent | IModelContentChangedEvent | InternalModelContentChangeEvent | boolean>(operation: RustModelEventDataOperation, first: RustModelEventValue, second: RustModelEventValue, createHost: () => IRustModelEventDataHost): { value: T } | undefined {
	if (!registeredModule) { return undefined; }
	return { value: registeredModule.run_model_event_data(createHost(), operation, first, second) as T };
}

/** Transfers fresh raw event fields without changing their externally supplied array identity. */
export function ownRustRawModelEvent<T extends object>(event: T): T { return ownRustBracketNumericState(event, RustBracketNumericStateKind.ModelRawEvent); }

/** Transfers fresh internal event fields without replacing externally supplied content/raw objects. */
export function ownRustInternalModelEvent<T extends object>(event: T): T { return ownRustBracketNumericState(event, RustBracketNumericStateKind.ModelInternalEvent); }

/** Fresh product-owned content change objects retain their original plain-object descriptors. */
export function ownRustModelContentData<T extends object>(event: T): T { return ownRustBracketNumericState(event, RustBracketNumericStateKind.ModelContentData); }

/** Fresh raw change records retain original prototypes, descriptors, and collector-visible values. */
export function ownRustRawModelChange<T extends object>(event: T, kind: RustRawModelChangeKind): T {
	const kinds = [RustBracketNumericStateKind.ModelRawType, RustBracketNumericStateKind.ModelRawLine, RustBracketNumericStateKind.ModelRawDeleted, RustBracketNumericStateKind.ModelRawInserted];
	return ownRustBracketNumericState(event, kinds[kind]);
}

/** Buffer application results retain caller-visible inverse-edit, change, and candidate arrays. */
export function ownRustModelEditResult<T extends object>(result: T): T { return ownRustBracketNumericState(result, RustBracketNumericStateKind.ModelEditResult); }

/** Distinguishes unavailable endpoint computation from any original numeric result. */
export function tryRustInsertedModelLineEnd(start: () => number, count: () => number): { value: number } | undefined {
	if (!registeredModule) { return undefined; }
	return { value: registeredModule.inserted_model_line_end({ start, count, add: (start, count) => start + count, minusOne: value => value - 1 }) };
}
