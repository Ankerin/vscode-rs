/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { BugIndicatingError } from '../../../base/common/errors.js';
import { IPosition, Position } from '../core/position.js';
import { IRange, Range } from '../core/range.js';

/** Complete validation operations share the core's atomic registration lifetime. */
export const enum RustModelValidationOperation {
	RelaxedRange = 0,
	IsPosition = 1,
	ClampPosition = 2,
	Position = 3,
	IsRange = 4,
	Range = 5,
	PublicIsRange = 6
}

/** Borrowed model methods and public object factories preserve receivers and exceptions. */
export interface IRustModelValidationHost {
	coordinate(value: IPosition | IRange, field: number): number;
	compare(operation: number, first: number, second: number): boolean;
	add(value: number, amount: number): number;
	subtract(value: number, amount: number): number;
	lineCount(): number;
	maxColumn(line: number): number;
	lineLength(line: number): number;
	charCode(line: number, index: number): number;
	assertAlive(): void;
	positionMethod(valid: boolean): (line: number, column: number, surrogates: boolean) => boolean | Position;
	callIsValidPosition(method: (line: number, column: number, surrogates: boolean) => boolean, line: number, column: number, surrogates: boolean): boolean;
	callValidatePosition(method: (line: number, column: number, surrogates: boolean) => Position, line: number, column: number, surrogates: boolean): Position;
	charCodeMethod(): (line: number, index: number) => number;
	callCharCode(method: (line: number, index: number) => number, line: number, index: number): number;
	reusable(value: IPosition | IRange, range: boolean): boolean;
	isValidPosition(line: number, column: number, surrogates: boolean): boolean;
	validatePosition(line: number, column: number, surrogates: boolean): Position;
	isValidRange(range: Range, surrogates: boolean): boolean;
	publicIsValidRange(range: Range): boolean;
	makePosition(line: number, column: number): Position;
	makeRange(startLine: number, startColumn: number, endLine: number, endColumn: number): Range;
}

/** Generated bindings return existing Position/Range objects without a parallel representation. */
export interface IRustModelValidationModule {
	model_validation_abi_version(): number;
	run_model_validation(host: IRustModelValidationHost, operation: RustModelValidationOperation, first: IPosition | IRange | number, second: number, validationType: number): boolean | Position | Range;
}

let registeredModule: IRustModelValidationModule | undefined;

/** Reads a borrowed public coordinate without coercing its value. */
export function readRustModelCoordinate(value: IPosition | IRange, field: number): number {
	switch (field) {
		case 0: return (value as IPosition).lineNumber;
		case 1: return (value as IPosition).column;
		case 2: return (value as IRange).startLineNumber;
		case 3: return (value as IRange).startColumn;
		case 4: return (value as IRange).endLineNumber;
		case 5: return (value as IRange).endColumn;
		default: throw new BugIndicatingError('Invalid model coordinate field');
	}
}

/** Preserves ECMAScript operators for exceptional runtime provider values. */
export function compareRustModelValues(operation: number, first: number, second: number): boolean {
	switch (operation) {
		case 0: return first === second;
		case 1: return first < second;
		case 2: return first > second;
		case 3: return first <= second;
		case 4: return first >= second;
		default: throw new BugIndicatingError('Invalid model coordinate comparison');
	}
}

/** Installs model validation atomically with the Rust core, rejecting incompatible bindings. */
export function registerRustModelValidation(module: IRustModelValidationModule): IDisposable {
	if (typeof module.model_validation_abi_version !== 'function' || module.model_validation_abi_version() !== 1 || typeof module.run_model_validation !== 'function') {
		throw new Error('The Rust model validation bindings do not match the coordinate contract');
	}
	if (registeredModule) { throw new Error('A Rust model validation module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Distinguishes an unavailable implementation from an original provider's returned value. */
export function tryRustModelValidation<T extends boolean | Position | Range>(operation: RustModelValidationOperation, first: IPosition | IRange | number, second: number, validationType: number, createHost: () => IRustModelValidationHost): { value: T } | undefined {
	if (!registeredModule) { return undefined; }
	return { value: registeredModule.run_model_validation(createHost(), operation, first, second, validationType) as T };
}

