/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { decodeUTF16 as fromUnits, encodeUTF16 as toUnits } from '../../core/utf16Transfer.js';
import { Position } from '../../core/position.js';
import { Range } from '../../core/range.js';
import { FindMatch, IIndentationFoldingRanges, ITextSnapshot, SearchData, ValidAnnotatedEditOperation } from '../../model.js';
import { Searcher, createFindMatch, isValidMatch } from '../textModelSearch.js';
import { StringBuffer } from '../pieceTreeTextBuffer/pieceTreeBase.js';
import { ITextBufferFlags, ITextBufferModelEditsResult, ITextBufferStorage, ITextBufferStorageEdit, registerTextBufferStorageFactory } from './textBufferStorage.js';
import { IRustSequenceDiffModule, registerRustSequenceDiff } from '../../diff/defaultLinesDiffComputer/algorithms/rustSequenceDiff.js';
import { IRustTextChangeModule, registerRustTextChanges } from '../../core/rustTextChanges.js';
import { applyRustModelEdits, isSupportedRustTextRange } from './modelEdits.js';
import type { IGuessedIndentation } from '../indentationGuesser.js';
import type { IActiveIndentGuideInfo } from '../../textModelGuides.js';
import { IRustTokensModule, registerRustTokens } from '../../tokens/rustTokens.js';
import { IRustCursorColumnsModule, registerRustCursorColumns } from '../../core/rustCursorColumns.js';

/** The generated binding surface; UTF-16 arrays preserve JavaScript string semantics. */
export interface IRustTextBuffer {
	length(): number;
	line_count(): number;
	replace(offset: number, length: number, units: Uint16Array): void;
	replace_text(offset: number, length: number, text: string): void;
	apply_edits(ranges: Uint32Array, units: Uint16Array): void;
	apply_model_edits(operations: Uint32Array, units: Uint16Array, crlf: boolean, flags: number, recordTrimAutoWhitespace: boolean, computeUndoEdits: boolean): Uint8Array | undefined;
	slice(offset: number, length: number): Uint16Array;
	slice_text(offset: number, length: number): string | Uint16Array;
	offset_at(lineNumber: number, column: number): number;
	position_at(offset: number): Uint32Array;
	line_content(lineNumber: number): Uint16Array;
	first_non_whitespace_column(lineNumber: number): number;
	last_non_whitespace_column(lineNumber: number): number;
	character_count(startLine: number, startColumn: number, endLine: number, endColumn: number, eolLength: number): number | undefined;
	guess_indentation(defaultTabSize: number, defaultInsertSpaces: boolean): Float64Array;
	indent_guides(startLineNumber: number, endLineNumber: number, tabSize: number, indentSize: number, offSide: boolean): Float64Array | undefined;
	active_indent_guide(lineNumber: number, minLineNumber: number, maxLineNumber: number, tabSize: number, indentSize: number, offSide: boolean): Float64Array | undefined;
	indentation_folding(tabSize: number, offSide: boolean, limit: number, getMarker?: (lineNumber: number) => number | Uint8Array): Uint32Array | undefined;
	line_batch(startLine: number, maxLines: number, maxUnits: number): string | Uint16Array;
	backward_line_batch(endLine: number, maxLines: number, maxUnits: number): string | Uint16Array;
	find_literal(startLine: number, startColumn: number, endLine: number, endColumn: number, needle: Uint16Array, limit: number): Uint32Array;
	line_length(lineNumber: number): number;
	char_code(offset: number): number;
	nearest_chunk(offset: number): Uint16Array;
	normalize_eol(crlf: boolean): void;
	snapshot(): IRustTextSnapshot;
	free(): void;
}

interface IRustTextSnapshot {
	read(): string | Uint16Array | undefined;
	free(): void;
}

export interface IRustTextBufferModule extends IRustSequenceDiffModule, IRustTextChangeModule, IRustTokensModule, IRustCursorColumnsModule {
	text_buffer_abi_version(): number;
	WasmTextBuffer: {
		new(units: Uint16Array): IRustTextBuffer;
		from_text(text: string): IRustTextBuffer;
	};
}

/** Generated asset locations passed to isolated editor workers before synchronizing documents. */
export interface IRustTextBufferInitialization {
	readonly moduleUrl: string;
	readonly wasmUrl: string;
}

let registeredInitialization: IRustTextBufferInitialization | undefined;

/** Returns initialization data only while the renderer's Rust factory is installed. */
export function getRustTextBufferInitialization(): IRustTextBufferInitialization | undefined {
	return registeredInitialization;
}

