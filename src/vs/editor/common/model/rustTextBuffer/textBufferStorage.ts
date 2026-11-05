/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Position } from '../../core/position.js';
import { Range } from '../../core/range.js';
import { FindMatch, ITextSnapshot, SearchData } from '../../model.js';
import { StringBuffer } from '../pieceTreeTextBuffer/pieceTreeBase.js';

/** Storage operations beneath the existing edit, undo, and notification implementation. */
export interface ITextBufferStorage {
	getEOL(): '\r\n' | '\n';
	setEOL(eol: '\r\n' | '\n'): void;
	createSnapshot(BOM: string): ITextSnapshot;
	getOffsetAt(lineNumber: number, column: number): number;
	getPositionAt(offset: number): Position;
	getValueInRange(range: Range, eol?: string): string;
	getNearestChunk(offset: number): string;
	getLength(): number;
	getLineCount(): number;
	getLinesContent(): string[];
	getLineContent(lineNumber: number): string;
	getLineCharCode(lineNumber: number, index: number): number;
	getCharCode(offset: number): number;
	getLineLength(lineNumber: number): number;
	insert(offset: number, value: string, eolNormalized?: boolean): void;
	delete(offset: number, length: number): void;
	findMatchesLineByLine(searchRange: Range, searchData: SearchData, captureMatches: boolean, limitResultCount: number): FindMatch[];
}

export type TextBufferStorageFactory = (chunks: StringBuffer[], eol: '\r\n' | '\n', eolNormalized: boolean) => ITextBufferStorage & IDisposable;

let storageFactory: TextBufferStorageFactory | undefined;

/** Installs storage for subsequently created models, without changing existing documents. */
export function registerTextBufferStorageFactory(factory: TextBufferStorageFactory): IDisposable {
	if (storageFactory) {
		throw new Error('A text buffer storage factory is already registered');
	}
	storageFactory = factory;
	return toDisposable(() => {
		if (storageFactory === factory) {
			storageFactory = undefined;
		}
	});
}

export function createRegisteredTextBufferStorage(chunks: StringBuffer[], eol: '\r\n' | '\n', eolNormalized: boolean): (ITextBufferStorage & IDisposable) | undefined {
	return storageFactory?.(chunks, eol, eolNormalized);
}
