/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import type { IRange, Range } from '../core/range.js';
import type { IIdentifiedSingleEditOperation, ISingleEditOperationIdentifier, ValidAnnotatedEditOperation } from '../model.js';
import { ownRustBracketNumericState, RustBracketNumericStateKind } from './bracketPairsTextModelPart/bracketPairsTree/rustBracketNodeMetadata.js';

/** Single/batch edit validation shares the registered core lifetime. */
export const enum RustModelEditValidationOperation { Single = 0, Batch = 1 }
type EditField = IRange | string | null | ISingleEditOperationIdentifier | boolean | undefined;
type RangeMethod = (range: IRange) => Range;
type TextMethod = (index: number) => number;
type SliceMethod = (end: number) => string;
type EditMethod = (operation: IIdentifiedSingleEditOperation) => ValidAnnotatedEditOperation;

/** Captured original methods preserve lookup before input/range/text property getters. */
export interface IRustModelEditValidationHost {
	annotated(operation: IIdentifiedSingleEditOperation): boolean;
	field(operation: IIdentifiedSingleEditOperation, index: number): EditField;
	rangeMethod(): RangeMethod;
	validateRange(method: RangeMethod, range: IRange): Range;
	length(text: string): number;
	aboveZero(value: number): boolean;
	minusOne(value: number): number;
	charMethod(text: string): TextMethod;
	charCode(method: TextMethod, index: number): number;
	eol(): string;
	endColumn(range: Range): number;
	maxMethod(): (line: number) => number;
	endLine(range: Range): number;
	maxColumn(method: (line: number) => number, line: number): number;
	substringMethod(text: string): SliceMethod;
	substring(method: SliceMethod, end: number): string;
	constructMethod(): typeof ValidAnnotatedEditOperation;
	construct(method: typeof ValidAnnotatedEditOperation, identifier: ISingleEditOperationIdentifier | null, range: Range, text: string | null, markers: boolean, whitespace: boolean, tracked: boolean): ValidAnnotatedEditOperation;
	result(): ValidAnnotatedEditOperation[];
	operationLength(operations: readonly IIdentifiedSingleEditOperation[]): number;
	less(index: number, length: number): boolean;
	editMethod(): EditMethod;
	operation(operations: readonly IIdentifiedSingleEditOperation[], index: number): IIdentifiedSingleEditOperation;
	validateEdit(method: EditMethod, operation: IIdentifiedSingleEditOperation): ValidAnnotatedEditOperation;
	write(result: ValidAnnotatedEditOperation[], index: number, operation: ValidAnnotatedEditOperation): void;
}

/** Generated validation retains the existing operation and result-array shapes. */
export interface IRustModelEditValidationModule {
	model_edit_validation_abi_version(): number;
	run_model_edit_validation(host: IRustModelEditValidationHost, operation: RustModelEditValidationOperation, input: IIdentifiedSingleEditOperation | readonly IIdentifiedSingleEditOperation[]): ValidAnnotatedEditOperation | ValidAnnotatedEditOperation[];
}

let registeredModule: IRustModelEditValidationModule | undefined;

/** Rejects stale bindings before enabling original edit validation dispatch. */
export function registerRustModelEditValidation(module: IRustModelEditValidationModule): IDisposable {
	if (typeof module.model_edit_validation_abi_version !== 'function' || module.model_edit_validation_abi_version() !== 1 || typeof module.run_model_edit_validation !== 'function') { throw new Error('The Rust model edit validation bindings do not match the operation contract'); }
	if (registeredModule) { throw new Error('A Rust model edit validation module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Keeps original operation/array results distinct from unavailable control. */
export function tryRustModelEditValidation<T extends ValidAnnotatedEditOperation | ValidAnnotatedEditOperation[]>(operation: RustModelEditValidationOperation, input: IIdentifiedSingleEditOperation | readonly IIdentifiedSingleEditOperation[], createHost: () => IRustModelEditValidationHost): { value: T } | undefined {
	if (!registeredModule) { return undefined; }
	return { value: registeredModule.run_model_edit_validation(createHost(), operation, input) as T };
}

/** Fresh validated edit fields retain the original identifier/range/text reference identities. */
export function ownRustValidatedModelEdit<T extends object>(operation: T): T { return ownRustBracketNumericState(operation, RustBracketNumericStateKind.ValidatedModelEdit); }
