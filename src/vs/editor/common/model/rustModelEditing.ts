/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import type { ResourceEditStackSnapshot, UndoRedoGroup } from '../../../platform/undoRedo/common/undoRedo.js';
import type { ISingleEditOperation } from '../core/editOperation.js';
import type { Position } from '../core/position.js';
import type { Range } from '../core/range.js';
import type { Selection } from '../core/selection.js';
import type { TextChange } from '../core/textChange.js';
import type { ICursorStateComputer, IIdentifiedSingleEditOperation, IValidEditOperation, ValidAnnotatedEditOperation } from '../model.js';
import type { TextModelEditSource } from '../textModelEditSource.js';

/** Transaction operations share original event/service lifetimes. */
export const enum RustModelEditingOperation { PushStack, PopStack, PushEOL, PushEdits, ApplyEdits, UndoEdits, RedoEdits, UndoRedoEdits, Undo, CanUndo, Redo, CanRedo }
type PushMethod = (before: Selection[] | null, operations: ValidAnnotatedEditOperation[], cursor: ICursorStateComputer | null, group?: UndoRedoGroup, reason?: TextModelEditSource) => Selection[] | null;
type ApplyMethod = (operations: ValidAnnotatedEditOperation[], undo: boolean, reason: TextModelEditSource, selection?: Selection[] | null) => void | IValidEditOperation[];
type PositionMethod = (offset: number) => Position;
type EditingValue = undefined | null | number | boolean | readonly IIdentifiedSingleEditOperation[] | TextChange[] | Selection[] | ICursorStateComputer | UndoRedoGroup | TextModelEditSource;
type EditingResult = void | boolean | Selection[] | null | IValidEditOperation[] | Promise<void>;

/** Captured private methods preserve lookup before validation, reason factories, and source getters. */
export interface IRustModelEditingHost {
	beginDecorations(): void;
	beginContent(): void;
	endContent(selection: Selection[] | null | undefined, present: boolean): void;
	endDecorations(): void;
	eol(): string;
	snapshot(): ResourceEditStackSnapshot | null;
	createSnapshot(): ResourceEditStackSnapshot;
	storeSnapshot(snapshot: ResourceEditStackSnapshot): void;
	commandEOL(eol: number): void;
	pushMethod(): PushMethod;
	validate(operations: readonly IIdentifiedSingleEditOperation[]): ValidAnnotatedEditOperation[];
	push(method: PushMethod, before: Selection[] | null, operations: ValidAnnotatedEditOperation[], cursor: ICursorStateComputer | null, group: UndoRedoGroup | undefined, reason: TextModelEditSource | undefined): Selection[] | null;
	applyMethod(): ApplyMethod;
	source(): TextModelEditSource;
	apply(method: ApplyMethod, operations: ValidAnnotatedEditOperation[], undo: boolean, reason: TextModelEditSource, selection: Selection[] | null | undefined, present: boolean): void | IValidEditOperation[];
	undoing(value: boolean): void;
	redoing(value: boolean): void;
	setEOL(eol: number): void;
	alternative(version: number): void;
	mapChanges(changes: TextChange[], undo: boolean): ISingleEditOperation[];
	undoRedo(edits: ISingleEditOperation[], eol: number, undo: boolean, redo: boolean, version: number, selection: Selection[] | null): void;
	stack(push: boolean): void;
	service(operation: number): void | boolean | Promise<void>;
	positionMethod(): PositionMethod;
	changeField(change: TextChange, index: number): number | string;
	position(method: PositionMethod, offset: number): Position;
	rangeMethod(): typeof Range;
	positionField(position: Position, index: number): number;
	range(method: typeof Range, first: number, second: number, third: number, fourth: number): Range;
	edit(range: Range, text: string): ISingleEditOperation;
}

/** Public transitions return the original service Promise, cursor, and inverse-edit identities. */
export interface IRustModelEditingModule {
	model_editing_abi_version(): number;
	run_model_editing(host: IRustModelEditingHost, operation: RustModelEditingOperation, first: EditingValue, second: EditingValue, third: EditingValue, fourth: EditingValue, fifth: EditingValue, sixth: EditingValue): EditingResult;
	map_model_undo_change(host: IRustModelEditingHost, change: TextChange, undo: boolean): ISingleEditOperation;
}
let registeredModule: IRustModelEditingModule | undefined;

/** Rejects stale transaction bindings before enabling any public edit path. */
export function registerRustModelEditing(module: IRustModelEditingModule): IDisposable {
	if (typeof module.model_editing_abi_version !== 'function' || module.model_editing_abi_version() !== 1 || typeof module.run_model_editing !== 'function' || typeof module.map_model_undo_change !== 'function') {
		throw new Error('The Rust model editing bindings do not match the transaction contract');
	}
	if (registeredModule) { throw new Error('A Rust model editing module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Distinguishes unavailable control from an original undefined edit/service result. */
export function tryRustModelEditing<T extends EditingResult>(operation: RustModelEditingOperation, createHost: (module: IRustModelEditingModule) => IRustModelEditingHost, first: EditingValue = undefined, second: EditingValue = undefined, third: EditingValue = undefined, fourth: EditingValue = undefined, fifth: EditingValue = undefined, sixth: EditingValue = undefined): { value: T } | undefined {
	if (!registeredModule) { return undefined; }
	return { value: registeredModule.run_model_editing(createHost(registeredModule), operation, first, second, third, fourth, fifth, sixth) as T };
}
