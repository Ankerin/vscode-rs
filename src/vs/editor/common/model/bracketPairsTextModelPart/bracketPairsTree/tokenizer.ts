/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotSupportedError } from '../../../../../base/common/errors.js';
import { StandardTokenType, TokenMetadata } from '../../../encodedTokenAttributes.js';
import { IViewLineTokens } from '../../../tokens/lineTokens.js';
import { BracketAstNode, TextAstNode } from './ast.js';
import { BracketTokens, LanguageAgnosticBracketTokens } from './brackets.js';
import { Length, lengthAdd, lengthDiff, lengthGetColumnCountIfZeroLineCount, lengthToObj, lengthZero, toLength } from './length.js';
import { SmallImmutableSet } from './smallImmutableSet.js';
import { IRustBracketTokenizerHost, IRustPeekableBracketTokenizerHost, tryReadRustBracketToken, tryReadRustPeekableBracketToken, trySetRustBracketTokenPosition, trySkipRustBracketTokens } from './rustBracketTokenizer.js';
import { IRustFastBracketTokenizerHost, tryBuildRustFastBracketTokens } from './rustFastBracketTokenizer.js';
import { ownRustBracketNumericState, RustBracketNumericStateKind } from './rustBracketNodeMetadata.js';

export interface Tokenizer {
	readonly offset: Length;
	readonly length: Length;

	read(): Token | null;
	peek(): Token | null;
	skip(length: Length): void;

	getText(): string;
}

export const enum TokenKind {
	Text = 0,
	OpeningBracket = 1,
	ClosingBracket = 2,
}

export type OpeningBracketId = number;

export class Token {
	constructor(
		readonly length: Length,
		readonly kind: TokenKind,
		/**
		 * If this token is an opening bracket, this is the id of the opening bracket.
		 * If this token is a closing bracket, this is the id of the first opening bracket that is closed by this bracket.
		 * Otherwise, it is -1.
		 */
		readonly bracketId: OpeningBracketId,
		/**
		 * If this token is an opening bracket, this just contains `bracketId`.
		 * If this token is a closing bracket, this lists all opening bracket ids, that it closes.
		 * Otherwise, it is empty.
		 */
		readonly bracketIds: SmallImmutableSet<OpeningBracketId>,
		readonly astNode: BracketAstNode | TextAstNode | undefined,
	) {
		return ownRustBracketNumericState(this, RustBracketNumericStateKind.Token);
	}
}

export interface ITokenizerSource {
	getValue(): string;
	getLineCount(): number;
	getLineLength(lineNumber: number): number;

	tokenization: {
		getLineTokens(lineNumber: number): IViewLineTokens;
	};
}

export class TextBufferTokenizer implements Tokenizer {
	private readonly textBufferLineCount: number;
	private readonly textBufferLastLineLength: number;

	private readonly reader;

	constructor(
		private readonly textModel: ITokenizerSource,
		private readonly bracketTokens: LanguageAgnosticBracketTokens
	) {
		this.reader = new NonPeekableTextBufferTokenizer(this.textModel, this.bracketTokens);
		this._offset = lengthZero;
		this.didPeek = false;
		this.peeked = null;
		this.textBufferLineCount = textModel.getLineCount();
		this.textBufferLastLineLength = textModel.getLineLength(this.textBufferLineCount);
		return ownRustBracketNumericState(this, RustBracketNumericStateKind.TextBufferTokenizer);
	}

	private _offset: Length;

	get offset() {
		return this._offset;
	}

	get length() {
		return toLength(this.textBufferLineCount - 1, this.textBufferLastLineLength);
	}

	getText() {
		return this.textModel.getValue();
	}

	skip(length: Length): void {
		if (trySkipRustBracketTokens(length, () => TextBufferTokenizer.createRustHost(this))) { return; }
		this.didPeek = false;
		this._offset = lengthAdd(this._offset, length);
		const obj = lengthToObj(this._offset);
		this.reader.setPosition(obj.lineCount, obj.columnCount);
	}

	private didPeek;
	private peeked: Token | null;

