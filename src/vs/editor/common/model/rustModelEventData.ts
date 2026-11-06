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
	run_model_event_data(host: IRustModelEventDataHost, operation: RustModelEventDataOperation, first: RustModelEventValue, second: RustModelEventValue): ModelRawContentChangedEvent | IModelContentChangedEvent | InternalModelContentChangeEvent | boolean;
}

let registeredModule: IRustModelEventDataModule | undefined;

/** Rejects stale bindings before enabling event representation and merge control. */
export function registerRustModelEventData(module: IRustModelEventDataModule): IDisposable {
	if (typeof module.model_event_data_abi_version !== 'function' || module.model_event_data_abi_version() !== 1 || typeof module.run_model_event_data !== 'function') { throw new Error('The Rust model event data bindings do not match the merge contract'); }
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
