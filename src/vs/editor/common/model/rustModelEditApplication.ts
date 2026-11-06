/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import type { Selection } from '../core/selection.js';
import type { ApplyEditsResult, IInternalModelContentChange, IValidEditOperation, ValidAnnotatedEditOperation } from '../model.js';
import type { TextModelEditSource } from '../textModelEditSource.js';
import type { IModelContentChangedEvent, ModelRawChange, ModelRawContentChangedEvent } from '../textModelEvents.js';

type BufferMethod = (operations: ValidAnnotatedEditOperation[], trim: boolean, undo: boolean) => ApplyEditsResult;
type ReplaceMethod = (offset: number, deleted: number, inserted: number, markers: boolean) => void;
type EmitMethod = (raw: ModelRawContentChangedEvent, content: IModelContentChangedEvent, selection: Selection[] | null) => void;

/** Buffer, change, decoration, and event capabilities retain original live property observations. */
export interface IRustModelEditApplicationHost {
	lineCount(): number;
	bufferMethod(): BufferMethod;
	trim(): boolean;
	bufferApply(method: BufferMethod, operations: ValidAnnotatedEditOperation[], trim: boolean, undo: boolean): ApplyEditsResult;
	changes(result: ApplyEditsResult): IInternalModelContentChange[];
	trimLines(result: ApplyEditsResult): number[] | null;
	storeTrim(lines: number[] | null): void;
	length(value: string | readonly IInternalModelContentChange[]): number;
	less(index: number, length: number): boolean;
	change(changes: IInternalModelContentChange[], index: number): IInternalModelContentChange;
	replaceMethod(): ReplaceMethod;
	changeField(change: IInternalModelContentChange, index: number): number | string | boolean;
	replace(method: ReplaceMethod, offset: number, deleted: number, inserted: number, markers: boolean): void;
	rawChanges(): ModelRawChange[];
	increaseVersion(): void;
	eolCount(change: IInternalModelContentChange): number;
	decorationsFire(): void;
	rangeLine(change: IInternalModelContentChange, index: number): number;
	subtract(first: number, second: number): number;
	add(first: number, second: number): number;
	minimum(first: number, second: number): number;
	atLeastZero(value: number): boolean;
	decrement(value: number): number;
	below(first: number, second: number): boolean;
	rawChange(changes: ModelRawChange[], kind: number, first: number, second: number, third: number | undefined): void;
	emitMethod(): EmitMethod;
	rawMethod(): typeof ModelRawContentChangedEvent;
	version(): number;
	flag(index: number): boolean;
	rawEvent(method: typeof ModelRawContentChangedEvent, changes: ModelRawChange[], version: number, undo: boolean, redo: boolean): ModelRawContentChangedEvent;
	bufferEOL(): string;
	contentEvent(changes: IInternalModelContentChange[], eol: string, version: number, undo: boolean, redo: boolean, reason: TextModelEditSource, length: number): IModelContentChangedEvent;
	emit(method: EmitMethod, raw: ModelRawContentChangedEvent, content: IModelContentChangedEvent, selection: Selection[] | null): void;
	reverse(result: ApplyEditsResult): IValidEditOperation[] | null;
}

/** Generated change application returns the existing inverse-edit array or undefined. */
export interface IRustModelEditApplicationModule {
	model_edit_application_abi_version(): number;
	apply_model_edits(host: IRustModelEditApplicationHost, operations: ValidAnnotatedEditOperation[], undo: boolean, reason: TextModelEditSource, selection: Selection[] | null): void | IValidEditOperation[];
}
let registeredModule: IRustModelEditApplicationModule | undefined;

/** Rejects stale bindings before enabling model decoration/version/event application. */
export function registerRustModelEditApplication(module: IRustModelEditApplicationModule): IDisposable {
	if (typeof module.model_edit_application_abi_version !== 'function' || module.model_edit_application_abi_version() !== 1 || typeof module.apply_model_edits !== 'function') {
		throw new Error('The Rust model edit application bindings do not match the change contract');
	}
	if (registeredModule) { throw new Error('A Rust model edit application module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Distinguishes unavailable application from an original undefined inverse-edit result. */
export function tryRustModelEditApplication(operations: ValidAnnotatedEditOperation[], undo: boolean, reason: TextModelEditSource, selection: Selection[] | null, createHost: () => IRustModelEditApplicationHost): { value: void | IValidEditOperation[] } | undefined {
	if (!registeredModule) { return undefined; }
	return { value: registeredModule.apply_model_edits(createHost(), operations, undo, reason, selection) };
}