	read(): Token | null {
		const native = tryReadRustPeekableBracketToken(false, () => TextBufferTokenizer.createRustHost(this));
		if (native !== undefined) { return native.token; }
		let token: Token | null;
		if (this.peeked) {
			this.didPeek = false;
			token = this.peeked;
		} else {
			token = this.reader.read();
		}
		if (token) {
			this._offset = lengthAdd(this._offset, token.length);
		}
		return token;
	}

	peek(): Token | null {
		const native = tryReadRustPeekableBracketToken(true, () => TextBufferTokenizer.createRustHost(this));
		if (native !== undefined) { return native.token; }
		if (!this.didPeek) {
			this.peeked = this.reader.read();
			this.didPeek = true;
		}
		return this.peeked;
	}

	/** Static capabilities preserve the wrapper's original receiver and reader observations. */
	private static createRustHost(tokenizer: TextBufferTokenizer): IRustPeekableBracketTokenizerHost {
		return {
			peeked: () => tokenizer.peeked,
			truthy: token => !!token,
			didPeek: () => !!tokenizer.didPeek,
			setDidPeek: value => { tokenizer.didPeek = value; },
			setPeeked: token => { tokenizer.peeked = token; },
			read: () => tokenizer.reader.read(),
			advanceToken: token => { tokenizer._offset = lengthAdd(tokenizer._offset, token.length); },
			advanceLength: length => { tokenizer._offset = lengthAdd(tokenizer._offset, length); },
			updatePosition: () => { const obj = lengthToObj(tokenizer._offset); tokenizer.reader.setPosition(obj.lineCount, obj.columnCount); }
		};
	}
}

/**
 * Does not support peek.
*/
class NonPeekableTextBufferTokenizer {
	private readonly textBufferLineCount: number;
	private readonly textBufferLastLineLength: number;

	constructor(private readonly textModel: ITokenizerSource, private readonly bracketTokens: LanguageAgnosticBracketTokens) {
		this.textBufferLineCount = textModel.getLineCount();
		this.textBufferLastLineLength = textModel.getLineLength(this.textBufferLineCount);
		return ownRustBracketNumericState(this, RustBracketNumericStateKind.NonPeekableTokenizer);
	}

	private lineIdx = 0;
	private line: string | null = null;
	private lineCharOffset = 0;
	private lineTokens: IViewLineTokens | null = null;
	private lineTokenOffset = 0;

	public setPosition(lineIdx: number, column: number): void {
		if (trySetRustBracketTokenPosition(lineIdx, column, () => NonPeekableTextBufferTokenizer.createRustHost(this))) { return; }
		// We must not jump into a token!
		if (lineIdx === this.lineIdx) {
			this.lineCharOffset = column;
			if (this.line !== null) {
				this.lineTokenOffset = this.lineCharOffset === 0 ? 0 : this.lineTokens!.findTokenIndexAtOffset(this.lineCharOffset);
			}
		} else {
			this.lineIdx = lineIdx;
			this.lineCharOffset = column;
			this.line = null;
		}
		this.peekedToken = null;
	}

	/** Must be a zero line token. The end of the document cannot be peeked. */
	private peekedToken: Token | null = null;

