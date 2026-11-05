/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Position } from '../../core/position.js';
import { Range } from '../../core/range.js';
import { ApplyEditsResult, FindMatch, IIndentationFoldingRanges, ITextSnapshot, SearchData, ValidAnnotatedEditOperation } from '../../model.js';
import { createLineStartsFast, StringBuffer } from '../pieceTreeTextBuffer/pieceTreeBase.js';
import type { IGuessedIndentation } from '../indentationGuesser.js';
import type { IActiveIndentGuideInfo } from '../../textModelGuides.js';

/** A replacement in the original document's UTF-16 coordinates, ordered from bottom to top. */
export interface ITextBufferStorageEdit {
	readonly rangeOffset: number;
	readonly rangeLength: number;
	readonly text: string;
}

/** Sticky text properties retained by model consumers across edits. */
export interface ITextBufferFlags {
	readonly mightContainNonBasicASCII: boolean;
	readonly mightContainRTL: boolean;
	readonly mightContainUnusualLineTerminators: boolean;
}

/** A completed native transaction using the existing model result contract. */
export interface ITextBufferModelEditsResult extends ITextBufferFlags {
	readonly result: ApplyEditsResult;
}

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
	getLineFirstNonWhitespaceColumn?(lineNumber: number): number;
	getLineLastNonWhitespaceColumn?(lineNumber: number): number;
	/** Counts visible characters without transferring whole lines when the range is supported. */
	getCharacterCountInRange?(range: Range, eol: string): number | undefined;
	getGuessedIndentation?(defaultTabSize: number, defaultInsertSpaces: boolean): IGuessedIndentation;
	getIndentationFoldingRanges?(tabSize: number, offSide: boolean, limit: number, getMarker?: (lineNumber: number) => number): IIndentationFoldingRanges | undefined;
	getLinesIndentGuides?(startLineNumber: number, endLineNumber: number, tabSize: number, indentSize: number, offSide: boolean): number[] | undefined;
	getActiveIndentGuide?(lineNumber: number, minLineNumber: number, maxLineNumber: number, tabSize: number, indentSize: number, offSide: boolean): IActiveIndentGuideInfo | undefined;
	insert(offset: number, value: string, eolNormalized?: boolean): void;
	delete(offset: number, length: number): void;
	/** Applies validated replacements together when the storage supports atomic batches. */
	applyEdits?(operations: readonly ITextBufferStorageEdit[]): void;
	/** Applies the complete model edit transaction when supported; undefined leaves storage unchanged. */
	applyModelEdits?(operations: readonly ValidAnnotatedEditOperation[], flags: ITextBufferFlags, recordTrimAutoWhitespace: boolean, computeUndoEdits: boolean): ITextBufferModelEditsResult | undefined;
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

/** Constructs mirror storage lazily, retaining the original path for nonstandard line arrays. */
export function createRegisteredTextBufferStorageFromLines(lines: string[], eol: '\r\n' | '\n'): (ITextBufferStorage & IDisposable) | undefined {
	if (!storageFactory || lines.length === 0 || lines.some(line => /\r|\n/.test(line))) {
		return undefined;
	}
	const text = lines.join(eol);
	return storageFactory([new StringBuffer(text, createLineStartsFast(text))], eol, true);
}
