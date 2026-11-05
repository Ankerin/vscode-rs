/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { Position } from '../../core/position.js';
import { Range } from '../../core/range.js';
import { FindMatch, ITextSnapshot, SearchData } from '../../model.js';
import { Searcher, createFindMatch, isValidMatch } from '../textModelSearch.js';
import { StringBuffer } from '../pieceTreeTextBuffer/pieceTreeBase.js';
import { ITextBufferStorage, registerTextBufferStorageFactory } from './textBufferStorage.js';

/** The generated binding surface; UTF-16 arrays preserve JavaScript string semantics. */
export interface IRustTextBuffer {
	length(): number;
	line_count(): number;
	replace(offset: number, length: number, units: Uint16Array): void;
	slice(offset: number, length: number): Uint16Array;
	offset_at(lineNumber: number, column: number): number;
	position_at(offset: number): Uint32Array;
	line_content(lineNumber: number): Uint16Array;
	line_length(lineNumber: number): number;
	char_code(offset: number): number;
	nearest_chunk(offset: number): Uint16Array;
	normalize_eol(crlf: boolean): void;
	snapshot(): IRustTextSnapshot;
	free(): void;
}

interface IRustTextSnapshot {
	read(): Uint16Array | undefined;
	free(): void;
}

export interface IRustTextBufferModule {
	WasmTextBuffer: new (units: Uint16Array) => IRustTextBuffer;
}

function toUnits(text: string): Uint16Array {
	const units = new Uint16Array(text.length);
	for (let index = 0; index < text.length; index++) {
		units[index] = text.charCodeAt(index);
	}
	return units;
}

const utf16Decoder = new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true });
const isLittleEndian = new Uint8Array(new Uint16Array([0x0102]).buffer)[0] === 0x02;

function fromUnits(units: Uint16Array): string {
	if (isLittleEndian) {
		try {
			return utf16Decoder.decode(new Uint8Array(units.buffer, units.byteOffset, units.byteLength));
		} catch {
			// JavaScript permits unpaired surrogates; preserve them through the code-unit fallback.
		}
	}
	const chunks: string[] = [];
	for (let offset = 0; offset < units.length; offset += 8192) {
		chunks.push(String.fromCharCode(...units.subarray(offset, offset + 8192)));
	}
	return chunks.join('');
}

/** Keeps rendering, edit validation, notifications, and undo in their existing implementation. */
class RustTextBufferStorage implements ITextBufferStorage, IDisposable {
	private readonly _buffer: IRustTextBuffer;
	private _disposed = false;
	private _cachedLine: { lineNumber: number; text: string } | undefined;

	constructor(module: IRustTextBufferModule, chunks: StringBuffer[], private _eol: '\r\n' | '\n', private _eolNormalized: boolean) {
		this._buffer = new module.WasmTextBuffer(new Uint16Array(0));
		try {
			for (const chunk of chunks) {
				this._buffer.replace(this._buffer.length(), 0, toUnits(chunk.buffer));
			}
		} catch (error) {
			this._buffer.free();
			throw error;
		}
	}

	public dispose(): void {
		if (!this._disposed) {
			this._disposed = true;
			this._cachedLine = undefined;
			this._buffer.free();
		}
	}

	public getEOL(): '\r\n' | '\n' { return this._eol; }
	public getLength(): number { return this._buffer.length(); }
	public getLineCount(): number { return this._buffer.line_count(); }
	public getLineLength(lineNumber: number): number { return this._buffer.line_length(lineNumber); }
	public getOffsetAt(lineNumber: number, column: number): number { return this._buffer.offset_at(lineNumber, column); }
	public getNearestChunk(offset: number): string { return fromUnits(this._buffer.nearest_chunk(offset)); }
	public getCharCode(offset: number): number { return Math.max(0, this._buffer.char_code(offset)); }
	public getLineCharCode(lineNumber: number, index: number): number { return this.getCharCode(this.getOffsetAt(lineNumber, index + 1)); }

	public getPositionAt(offset: number): Position {
		const position = this._buffer.position_at(Math.min(this.getLength(), Math.max(0, Math.floor(offset))));
		return new Position(position[0], position[1]);
	}

	public getLineContent(lineNumber: number): string {
		if (this._cachedLine?.lineNumber !== lineNumber) {
			this._cachedLine = { lineNumber, text: fromUnits(this._buffer.line_content(lineNumber)) };
		}
		return this._cachedLine.text;
	}

	public getLinesContent(): string[] {
		const lines: string[] = [];
		for (let lineNumber = 1; lineNumber <= this.getLineCount(); lineNumber++) {
			lines.push(this.getLineContent(lineNumber));
		}
		return lines;
	}

	public getValueInRange(range: Range, eol?: string): string {
		const start = this.getOffsetAt(range.startLineNumber, range.startColumn);
		const end = this.getOffsetAt(range.endLineNumber, range.endColumn);
		const text = fromUnits(this._buffer.slice(start, end - start));
		return eol && (eol !== this._eol || !this._eolNormalized) ? text.replace(/\r\n|\r|\n/g, eol) : text;
	}

	public setEOL(eol: '\r\n' | '\n'): void {
		this._buffer.normalize_eol(eol === '\r\n');
		this._eol = eol;
		this._eolNormalized = true;
		this._cachedLine = undefined;
	}

	public insert(offset: number, value: string, eolNormalized: boolean = false): void {
		this._buffer.replace(offset, 0, toUnits(value));
		this._eolNormalized = this._eolNormalized && eolNormalized;
		this._cachedLine = undefined;
	}

	public delete(offset: number, length: number): void {
		this._buffer.replace(offset, length, new Uint16Array(0));
		this._cachedLine = undefined;
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
export function registerRustTextBuffer(module: IRustTextBufferModule): IDisposable {
	return registerTextBufferStorageFactory((chunks, eol, eolNormalized) => new RustTextBufferStorage(module, chunks, eol, eolNormalized));
}
