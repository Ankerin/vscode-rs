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
}

const maxTextChangeUnits = 4 * 1024 * 1024;
let registeredModule: IRustTextChangeModule | undefined;

/** Installs undo composition for the initialized core's lifetime. */
export function registerRustTextChanges(module: IRustTextChangeModule): IDisposable {
	if (typeof module.text_change_abi_version !== 'function' || module.text_change_abi_version() !== 1) {
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
	if (!registeredModule || (previous.length + current.length) * 6 > maxTextChangeUnits) {
		return undefined;
	}
	let length = 0;
	for (const changes of [previous, current]) {
		for (const change of changes) {
			if (![change.oldPosition, change.oldEnd, change.newPosition, change.newEnd].every(offset => Number.isInteger(offset) && offset >= 0 && offset <= 0xFFFFFFFF)) {
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
	const encode = (changes: readonly TextChange[]) => {
		const ranges = new Uint32Array(changes.length * 6);
		for (let index = 0; index < changes.length; index++) {
			const change = changes[index];
			ranges.set([change.oldPosition, offset, change.oldLength, change.newPosition, offset + change.oldLength, change.newLength], index * 6);
			for (const text of [change.oldText, change.newText]) {
				for (let column = 0; column < text.length; column++) {
					units[offset++] = text.charCodeAt(column);
				}
			}
		}
		return ranges;
	};
	const bytes = registeredModule.compress_changes(encode(previous), encode(current), units);
	if (!bytes) {
		return undefined;
	}
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
