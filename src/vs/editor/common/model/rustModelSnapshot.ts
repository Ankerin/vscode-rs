/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ownRustBracketNumericState, RustBracketNumericStateKind } from './bracketPairsTextModelPart/bracketPairsTree/rustBracketNodeMetadata.js';

/** Borrowed source chunks retain repeated length observations and original join semantics. */
export interface IRustModelSnapshotHost {
	eos(): boolean;
	createResult(): string[];
	read(): string | null;
	setEos(): void;
	length(value: string): number;
	compare(operation: number, first: number, second: number): boolean;
	add(first: number, second: number): number;
	write(result: string[], index: number, value: string): void;
	join(result: string[]): string;
}

/** Generated streaming control participates in the core's atomic registration lifetime. */
export interface IRustModelSnapshotModule {
	model_snapshot_abi_version(): number;
	read_model_snapshot(host: IRustModelSnapshotHost): string | null;
}

let registeredModule: IRustModelSnapshotModule | undefined;

/** Installs streaming snapshot control without changing public snapshot interfaces. */
export function registerRustModelSnapshot(module: IRustModelSnapshotModule): IDisposable {
	if (typeof module.model_snapshot_abi_version !== 'function' || module.model_snapshot_abi_version() !== 1 || typeof module.read_model_snapshot !== 'function') {
		throw new Error('The Rust model snapshot bindings do not match the streaming contract');
	}
	if (registeredModule) { throw new Error('A Rust model snapshot module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Preserves the original null result while keeping unavailable control distinguishable. */
export function tryRustModelSnapshot(createHost: () => IRustModelSnapshotHost): { value: string | null } | undefined {
	if (!registeredModule) { return undefined; }
	return { value: registeredModule.read_model_snapshot(createHost()) };
}

/** Transfers source handles and end-of-stream state into the shared native property contract. */
export function ownRustModelSnapshot<T extends object>(snapshot: T): T {
	return ownRustBracketNumericState(snapshot, RustBracketNumericStateKind.ModelSnapshot);
}

