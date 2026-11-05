/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import type { TextChange } from './textChange.js';
import { readUInt32BE } from '../../../base/common/buffer.js';
import { decodeUTF16LELossless } from './utf16Transfer.js';

/** Generated undo composition bindings; the result retains the existing binary representation. */
export interface IRustTextChangeModule {
	text_change_abi_version(): number;
	compress_changes(previous: Uint32Array, current: Uint32Array, units: Uint16Array): Uint8Array | undefined;
	WasmUndoChangeBatch: { new(): IRustUndoChangeBatch };
}

interface IRustUndoChangeBatch {
	len(): number;
	append(ranges: Uint32Array, units: Uint16Array): boolean;
	serialize(): Uint8Array;
	free(): void;
}

const maxTextChangeUnits = 4 * 1024 * 1024;
let registeredModule: IRustTextChangeModule | undefined;

/** Installs undo composition for the initialized core's lifetime. */
export function registerRustTextChanges(module: IRustTextChangeModule): IDisposable {
	if (typeof module.text_change_abi_version !== 'function' || module.text_change_abi_version() !== 2 || typeof module.WasmUndoChangeBatch !== 'function') {
		throw new Error('The Rust text change bindings do not match the current undo contract');
	}
	if (registeredModule) {
		throw new Error('A Rust text change module is already registered');
	}
	registeredModule = module;
	return toDisposable(() => {
		if (registeredModule === module) {
			registeredModule = undefined;
		}
	});
}

/** Packs lossless text once and leaves unsupported offset or allocation domains on the old path. */
export function tryCompressRustTextChanges(previous: readonly TextChange[], current: readonly TextChange[]): Pick<TextChange, 'oldPosition' | 'oldText' | 'newPosition' | 'newText'>[] | undefined {
	if (!registeredModule) {
		return undefined;
	}
	const encoded = encodeChanges([previous, current]);
	if (!encoded) {
		return undefined;
	}
	const bytes = registeredModule.compress_changes(encoded.ranges[0], encoded.ranges[1], encoded.units);
	return bytes ? decodeRustTextChanges(bytes) : undefined;
}

/** Owns open undo text until serialization or a consumer requests JavaScript change objects. */
export class RustUndoChangeBatch implements IDisposable {
	private _disposed = false;

	constructor(private readonly _batch: IRustUndoChangeBatch) { }

	public append(changes: readonly TextChange[]): boolean {
		const encoded = encodeChanges([changes]);
		return !!encoded && this._batch.append(encoded.ranges[0], encoded.units);
	}

	public serialize(): { count: number; bytes: Uint8Array } {
		return { count: this._batch.len(), bytes: this._batch.serialize() };
	}

	public dispose(): void {
		if (!this._disposed) {
			this._disposed = true;
			this._batch.free();
		}
	}
}

/** Creates an owning batch only within the initialized core's supported domain. */
export function createRustUndoChangeBatch(changes: readonly TextChange[]): RustUndoChangeBatch | undefined {
	if (!registeredModule) {
		return undefined;
	}
	const batch = new RustUndoChangeBatch(new registeredModule.WasmUndoChangeBatch());
	try {
		if (batch.append(changes)) {
			return batch;
		}
	} catch (error) {
		batch.dispose();
		throw error;
	}
	batch.dispose();
	return undefined;
}

function encodeChanges(batches: readonly (readonly TextChange[])[]): { ranges: Uint32Array[]; units: Uint16Array } | undefined {
	if (batches.reduce((count, changes) => count + changes.length * 6, 0) > maxTextChangeUnits) {
		return undefined;
	}
	let length = 0;
	for (const changes of batches) {
		for (const change of changes) {
			if (!fitsOffset(change.oldPosition) || !fitsOffset(change.oldEnd) || !fitsOffset(change.newPosition) || !fitsOffset(change.newEnd)) {
				return undefined;
			}
			length += change.oldLength + change.newLength;
			if (length > maxTextChangeUnits) {
				return undefined;
			}
		}
	}
	const units = new Uint16Array(length);
	let offset = 0;
	const appendText = (text: string) => {
		for (let column = 0; column < text.length; column++) {
			units[offset++] = text.charCodeAt(column);
		}
	};
	const encode = (changes: readonly TextChange[]) => {
		const ranges = new Uint32Array(changes.length * 6);
		for (let index = 0; index < changes.length; index++) {
			const change = changes[index];
			const start = index * 6;
			ranges[start] = change.oldPosition;
			ranges[start + 1] = offset;
			ranges[start + 2] = change.oldLength;
			ranges[start + 3] = change.newPosition;
			ranges[start + 4] = offset + change.oldLength;
			ranges[start + 5] = change.newLength;
			appendText(change.oldText);
			appendText(change.newText);
		}
		return ranges;
	};
	return { ranges: batches.map(encode), units };
}

function fitsOffset(offset: number): boolean {
	return Number.isInteger(offset) && offset >= 0 && offset <= 0xFFFFFFFF;
}

/** Decodes validated binary change records without replacing BOM or surrogate code units. */
export function decodeRustTextChanges(bytes: Uint8Array): Pick<TextChange, 'oldPosition' | 'oldText' | 'newPosition' | 'newText'>[] | undefined {
	const changes: Pick<TextChange, 'oldPosition' | 'oldText' | 'newPosition' | 'newText'>[] = [];
	let cursor = 0;
	const readText = () => {
		if (cursor + 4 > bytes.length) {
			return undefined;
		}
		const length = readUInt32BE(bytes, cursor);
		cursor += 4;
		if (cursor + length * 2 > bytes.length) {
			return undefined;
		}
		const text = decodeUTF16LELossless(bytes, cursor, length);
		cursor += length * 2;
		return text;
	};
	while (cursor < bytes.length) {
		if (cursor + 8 > bytes.length) {
			return undefined;
		}
		const oldPosition = readUInt32BE(bytes, cursor);
		const newPosition = readUInt32BE(bytes, cursor + 4);
		cursor += 8;
		const oldText = readText();
		const newText = readText();
		if (oldText === undefined || newText === undefined) {
			return undefined;
		}
		changes.push({ oldPosition, oldText, newPosition, newText });
	}
	return changes;
}