	public read(): Token | null {
		const native = tryReadRustBracketToken(() => NonPeekableTextBufferTokenizer.createRustHost(this));
		if (native !== undefined) { return native.token; }
		if (this.peekedToken) {
			const token = this.peekedToken;
			this.peekedToken = null;
			this.lineCharOffset += lengthGetColumnCountIfZeroLineCount(token.length);
			return token;
		}

		if (this.lineIdx > this.textBufferLineCount - 1 || (this.lineIdx === this.textBufferLineCount - 1 && this.lineCharOffset >= this.textBufferLastLineLength)) {
			// We are after the end
			return null;
		}

		if (this.line === null) {
			this.lineTokens = this.textModel.tokenization.getLineTokens(this.lineIdx + 1);
			this.line = this.lineTokens.getLineContent();
			this.lineTokenOffset = this.lineCharOffset === 0 ? 0 : this.lineTokens.findTokenIndexAtOffset(this.lineCharOffset);
		}

		const startLineIdx = this.lineIdx;
		const startLineCharOffset = this.lineCharOffset;

		// limits the length of text tokens.
		// If text tokens get too long, incremental updates will be slow
		let lengthHeuristic = 0;
		while (true) {
			const lineTokens = this.lineTokens!;
			const tokenCount = lineTokens.getCount();

			let peekedBracketToken: Token | null = null;

			if (this.lineTokenOffset < tokenCount) {
				const tokenMetadata = lineTokens.getMetadata(this.lineTokenOffset);
				while (this.lineTokenOffset + 1 < tokenCount && tokenMetadata === lineTokens.getMetadata(this.lineTokenOffset + 1)) {
					// Skip tokens that are identical.
					// Sometimes, (bracket) identifiers are split up into multiple tokens.
					this.lineTokenOffset++;
				}

				const isOther = TokenMetadata.getTokenType(tokenMetadata) === StandardTokenType.Other;
				const containsBracketType = TokenMetadata.containsBalancedBrackets(tokenMetadata);

				const endOffset = lineTokens.getEndOffset(this.lineTokenOffset);
				// Is there a bracket token next? Only consume text.
				if (containsBracketType && isOther && this.lineCharOffset < endOffset) {
					const languageId = lineTokens.getLanguageId(this.lineTokenOffset);
					const text = this.line.substring(this.lineCharOffset, endOffset);

					const brackets = this.bracketTokens.getSingleLanguageBracketTokens(languageId);
					const regexp = brackets.regExpGlobal;
					if (regexp) {
						regexp.lastIndex = 0;
						const match = regexp.exec(text);
						if (match) {
							peekedBracketToken = brackets.getToken(match[0])!;
							if (peekedBracketToken) {
								// Consume leading text of the token
								this.lineCharOffset += match.index;
							}
						}
					}
				}

				lengthHeuristic += endOffset - this.lineCharOffset;

				if (peekedBracketToken) {
					// Don't skip the entire token, as a single token could contain multiple brackets.

					if (startLineIdx !== this.lineIdx || startLineCharOffset !== this.lineCharOffset) {
						// There is text before the bracket
						this.peekedToken = peekedBracketToken;
						break;
					} else {
						// Consume the peeked token
						this.lineCharOffset += lengthGetColumnCountIfZeroLineCount(peekedBracketToken.length);
						return peekedBracketToken;
					}
				} else {
					// Skip the entire token, as the token contains no brackets at all.
					this.lineTokenOffset++;
					this.lineCharOffset = endOffset;
				}
			} else {
				if (this.lineIdx === this.textBufferLineCount - 1) {
					break;
				}
				this.lineIdx++;
				this.lineTokens = this.textModel.tokenization.getLineTokens(this.lineIdx + 1);
				this.lineTokenOffset = 0;
				this.line = this.lineTokens.getLineContent();
				this.lineCharOffset = 0;

				lengthHeuristic += 33; // max 1000/33 = 30 lines
				// This limits the amount of work to recompute min-indentation

				if (lengthHeuristic > 1000) {
					// only break (automatically) at the end of line.
					break;
				}
			}

			if (lengthHeuristic > 1500) {
				// Eventually break regardless of the line length so that
				// very long lines do not cause bad performance.
				// This effective limits max indentation to 500, as
				// indentation is not computed across multiple text nodes.
				break;
			}
		}

		// If a token contains some proper indentation, it also contains \n{INDENTATION+}(?!{INDENTATION}),
		// unless the line is too long.
		// Thus, the min indentation of the document is the minimum min indentation of every text node.
		const length = lengthDiff(startLineIdx, startLineCharOffset, this.lineIdx, this.lineCharOffset);
		return new Token(length, TokenKind.Text, -1, SmallImmutableSet.getEmpty(), new TextAstNode(length));
	}

