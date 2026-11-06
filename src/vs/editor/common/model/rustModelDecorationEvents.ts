/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import type { SetWithKey } from '../../../base/common/collections.js';
import type { LineFontChangingDecoration, LineHeightChangingDecoration } from './decorationProvider.js';
import type { IModelDecorationsChangedEvent } from '../textModelEvents.js';
import type { ModelDecorationOptions } from './textModel.js';
import { ownRustBracketNumericState, releaseRustBracketNumericState, RustBracketNumericStateKind } from './bracketPairsTextModelPart/bracketPairsTree/rustBracketNodeMetadata.js';

/** Complete decoration-emitter operations share the core registration lifetime. */
export const enum RustModelDecorationEventsOperation { HasListeners = 0, Begin = 1, End = 2, Injected = 3, Height = 4, Font = 5, Check = 6, Fire = 7, Try = 8, Deliver = 9 }
export const rustModelDecorationEventFields = ['_deferredCnt', '_shouldFireDeferred', '_affectsMinimap', '_affectsOverviewRuler', '_affectsGlyphMargin', '_affectsLineNumber', '_affectedInjectedTextLines', '_affectedLineHeights', '_affectedFontLines'] as const;
export interface IRustAffectedDecorationLine { ownerId: number; decorationId: string; lineNumber: number; lineHeight: number | null }
export type RustAffectedDecorationSets = Set<number> | SetWithKey<LineHeightChangingDecoration> | SetWithKey<LineFontChangingDecoration> | null;
export type RustDecorationBeforeFire = (injected: Set<number> | null, heights: SetWithKey<LineHeightChangingDecoration> | null, fonts: SetWithKey<LineFontChangingDecoration> | null) => void;
type DecorationField = number | boolean | RustAffectedDecorationSets;
type DecorationInput = number | IRustAffectedDecorationLine | ModelDecorationOptions | null;

/** Original set/callback/event operations preserve aliases, receivers, and failure state. */
export interface IRustModelDecorationEventsHost {
	get(index: number): DecorationField;
	set(index: number, value: DecorationField): void;
	increment(value: number, increase: boolean): number;
	hasListeners(): boolean;
	tryFire(): void;
	deliver(): void;
	clear(set: Exclude<RustAffectedDecorationSets, null>): void;
	createSet(index: number): RustAffectedDecorationSets;
	add(index: number, input: number | IRustAffectedDecorationLine): void;
	optionFlag(input: ModelDecorationOptions, index: number): boolean;
	beforeMethod(): RustDecorationBeforeFire;
	before(method: RustDecorationBeforeFire, injected: Set<number> | null, heights: SetWithKey<LineHeightChangingDecoration> | null, fonts: SetWithKey<LineFontChangingDecoration> | null): void;
	event(mini: boolean, overview: boolean, glyph: boolean, line: boolean): IModelDecorationsChangedEvent;
	fireEvent(event: IModelDecorationsChangedEvent): void;
}

/** Generated control returns original listener/void results. */
export interface IRustModelDecorationEventsModule {
	model_decoration_events_abi_version(): number;
	run_model_decoration_events(host: IRustModelDecorationEventsHost, operation: RustModelDecorationEventsOperation, input: DecorationInput): boolean | void;
}

let registeredModule: IRustModelDecorationEventsModule | undefined;

/** Rejects stale bindings before enabling decoration event batching. */
export function registerRustModelDecorationEvents(module: IRustModelDecorationEventsModule): IDisposable {
	if (typeof module.model_decoration_events_abi_version !== 'function' || module.model_decoration_events_abi_version() !== 1 || typeof module.run_model_decoration_events !== 'function') { throw new Error('The Rust model decoration event bindings do not match the deferred contract'); }
	if (registeredModule) { throw new Error('A Rust model decoration event module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Keeps original listener/void results distinct from unavailable control. */
export function tryRustModelDecorationEvents<T extends boolean | void>(operation: RustModelDecorationEventsOperation, input: DecorationInput, createHost: () => IRustModelDecorationEventsHost): { value: T } | undefined {
	if (!registeredModule) { return undefined; }
	return { value: registeredModule.run_model_decoration_events(createHost(), operation, input) as T };
}

/** Installs native emitter ownership before derived fields, callbacks, and disposal tracking. */
export function ownRustModelDecorationEmitter<T extends object>(instance: T): T { return ownRustBracketNumericState(instance, RustBracketNumericStateKind.ModelDecorationEmitter); }

/** Releases native emitter fields after successful resource disposal without freezing the object. */
export function releaseRustModelDecorationEmitter(instance: object): void { releaseRustBracketNumericState(instance); }

/** Fresh decoration event objects retain their original flags and plain-object descriptors. */
export function ownRustModelDecorationEvent<T extends object>(event: T): T { return ownRustBracketNumericState(event, RustBracketNumericStateKind.ModelDecorationEvent); }