// UTF-8 bindings replace lone surrogates. Keep surrogate-bearing input on the code-unit path.
const containsSurrogates = /[\uD800-\uDFFF]/;

/** Retains native text and edit transactions beneath the existing model and rendering contracts. */
class RustTextBufferStorage implements ITextBufferStorage, IDisposable {
	private readonly _buffer: IRustTextBuffer;
	private _disposed = false;
	private _cachedLines: { startLine: number; lines: string[] } | undefined;

	constructor(module: IRustTextBufferModule, chunks: StringBuffer[], private _eol: '\r\n' | '\n', private _eolNormalized: boolean) {
		const first = chunks[0]?.buffer ?? '';
		this._buffer = containsSurrogates.test(first) ? new module.WasmTextBuffer(toUnits(first)) : module.WasmTextBuffer.from_text(first);
		try {
			for (let index = 1; index < chunks.length; index++) {
				this.replace(this._buffer.length(), 0, chunks[index].buffer);
			}
		} catch (error) {
			this._buffer.free();
			throw error;
		}
	}

	public dispose(): void {
		if (!this._disposed) {
			this._disposed = true;
			this._cachedLines = undefined;
			this._buffer.free();
		}
	}

	public getEOL(): '\r\n' | '\n' { return this._eol; }
	public getLength(): number { return this._buffer.length(); }
	public getLineCount(): number { return this._buffer.line_count(); }
	public getLineLength(lineNumber: number): number { return this.getCachedLine(lineNumber)?.length ?? this._buffer.line_length(lineNumber); }
	public getLineFirstNonWhitespaceColumn(lineNumber: number): number { return this._buffer.first_non_whitespace_column(lineNumber); }
	public getLineLastNonWhitespaceColumn(lineNumber: number): number { return this._buffer.last_non_whitespace_column(lineNumber); }
	public getCharacterCountInRange(range: Range, eol: string): number | undefined {
		return isSupportedRustTextRange(range) ? this._buffer.character_count(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn, eol.length) : undefined;
	}
	public getGuessedIndentation(defaultTabSize: number, defaultInsertSpaces: boolean): IGuessedIndentation {
		const result = this._buffer.guess_indentation(defaultTabSize, defaultInsertSpaces);
		if (result.length !== 2) {
			throw new Error('The Rust indentation result does not match the current model contract');
		}
		return { tabSize: result[0], insertSpaces: result[1] !== 0 };
	}
	public getLinesIndentGuides(startLineNumber: number, endLineNumber: number, tabSize: number, indentSize: number, offSide: boolean): number[] | undefined {
		const result = this._buffer.indent_guides(startLineNumber, endLineNumber, tabSize, indentSize, offSide);
		if (!result) { return undefined; }
		if (result.length !== endLineNumber - startLineNumber + 1) {
			throw new Error('The Rust guide result does not match the current model contract');
		}
		return Array.from(result);
	}
	public getActiveIndentGuide(lineNumber: number, minLineNumber: number, maxLineNumber: number, tabSize: number, indentSize: number, offSide: boolean): IActiveIndentGuideInfo | undefined {
		const result = this._buffer.active_indent_guide(lineNumber, minLineNumber, maxLineNumber, tabSize, indentSize, offSide);
		if (!result) { return undefined; }
		if (result.length !== 3) {
			throw new Error('The Rust active guide result does not match the current model contract');
		}
		return { startLineNumber: result[0], endLineNumber: result[1], indent: result[2] };
	}
	public getIndentationFoldingRanges(tabSize: number, offSide: boolean, limit: number, getMarker?: (lineNumber: number) => number): IIndentationFoldingRanges | undefined {
		const result = this._buffer.indentation_folding(tabSize, offSide, limit, getMarker ? line => {
			if (this.getCachedLine(line) === undefined) {
				const lines = fromUnits(this._buffer.backward_line_batch(line, 64, 32768)).split(/\r\n|\r|\n/);
				this._cachedLines = { startLine: line - lines.length + 1, lines };
			}
			const cached = this._cachedLines!;
			const count = line - cached.startLine + 1;
			const markers = new Uint8Array(count);
			for (let index = count - 1; index >= 0; index--) {
				if (!/^[\t ]*$/.test(cached.lines[index])) {
					markers[index] = getMarker(cached.startLine + index);
				}
			}
			return markers;
		} : undefined);
		if (!result) {
			return undefined;
		}
		if (result.length % 2 !== 1 || result[0] < (result.length - 1) / 2) {
			throw new Error('The Rust folding result does not match the current model contract');
		}
		const length = (result.length - 1) / 2;
		return { startLineNumbers: result.subarray(1, 1 + length), endLineNumbers: result.subarray(1 + length), computed: result[0] };
	}
	public getOffsetAt(lineNumber: number, column: number): number { return this._buffer.offset_at(lineNumber, column); }
	public getNearestChunk(offset: number): string { return fromUnits(this._buffer.nearest_chunk(offset)); }
	public getCharCode(offset: number): number { return Math.max(0, this._buffer.char_code(offset)); }
	public getLineCharCode(lineNumber: number, index: number): number {
		const line = this.getCachedLine(lineNumber);
		return line !== undefined && index >= 0 && index < line.length ? line.charCodeAt(index) : this.getCharCode(this.getOffsetAt(lineNumber, index + 1));
	}

