/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import type { TextLength } from '../../../core/text/textLength.js';
import type { Length } from './length.js';

/** The cache objects remain at their original owner while Rust drives ordered transitions. */
export interface IRustBracketEditCache {
	readonly offsetObj: TextLength;
	readonly endOffsetBeforeObj: TextLength;
	readonly endOffsetAfterObj: TextLength;
}

/** Caught capabilities retain getters, setters, virtual calls, and exceptional scalar coercion. */
export interface IRustBracketPositionMapperHost {
	add(first: number, second: number): number;
	subtract(first: number, second: number): number;
	equal(first: number, second: number): boolean;
	component(coordinate: TextLength, column: boolean): number;
	delta(field: number): number;
	setDelta(field: number, value: number): void;
	pack(line: number, column: number): Length;
	parts(offset: Length): TextLength;
	hasNextEdit(): boolean;
	nextEdit(): IRustBracketEditCache | undefined;
	editExists(edit: IRustBracketEditCache | undefined): boolean;
	editCoordinate(edit: IRustBracketEditCache, field: number): TextLength;
	translateEdit(edit: IRustBracketEditCache, field: number): Length;
	incrementEdit(): void;
	lessEqual(first: Length, second: Length): boolean;
	isNull(offset: Length | null): boolean;
	distance(first: Length, second: Length): Length;
}

/** A scoped value distinguishes a completed null result from an unavailable implementation. */
interface IRustBracketPositionResult {
	take(): Length | null;
	free(): void;
}

/** Generated edit-cursor and coordinate-translation contracts. */
export interface IRustBracketPositionMapperModule {
	bracket_position_mapper_abi_version(): number;
	translate_bracket_old_offset(host: IRustBracketPositionMapperHost, coordinate: TextLength): IRustBracketPositionResult;
	translate_bracket_current_offset(host: IRustBracketPositionMapperHost, offset: Length): IRustBracketPositionResult;
	adjust_bracket_position_mapper(host: IRustBracketPositionMapperHost, offset: Length): boolean;
	distance_to_bracket_change(host: IRustBracketPositionMapperHost, offset: Length): IRustBracketPositionResult;
}

let registeredModule: IRustBracketPositionMapperModule | undefined;

/** Installs edit mapping for the same atomic disposable lifetime as the initialized Rust core. */
export function registerRustBracketPositionMapper(module: IRustBracketPositionMapperModule): IDisposable {
	if (typeof module.bracket_position_mapper_abi_version !== 'function' || module.bracket_position_mapper_abi_version() !== 1 || typeof module.translate_bracket_old_offset !== 'function' || typeof module.translate_bracket_current_offset !== 'function' || typeof module.adjust_bracket_position_mapper !== 'function' || typeof module.distance_to_bracket_change !== 'function') { throw new Error('The Rust bracket position mapper bindings do not match the edit cursor contract'); }
	if (registeredModule) { throw new Error('A Rust bracket position mapper module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Executes old/current translations without moving original method dispatch into preflight. */
export function tryTranslateRustBracketPosition(offset: Length | TextLength, backwards: boolean, createHost: () => IRustBracketPositionMapperHost): { offset: Length } | undefined {
	if (!registeredModule) { return undefined; }
	const result = backwards ? registeredModule.translate_bracket_current_offset(createHost(), offset as Length) : registeredModule.translate_bracket_old_offset(createHost(), offset as TextLength);
	return { offset: takeResult(result) as Length };
}

/** Finishes or propagates partial edit-state transitions without replaying them through fallback. */
export function tryAdjustRustBracketPosition(offset: Length, createHost: () => IRustBracketPositionMapperHost): boolean {
	if (!registeredModule) { return false; }
	if (registeredModule.adjust_bracket_position_mapper(createHost(), offset) !== true) { throw new Error('The Rust bracket position adjustment result does not match the edit cursor contract'); }
	return true;
}

/** Resolves the next change after the public adjustment callback has run at its original site. */
export function tryRustBracketChangeDistance(offset: Length, createHost: () => IRustBracketPositionMapperHost): { distance: Length | null } | undefined {
	if (!registeredModule) { return undefined; }
	return { distance: takeResult(registeredModule.distance_to_bracket_change(createHost(), offset)) };
}

/** Releases each native result immediately, including when consumption throws. */
function takeResult(result: IRustBracketPositionResult): Length | null {
	if (!result || typeof result.take !== 'function' || typeof result.free !== 'function') { throw new Error('The Rust bracket position result does not match the edit cursor contract'); }
	try { return result.take(); } finally { result.free(); }
}
