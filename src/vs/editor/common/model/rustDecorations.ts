/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import type { IntervalNode } from './intervalTree.js';

/** Historical two-marker decoration edits beneath the existing interval-node API. */
export interface IRustDecorationsModule {
	decorations_abi_version(): number;
	decoration_accept_edit(metadata: number, nodeStart: number, nodeEnd: number, start: number, end: number, textLength: number, forceMove: boolean): Float64Array;
}

let registeredModule: IRustDecorationsModule | undefined;

/** Installs marker computation in the initialized editor core's disposable scope. */
export function registerRustDecorations(module: IRustDecorationsModule): IDisposable {
	if (typeof module.decorations_abi_version !== 'function' || module.decorations_abi_version() !== 1 || typeof module.decoration_accept_edit !== 'function') { throw new Error('The Rust decoration bindings do not match the current marker contract'); }
	if (registeredModule) { throw new Error('A Rust decoration module is already registered'); }
	registeredModule = module;
	return toDisposable(() => { if (registeredModule === module) { registeredModule = undefined; } });
}

/** Preserves original node identity, external fields, caches, and nonstandard accessors. */
export function tryApplyRustDecorationEdit(node: IntervalNode, start: number, end: number, textLength: number, forceMove: boolean): boolean {
	if (!registeredModule || typeof start !== 'number' || typeof end !== 'number' || typeof textLength !== 'number' || typeof forceMove !== 'boolean') { return false; }
	const metadata = Object.getOwnPropertyDescriptor(node, 'metadata');
	const first = Object.getOwnPropertyDescriptor(node, 'start');
	const last = Object.getOwnPropertyDescriptor(node, 'end');
	if (!metadata || !first || !last || !Object.hasOwn(metadata, 'value') || !Object.hasOwn(first, 'value') || !Object.hasOwn(last, 'value') || typeof metadata.value !== 'number' || typeof first.value !== 'number' || typeof last.value !== 'number' || !first.writable || !last.writable) { return false; }
	const result = registeredModule.decoration_accept_edit(metadata.value >>> 0, first.value, last.value, start, end, textLength, forceMove);
	if (!(result instanceof Float64Array) || result.length !== 2) { throw new Error('The Rust decoration edit result does not match the marker contract'); }
	node.start = result[0];
	node.end = result[1];
	return true;
}
