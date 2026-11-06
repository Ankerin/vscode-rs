/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import type { Selection } from '../core/selection.js';
import type { InternalModelContentChangeEvent } from '../textModelEvents.js';
import { ownRustBracketNumericState, releaseRustBracketNumericState, RustBracketNumericStateKind } from './bracketPairsTextModelPart/bracketPairsTree/rustBracketNodeMetadata.js';

/** Complete deferred content-emitter operations share the core registration lifetime. */
export const enum RustModelContentEventsOperation { HasListeners = 0, Begin = 1, End = 2, Fire = 3 }

/** Native fields and event/selection capabilities retain original aliases and descriptors. */
export interface IRustModelContentEventsHost {
	get(index: number): number | InternalModelContentChangeEvent | null;
	set(index: number, value: number | InternalModelContentChangeEvent | null): void;
	increment(value: number, increase: boolean): number;
	aboveZero(value: number): boolean;
	hasListeners(): boolean;
	assignSelection(event: InternalModelContentChangeEvent, selection: Selection[] | null): void;
	merge(previous: InternalModelContentChangeEvent, current: InternalModelContentChangeEvent): InternalModelContentChangeEvent;
	fire(event: InternalModelContentChangeEvent): void;
}

/** Generated content event control returns original listener values and distinguishes void. */
export interface IRustModelContentEventsModule {
	model_content_events_abi_version(): number;
	run_model_content_events(host: IRustModelContentEventsHost, operation: RustModelContentEventsOperation, input: InternalModelContentChangeEvent | Selection[] | null): boolean | void;
}

let registeredModule: IRustModelContentEventsModule | undefined;

/** Rejects stale bindings before enabling deferred content event control. */
export function registerRustModelContentEvents(module: IRustModelContentEventsModule): IDisposable {
	if (typeof module.model_content_events_abi_version !== 'function' || module.model_content_events_abi_version() !== 1 || typeof module.run_model_content_events !== 'function') { throw new Error('The Rust model content event bindings do not match the deferred contract'); }
	if (registeredModule) { throw new Error('A Rust model content event module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Keeps original void/listener results distinct from unavailable control. */
export function tryRustModelContentEvents<T extends boolean | void>(operation: RustModelContentEventsOperation, input: InternalModelContentChangeEvent | Selection[] | null, createHost: () => IRustModelContentEventsHost): { value: T } | undefined {
	if (!registeredModule) { return undefined; }
	return { value: registeredModule.run_model_content_events(createHost(), operation, input) as T };
}

/** Installs native event/counter handles before derived fields and disposal tracking. */
export function ownRustModelContentEmitter<T extends object>(instance: T): T {
	return ownRustBracketNumericState(instance, RustBracketNumericStateKind.ModelContentEmitter);
}

/** Successful emitter disposal retains fields while releasing their owning native record. */
export function releaseRustModelContentEmitter(instance: object): void {
	releaseRustBracketNumericState(instance);
}
