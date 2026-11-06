/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ResourceEditStackSnapshot } from '../../../platform/undoRedo/common/undoRedo.js';
import { IAttachedView, ITextBuffer } from '../model.js';

/** Complete lifecycle operations share the core's atomic registration lifetime. */
export const enum RustModelLifecycleOperation {
	Dispose = 0,
	HasListeners = 1,
	AssertAlive = 2,
	Attach = 3,
	Detach = 4,
	IsAttached = 5,
	AttachedCount = 6,
	TooLargeSync = 7,
	TooLargeTokens = 8,
	TooLargeHeap = 9,
	Disposed = 10,
	Disposing = 11,
	IncreaseVersion = 12,
	OverwriteVersion = 13,
	OverwriteAlternative = 14,
	OverwriteInitial = 15
}

/** Live field slots preserve original model descriptor and observation behavior. */
export const rustModelLifecycleFields = [
	'_versionId', '_alternativeVersionId', '_initialUndoRedoSnapshot', '_attachedEditorCount',
	'_isDisposed', '__isDisposing', '_isTooLargeForSyncing', '_isTooLargeForTokenization', '_isTooLargeForHeapOperation'
] as const;

/** Borrowed values keep existing view/buffer/resource identities. */
export type RustModelLifecycleValue = number | boolean | IAttachedView | ITextBuffer | ResourceEditStackSnapshot | null | void;

/** Original service/event/factory calls remain caught capabilities with exact receivers. */
export interface IRustModelLifecycleHost {
	get(field: number): RustModelLifecycleValue;
	set(field: number, value: RustModelLifecycleValue): void;
	action(operation: number, value: RustModelLifecycleValue): RustModelLifecycleValue;
	listener(index: number): boolean;
	add(first: number, second: number): number;
	increment(value: number, increase: boolean): number;
	compare(operation: number, first: number, second: number): boolean;
}

/** Generated lifecycle bindings return original views, scalars, and void results. */
export interface IRustModelLifecycleModule {
	model_lifecycle_abi_version(): number;
	run_model_lifecycle(host: IRustModelLifecycleHost, operation: RustModelLifecycleOperation, input: RustModelLifecycleValue): RustModelLifecycleValue;
}

let registeredModule: IRustModelLifecycleModule | undefined;

/** Installs lifecycle control atomically with the Rust core. */
export function registerRustModelLifecycle(module: IRustModelLifecycleModule): IDisposable {
	if (typeof module.model_lifecycle_abi_version !== 'function' || module.model_lifecycle_abi_version() !== 1 || typeof module.run_model_lifecycle !== 'function') {
		throw new Error('The Rust model lifecycle bindings do not match the transition contract');
	}
	if (registeredModule) { throw new Error('A Rust model lifecycle module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Distinguishes unavailable control from an original undefined result. */
export function tryRustModelLifecycle<T extends RustModelLifecycleValue>(operation: RustModelLifecycleOperation, input: RustModelLifecycleValue, createHost: () => IRustModelLifecycleHost): { value: T } | undefined {
	if (!registeredModule) { return undefined; }
	return { value: registeredModule.run_model_lifecycle(createHost(), operation, input) as T };
}