	/** Provider capabilities retain method lookup before arguments and exact partial assignments. */
	private static createRustHost(reader: NonPeekableTextBufferTokenizer): IRustBracketTokenizerHost {
		return {
			add: (first, second) => first + second,
			subtract: (first, second) => first - second,
			greater: (first, second) => first > second,
			truthy: value => !!value,
			peeked: () => reader.peekedToken,
			setPeeked: token => { reader.peekedToken = token; },
			consume: token => { reader.lineCharOffset += lengthGetColumnCountIfZeroLineCount(token.length); },
			atEnd: () => reader.lineIdx > reader.textBufferLineCount - 1 || (reader.lineIdx === reader.textBufferLineCount - 1 && reader.lineCharOffset >= reader.textBufferLastLineLength),
			lineMissing: () => reader.line === null,
			loadTokens: () => { reader.lineTokens = reader.textModel.tokenization.getLineTokens(reader.lineIdx + 1); },
			loadLine: () => { reader.line = reader.lineTokens!.getLineContent(); },
			selectIndex: () => { reader.lineTokenOffset = reader.lineCharOffset === 0 ? 0 : reader.lineTokens!.findTokenIndexAtOffset(reader.lineCharOffset); },
			lineIndex: () => reader.lineIdx,
			column: () => reader.lineCharOffset,
			tokens: () => reader.lineTokens!,
			count: tokens => tokens.getCount(),
			hasToken: count => reader.lineTokenOffset < count,
			metadata: tokens => tokens.getMetadata(reader.lineTokenOffset),
			identical: (tokens, count, metadata) => reader.lineTokenOffset + 1 < count && metadata === tokens.getMetadata(reader.lineTokenOffset + 1),
			incrementIndex: () => { reader.lineTokenOffset++; },
			isOther: metadata => TokenMetadata.getTokenType(metadata) === StandardTokenType.Other,
			containsBrackets: metadata => TokenMetadata.containsBalancedBrackets(metadata),
			endOffset: tokens => tokens.getEndOffset(reader.lineTokenOffset),
			beforeEnd: end => reader.lineCharOffset < end,
			language: tokens => tokens.getLanguageId(reader.lineTokenOffset),
			text: end => reader.line!.substring(reader.lineCharOffset, end),
			brackets: language => reader.bracketTokens.getSingleLanguageBracketTokens(language),
			regexp: brackets => brackets.regExpGlobal,
			resetRegexp: regexp => { regexp.lastIndex = 0; },
			exec: (regexp, text) => regexp.exec(text),
			matchedToken: (brackets, matched) => brackets.getToken(matched[0]),
			consumeMatch: matched => { reader.lineCharOffset += matched.index; },
			changed: (line, column) => line !== reader.lineIdx || column !== reader.lineCharOffset,
			setColumn: column => { reader.lineCharOffset = column; },
			lastLine: () => reader.lineIdx === reader.textBufferLineCount - 1,
			incrementLine: () => { reader.lineIdx++; },
			zeroIndex: () => { reader.lineTokenOffset = 0; },
			finishText: (line, column) => { const length = lengthDiff(line, column, reader.lineIdx, reader.lineCharOffset); return new Token(length, TokenKind.Text, -1, SmallImmutableSet.getEmpty(), new TextAstNode(length)); },
			sameLine: line => line === reader.lineIdx,
			setLine: line => { reader.lineIdx = line; },
			clearLine: () => { reader.line = null; }
		};
	}
}

export class FastTokenizer implements Tokenizer {
	private _offset: Length = lengthZero;
	private readonly tokens: readonly Token[];
	private idx = 0;