	public getPositionAt(offset: number): Position {
		const position = this._buffer.position_at(Math.min(this.getLength(), Math.max(0, Math.floor(offset))));
		return new Position(position[0], position[1]);
	}

	public getLineContent(lineNumber: number): string {
		const cached = this.getCachedLine(lineNumber);
		if (cached !== undefined) {
			return cached;
		}
		const consecutive = this._cachedLines && lineNumber === this._cachedLines.startLine + this._cachedLines.lines.length;
		const text = fromUnits(this._buffer.line_batch(lineNumber, consecutive ? 64 : 1, 32768));
		const lines = consecutive ? text.split(/\r\n|\r|\n/) : [text];
		this._cachedLines = { startLine: lineNumber, lines };
		return lines[0];
	}

	private getCachedLine(lineNumber: number): string | undefined {
		return this._cachedLines?.lines[lineNumber - this._cachedLines.startLine];
	}

	public getLinesContent(): string[] {
		const lines: string[] = [];
		const lineCount = this.getLineCount();
		for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
			lines.push(this.getLineContent(lineNumber));
		}
		return lines;
	}

	public getValueInRange(range: Range, eol?: string): string {
		const start = this.getOffsetAt(range.startLineNumber, range.startColumn);
		const end = this.getOffsetAt(range.endLineNumber, range.endColumn);
		const text = fromUnits(this._buffer.slice_text(start, end - start));
		return eol && (eol !== this._eol || !this._eolNormalized) ? text.replace(/\r\n|\r|\n/g, eol) : text;
	}

	public setEOL(eol: '\r\n' | '\n'): void {
		this._buffer.normalize_eol(eol === '\r\n');
		this._eol = eol;
		this._eolNormalized = true;
		this._cachedLines = undefined;
	}

	public insert(offset: number, value: string, eolNormalized: boolean = false): void {
		this.replace(offset, 0, value);
		this._eolNormalized = this._eolNormalized && eolNormalized;
		this._cachedLines = undefined;
	}

	public delete(offset: number, length: number): void {
		this._buffer.replace(offset, length, new Uint16Array(0));
		this._cachedLines = undefined;
	}

	public applyEdits(operations: readonly ITextBufferStorageEdit[]): void {
		if (operations.length === 0) {
			return;
		}
		if (operations.length === 1) {
			const operation = operations[0];
			this.replace(operation.rangeOffset, operation.rangeLength, operation.text);
		} else {
			let length = 0;
			for (const operation of operations) {
				length += operation.text.length;
			}
			const ranges = new Uint32Array(operations.length * 4);
			const units = new Uint16Array(length);
			let offset = 0;
			for (let index = 0; index < operations.length; index++) {
				const operation = operations[operations.length - index - 1];
				ranges[index * 4] = operation.rangeOffset;
				ranges[index * 4 + 1] = operation.rangeLength;
				ranges[index * 4 + 2] = offset;
				ranges[index * 4 + 3] = operation.text.length;
				for (let unit = 0; unit < operation.text.length; unit++) {
					units[offset++] = operation.text.charCodeAt(unit);
				}
			}
			this._buffer.apply_edits(ranges, units);
		}
		this._cachedLines = undefined;
	}

	public applyModelEdits(operations: readonly ValidAnnotatedEditOperation[], flags: ITextBufferFlags, recordTrimAutoWhitespace: boolean, computeUndoEdits: boolean): ITextBufferModelEditsResult | undefined {
		if (!this._eolNormalized) {
			return undefined;
		}
		const result = applyRustModelEdits(this._buffer, operations, this._eol === '\r\n', flags, recordTrimAutoWhitespace, computeUndoEdits);
		if (result) {
			this._cachedLines = undefined;
		}
		return result;
	}

	private replace(offset: number, length: number, text: string): void {
		if (containsSurrogates.test(text)) {
			this._buffer.replace(offset, length, toUnits(text));
		} else {
			this._buffer.replace_text(offset, length, text);
		}
	}

	public createSnapshot(BOM: string): ITextSnapshot {
		const snapshot = this._buffer.snapshot();
		let prefix = BOM;
		let finished = false;
		return {
			read: () => {
				if (finished) {
					return null;
				}
				const units = snapshot.read();
				if (units === undefined) {
					finished = true;
					snapshot.free();
					const result = prefix || null;
					prefix = '';
					return result;
				}
				const result = prefix + fromUnits(units);
				prefix = '';
				return result;
			}
		};
	}

	public findMatchesLineByLine(searchRange: Range, searchData: SearchData, captureMatches: boolean, limitResultCount: number): FindMatch[] {
		const result: FindMatch[] = [];
		if (!captureMatches && searchData.simpleSearch && !searchData.wordSeparators) {
			const search = searchData.simpleSearch;
			const limit = Number.isNaN(limitResultCount) ? 0xFFFFFFFF : Math.min(0xFFFFFFFF, Math.max(1, Math.ceil(limitResultCount)));
			const matches = this._buffer.find_literal(searchRange.startLineNumber, searchRange.startColumn, searchRange.endLineNumber, searchRange.endColumn, toUnits(search), limit);
			for (let index = 0; index < matches.length; index += 2) {
				result.push(new FindMatch(new Range(matches[index], matches[index + 1], matches[index], matches[index + 1] + search.length), null));
			}
			return result;
		}
		const searcher = new Searcher(searchData.wordSeparators, searchData.regex);
		for (let lineNumber = searchRange.startLineNumber; lineNumber <= searchRange.endLineNumber; lineNumber++) {
			const start = lineNumber === searchRange.startLineNumber ? searchRange.startColumn - 1 : 0;
			const end = lineNumber === searchRange.endLineNumber ? searchRange.endColumn - 1 : undefined;
			const content = this.getLineContent(lineNumber);
			const text = searchData.wordSeparators ? content.substring(start, end) : content;
			const deltaOffset = searchData.wordSeparators ? start : 0;
			const searchStart = searchData.wordSeparators ? 0 : start;
			const searchEnd = searchData.wordSeparators ? text.length : (end ?? text.length);
			if (!captureMatches && searchData.simpleSearch) {
				const search = searchData.simpleSearch;
				for (let index = text.indexOf(search, searchStart); index !== -1 && index < searchEnd; index = text.indexOf(search, index + search.length)) {
					if (!searchData.wordSeparators || isValidMatch(searchData.wordSeparators, text, text.length, index, search.length)) {
						result.push(new FindMatch(new Range(lineNumber, deltaOffset + index + 1, lineNumber, deltaOffset + index + search.length + 1), null));
						if (result.length >= limitResultCount) {
							return result;
						}
					}
				}
			} else {
				searcher.reset(searchStart);
				let match: RegExpExecArray | null;
				while ((match = searcher.next(text))) {
					if (match.index >= searchEnd) {
						break;
					}
					result.push(createFindMatch(new Range(lineNumber, deltaOffset + match.index + 1, lineNumber, deltaOffset + match.index + match[0].length + 1), match, captureMatches));
					if (result.length >= limitResultCount) {
						return result;
					}
				}
			}
		}
		return result;
	}
}

/** Installs an initialized Rust module for new models. Dispose the registration to restore defaults. */
export function registerRustTextBuffer(module: IRustTextBufferModule, initialization?: IRustTextBufferInitialization): IDisposable {
	if (typeof module.text_buffer_abi_version !== 'function' || module.text_buffer_abi_version() !== 8) {
		throw new Error('The Rust text buffer bindings do not match the current storage contract');
	}
	const registration = new DisposableStore();
	try {
		registration.add(registerTextBufferStorageFactory((chunks, eol, eolNormalized) => new RustTextBufferStorage(module, chunks, eol, eolNormalized)));
		registration.add(registerRustSequenceDiff(module));
		registration.add(registerRustTextChanges(module));
		registration.add(registerRustTokens(module));
		registration.add(registerRustCursorColumns(module));
	} catch (error) {
		registration.dispose();
		throw error;
	}
	registeredInitialization = initialization;
	return toDisposable(() => {
		registration.dispose();
		if (registeredInitialization === initialization) {
			registeredInitialization = undefined;
		}
	});
}
