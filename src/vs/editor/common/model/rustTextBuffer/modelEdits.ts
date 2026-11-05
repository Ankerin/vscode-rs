/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readUInt32BE } from '../../../../base/common/buffer.js';
import { Range } from '../../core/range.js';
import { TextChange } from '../../core/textChange.js';
import { decodeUTF16LELossless } from '../../core/utf16Transfer.js';
import { ApplyEditsResult, IInternalModelContentChange, IValidEditOperation, ValidAnnotatedEditOperation } from '../../model.js';
import type { IRustTextBuffer } from './rustTextBuffer.js';
import type { ITextBufferFlags, ITextBufferModelEditsResult } from './textBufferStorage.js';

const maxModelEditUnits = 4 * 1024 * 1024;
const maxModelEdits = 262144;

/** Transfers raw text once; native storage validates and commits the complete transaction. */
export function applyRustModelEdits(buffer: IRustTextBuffer, operations: readonly ValidAnnotatedEditOperation[], crlf: boolean, flags: ITextBufferFlags, recordTrimAutoWhitespace: boolean, computeUndoEdits: boolean): ITextBufferModelEditsResult | undefined {
	if (operations.length > maxModelEdits) {
		return undefined;
	}
	let length = 0;
	for (const operation of operations) {
		const range = operation.range;
		if (!fitsCoordinate(range.startLineNumber) || !fitsCoordinate(range.startColumn) || !fitsCoordinate(range.endLineNumber) || !fitsCoordinate(range.endColumn)) {
			return undefined;
		}
		length += operation.text?.length ?? 0;
		if (length > maxModelEditUnits) {
			return undefined;
		}
	}
	const ranges = new Uint32Array(operations.length * 7);
	const units = new Uint16Array(length);
	let offset = 0;
	for (let index = 0; index < operations.length; index++) {
		const operation = operations[index];
		const start = index * 7;
		ranges[start] = operation.range.startLineNumber;
		ranges[start + 1] = operation.range.startColumn;
		ranges[start + 2] = operation.range.endLineNumber;
		ranges[start + 3] = operation.range.endColumn;
		ranges[start + 4] = offset;
		ranges[start + 5] = operation.text?.length ?? 0;
		ranges[start + 6] = (operation.forceMoveMarkers ? 1 : 0) | (operation.isAutoWhitespaceEdit ? 2 : 0) | (operation._isTracked ? 4 : 0);
		if (operation.text) {
			for (let index = 0; index < operation.text.length; index++) {
				units[offset++] = operation.text.charCodeAt(index);
			}
		}
	}
	const inputFlags = (flags.mightContainNonBasicASCII ? 1 : 0) | (flags.mightContainRTL ? 2 : 0) | (flags.mightContainUnusualLineTerminators ? 4 : 0);
	const bytes = buffer.apply_model_edits(ranges, units, crlf, inputFlags, recordTrimAutoWhitespace, computeUndoEdits);
	return bytes ? decodeModelEdits(bytes, operations, computeUndoEdits) : undefined;
}

function fitsCoordinate(value: number): boolean {
	return Number.isInteger(value) && value > 0 && value <= 0xFFFFFFFF;
}

function decodeModelEdits(bytes: Uint8Array, inputs: readonly ValidAnnotatedEditOperation[], computeUndoEdits: boolean): ITextBufferModelEditsResult {
	let cursor = 0;
	const read = () => {
		if (cursor + 4 > bytes.length) {
			throw new Error('The Rust model edit result is truncated');
		}
		const value = readUInt32BE(bytes, cursor);
		cursor += 4;
		return value;
	};
	const readText = (length: number) => {
		if (length === 0) {
			return '';
		}
		if (cursor + length * 2 > bytes.length) {
			throw new Error('The Rust model edit text is truncated');
		}
		const text = decodeUTF16LELossless(bytes, cursor, length);
		cursor += length * 2;
		return text;
	};
	const flags = read();
	const count = read();
	const trimCount = read();
	const changes: IInternalModelContentChange[] = [];
	const reverse: (IValidEditOperation & { sortIndex: number })[] | null = computeUndoEdits ? [] : null;
	for (let index = 0; index < count; index++) {
		const input = inputs[read()];
		const sortIndex = read();
		const range = new Range(read(), read(), read(), read());
		const rangeOffset = read();
		const rangeLength = read();
		const textSource = read();
		const textLength = read();
		const oldTextLength = read();
		const reverseStartLine = read();
		const reverseStartColumn = read();
		const reverseEndLine = read();
		const reverseEndColumn = read();
		const reverseOffset = read();
		const forceMoveMarkers = read() !== 0;
		const text = textSource === 0xFFFFFFFF ? readText(textLength) : inputs[textSource]?.text ?? '';
		const oldText = readText(oldTextLength);
		if (!input || text.length !== textLength) {
			throw new Error('The Rust model edit result has invalid input references');
		}
		if (!range.isEmpty() || text.length > 0) {
			changes.push({ range, rangeOffset, rangeLength, text, forceMoveMarkers });
		}
		if (reverse) {
			const reverseRange = new Range(reverseStartLine, reverseStartColumn, reverseEndLine, reverseEndColumn);
			reverse.push({ sortIndex, identifier: input.identifier || null, range: reverseRange, text: oldText, textChange: new TextChange(rangeOffset, oldText, reverseOffset, text) });
		}
	}
	changes.reverse();
	if (reverse && !(flags & 8)) {
		reverse.sort((first, second) => first.sortIndex - second.sortIndex);
	}
	const trimLines: number[] | null = trimCount === 0xFFFFFFFF ? null : [];
	if (trimLines) {
		for (let index = 0; index < trimCount; index++) {
			trimLines.push(read());
		}
	}
	if (cursor !== bytes.length) {
		throw new Error('The Rust model edit result has trailing data');
	}
	return {
		mightContainNonBasicASCII: !!(flags & 1), mightContainRTL: !!(flags & 2), mightContainUnusualLineTerminators: !!(flags & 4),
		result: new ApplyEditsResult(reverse, changes, trimLines)
	};
}