	constructor(private readonly text: string, brackets: BracketTokens) {
		const regExpStr = brackets.getRegExpStr();
		const regexp = regExpStr ? new RegExp(regExpStr + '|\n', 'gi') : null;

		const tokens: Token[] = [];
		const native = tryBuildRustFastBracketTokens(() => FastTokenizer.createRustHost(text, brackets, regexp, tokens));
		if (native !== undefined) {
			this.length = native.length;
			this.tokens = tokens;
			return ownRustBracketNumericState(this, RustBracketNumericStateKind.FastTokenizer);
		}

		let match: RegExpExecArray | null;
		let curLineCount = 0;
		let lastLineBreakOffset = 0;

		let lastTokenEndOffset = 0;
		let lastTokenEndLine = 0;

		const smallTextTokens0Line: Token[] = [];
		for (let i = 0; i < 60; i++) {
			smallTextTokens0Line.push(
				new Token(
					toLength(0, i), TokenKind.Text, -1, SmallImmutableSet.getEmpty(),
					new TextAstNode(toLength(0, i))
				)
			);
		}

		const smallTextTokens1Line: Token[] = [];
		for (let i = 0; i < 60; i++) {
			smallTextTokens1Line.push(
				new Token(
					toLength(1, i), TokenKind.Text, -1, SmallImmutableSet.getEmpty(),
					new TextAstNode(toLength(1, i))
				)
			);
		}

		if (regexp) {
			regexp.lastIndex = 0;
			// If a token contains indentation, it also contains \n{INDENTATION+}(?!{INDENTATION})
			while ((match = regexp.exec(text)) !== null) {
				const curOffset = match.index;
				const value = match[0];
				if (value === '\n') {
					curLineCount++;
					lastLineBreakOffset = curOffset + 1;
				} else {
					if (lastTokenEndOffset !== curOffset) {
						let token: Token;
						if (lastTokenEndLine === curLineCount) {
							const colCount = curOffset - lastTokenEndOffset;
							if (colCount < smallTextTokens0Line.length) {
								token = smallTextTokens0Line[colCount];
							} else {
								const length = toLength(0, colCount);
								token = new Token(length, TokenKind.Text, -1, SmallImmutableSet.getEmpty(), new TextAstNode(length));
							}
						} else {
							const lineCount = curLineCount - lastTokenEndLine;
							const colCount = curOffset - lastLineBreakOffset;
							if (lineCount === 1 && colCount < smallTextTokens1Line.length) {
								token = smallTextTokens1Line[colCount];
							} else {
								const length = toLength(lineCount, colCount);
								token = new Token(length, TokenKind.Text, -1, SmallImmutableSet.getEmpty(), new TextAstNode(length));
							}
						}
						tokens.push(token);
					}

					// value is matched by regexp, so the token must exist
					tokens.push(brackets.getToken(value)!);

					lastTokenEndOffset = curOffset + value.length;
					lastTokenEndLine = curLineCount;
				}
			}
		}

		const offset = text.length;

		if (lastTokenEndOffset !== offset) {
			const length = (lastTokenEndLine === curLineCount)
				? toLength(0, offset - lastTokenEndOffset)
				: toLength(curLineCount - lastTokenEndLine, offset - lastLineBreakOffset);
			tokens.push(new Token(length, TokenKind.Text, -1, SmallImmutableSet.getEmpty(), new TextAstNode(length)));
		}

		this.length = toLength(curLineCount, offset - lastLineBreakOffset);
		this.tokens = tokens;
		return ownRustBracketNumericState(this, RustBracketNumericStateKind.FastTokenizer);
	}

	get offset(): Length {
		return this._offset;
	}

	readonly length: Length;

	read(): Token | null {
		return this.tokens[this.idx++] || null;
	}

	peek(): Token | null {
		return this.tokens[this.idx] || null;
	}

	skip(length: Length): void {
		throw new NotSupportedError();
	}

	getText(): string {
		return this.text;
	}

	/** Static capabilities retain original cache aliases, regular expressions, and inline factories. */
	private static createRustHost(text: string, brackets: BracketTokens, regexp: RegExp | null, tokens: Token[]): IRustFastBracketTokenizerHost {
		return {
			add: (first, second) => first + second,
			subtract: (first, second) => first - second,
			equal: (first, second) => first === second,
			cache: () => [],
			populate: (cache, line, column) => { cache.push(new Token(toLength(line, column), TokenKind.Text, -1, SmallImmutableSet.getEmpty(), new TextAstNode(toLength(line, column)))); },
			hasRegexp: () => !!regexp,
			resetRegexp: () => { regexp!.lastIndex = 0; },
			nextMatch: () => regexp!.exec(text),
			matchIsNull: matched => matched === null,
			matchIndex: matched => matched.index,
			matchValue: matched => matched[0],
			lineBreak: value => value === '\n',
			afterBreak: index => index + 1,
			shortCache: (cache, column) => column < cache.length,
			cachedToken: (cache, column) => cache[column],
			textToken: (line, column) => { const length = toLength(line, column); return new Token(length, TokenKind.Text, -1, SmallImmutableSet.getEmpty(), new TextAstNode(length)); },
			pushToken: token => { tokens.push(token); },
			pushBracket: value => { tokens.push(brackets.getToken(value)!); },
			valueLength: value => value.length,
			textLength: () => text.length,
			length: (line, column) => toLength(line, column),
			pushText: length => { tokens.push(new Token(length, TokenKind.Text, -1, SmallImmutableSet.getEmpty(), new TextAstNode(length))); }
		};
	}
}
