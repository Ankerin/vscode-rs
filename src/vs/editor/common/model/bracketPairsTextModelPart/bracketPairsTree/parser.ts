/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AstNode, AstNodeKind, BracketAstNode, InvalidBracketAstNode, ListAstNode, PairAstNode, TextAstNode } from './ast.js';
import { BeforeEditPositionMapper, TextEditInfo } from './beforeEditPositionMapper.js';
import { SmallImmutableSet } from './smallImmutableSet.js';
import { lengthIsZero, lengthLessThan } from './length.js';
import { concat23Trees, concat23TreesOfSameHeight } from './concat23Trees.js';
import { NodeReader } from './nodeReader.js';
import { OpeningBracketId, Tokenizer, TokenKind } from './tokenizer.js';
import { IRustBracketParserHost, RustBracketParserOperation, tryCanReuseRustBracketNode, tryParseRustBrackets } from './rustBracketParser.js';

/**
 * Non incrementally built ASTs are immutable.
*/
export function parseDocument(tokenizer: Tokenizer, edits: TextEditInfo[], oldNode: AstNode | undefined, createImmutableLists: boolean): AstNode {
	const parser = new Parser(tokenizer, edits, oldNode, createImmutableLists);
	return parser.parseDocument();
}

/**
 * Non incrementally built ASTs are immutable.
*/
class Parser {
	private readonly oldNodeReader?: NodeReader;
	private readonly positionMapper: BeforeEditPositionMapper;
	private _itemsConstructed: number = 0;
	private _itemsFromCache: number = 0;

	/**
	 * Reports how many nodes were constructed in the last parse operation.
	*/
	get nodesConstructed() {
		return this._itemsConstructed;
	}

	/**
	 * Reports how many nodes were reused in the last parse operation.
	*/
	get nodesReused() {
		return this._itemsFromCache;
	}

	constructor(
		private readonly tokenizer: Tokenizer,
		edits: TextEditInfo[],
		oldNode: AstNode | undefined,
		private readonly createImmutableLists: boolean,
	) {
		if (oldNode && createImmutableLists) {
			throw new Error('Not supported');
		}

		this.oldNodeReader = oldNode ? new NodeReader(oldNode) : undefined;
		this.positionMapper = new BeforeEditPositionMapper(edits);
	}

	parseDocument(): AstNode {
		const native = tryParseRustBrackets(RustBracketParserOperation.Document, undefined, 0, () => Parser.createRustHost(this));
		if (native !== undefined) { return native.node as AstNode; }
		this._itemsConstructed = 0;
		this._itemsFromCache = 0;

		let result = this.parseList(SmallImmutableSet.getEmpty(), 0);
		if (!result) {
			result = ListAstNode.getEmpty();
		}

		return result;
	}

	private parseList(
		openedBracketIds: SmallImmutableSet<OpeningBracketId>,
		level: number,
	): AstNode | null {
		const native = tryParseRustBrackets(RustBracketParserOperation.List, openedBracketIds, level, () => Parser.createRustHost(this));
		if (native !== undefined) { return native.node as AstNode | null; }
		const items: AstNode[] = [];

		while (true) {
			let child = this.tryReadChildFromCache(openedBracketIds);

			if (!child) {
				const token = this.tokenizer.peek();
				if (
					!token ||
					(token.kind === TokenKind.ClosingBracket &&
						token.bracketIds.intersects(openedBracketIds))
				) {
					break;
				}

				child = this.parseChild(openedBracketIds, level + 1);
			}

			if (child.kind === AstNodeKind.List && child.childrenLength === 0) {
				continue;
			}

			items.push(child);
		}

		// When there is no oldNodeReader, all items are created from scratch and must have the same height.
		const result = this.oldNodeReader ? concat23Trees(items) : concat23TreesOfSameHeight(items, this.createImmutableLists);
		return result;
	}

	private tryReadChildFromCache(openedBracketIds: SmallImmutableSet<number>): AstNode | undefined {
		const native = tryParseRustBrackets(RustBracketParserOperation.Cache, openedBracketIds, 0, () => Parser.createRustHost(this));
		if (native !== undefined) { return native.node as AstNode | undefined; }
		if (this.oldNodeReader) {
			const maxCacheableLength = this.positionMapper.getDistanceToNextChange(this.tokenizer.offset);
			if (maxCacheableLength === null || !lengthIsZero(maxCacheableLength)) {
				const cachedNode = this.oldNodeReader.readLongestNodeAt(this.positionMapper.getOffsetBeforeChange(this.tokenizer.offset), curNode => {
					const native = tryCanReuseRustBracketNode(curNode, maxCacheableLength, openedBracketIds, () => Parser.createRustHost(this));
					if (native !== undefined) { return native; }
					// The edit could extend the ending token, thus we cannot re-use nodes that touch the edit.
					// If there is no edit anymore, we can re-use the node in any case.
					if (maxCacheableLength !== null && !lengthLessThan(curNode.length, maxCacheableLength)) {
						// Either the node contains edited text or touches edited text.
						// In the latter case, brackets might have been extended (`end` -> `ending`), so even touching nodes cannot be reused.
						return false;
					}
					const canBeReused = curNode.canBeReused(openedBracketIds);
					return canBeReused;
				});

				if (cachedNode) {
					this._itemsFromCache++;
					this.tokenizer.skip(cachedNode.length);
					return cachedNode;
				}
			}
		}
		return undefined;
	}

	private parseChild(
		openedBracketIds: SmallImmutableSet<number>,
		level: number,
	): AstNode {
		const native = tryParseRustBrackets(RustBracketParserOperation.Child, openedBracketIds, level, () => Parser.createRustHost(this));
		if (native !== undefined) { return native.node as AstNode; }
		this._itemsConstructed++;

		const token = this.tokenizer.read()!;

		switch (token.kind) {
			case TokenKind.ClosingBracket:
				return new InvalidBracketAstNode(token.bracketIds, token.length);

			case TokenKind.Text:
				return token.astNode as TextAstNode;

			case TokenKind.OpeningBracket: {
				if (level > 300) {
					// To prevent stack overflows
					return new TextAstNode(token.length);
				}

				const set = openedBracketIds.merge(token.bracketIds);
				const child = this.parseList(set, level + 1);

				const nextToken = this.tokenizer.peek();
				if (
					nextToken &&
					nextToken.kind === TokenKind.ClosingBracket &&
					(nextToken.bracketId === token.bracketId || nextToken.bracketIds.intersects(token.bracketIds))
				) {
					this.tokenizer.read();
					return PairAstNode.create(
						token.astNode as BracketAstNode,
						child,
						nextToken.astNode as BracketAstNode
					);
				} else {
					return PairAstNode.create(
						token.astNode as BracketAstNode,
						child,
						null
					);
				}
			}
			default:
				throw new Error('unexpected');
		}
	}

	/** Static capabilities retain the original parser's field, argument, and virtual-method order. */
	private static createRustHost(parser: Parser): IRustBracketParserHost {
		return {
			nodeExists: node => !!node,
			resetCounters: () => { parser._itemsConstructed = 0; parser._itemsFromCache = 0; },
			parseRoot: () => parser.parseList(SmallImmutableSet.getEmpty(), 0),
			empty: () => ListAstNode.getEmpty(),
			newItems: () => [],
			cached: opened => parser.tryReadChildFromCache(opened),
			peek: () => parser.tokenizer.peek(),
			tokenExists: token => !!token,
			closesOpened: (token, opened) => token.kind === TokenKind.ClosingBracket && token.bracketIds.intersects(opened),
			parseChild: (opened, level) => parser.parseChild(opened, level),
			emptyList: node => node.kind === AstNodeKind.List && node.childrenLength === 0,
			push: (items, node) => { items.push(node); },
			concat: items => parser.oldNodeReader ? concat23Trees(items) : concat23TreesOfSameHeight(items, parser.createImmutableLists),
			hasReader: () => !!parser.oldNodeReader,
			cacheableLength: () => parser.positionMapper.getDistanceToNextChange(parser.tokenizer.offset),
			cacheable: length => length === null || !lengthIsZero(length),
			readCache: (maximum, opened) => parser.oldNodeReader!.readLongestNodeAt(parser.positionMapper.getOffsetBeforeChange(parser.tokenizer.offset), node => {
				const native = tryCanReuseRustBracketNode(node, maximum, opened, () => Parser.createRustHost(parser));
				if (native !== undefined) { return native; }
				if (maximum !== null && !lengthLessThan(node.length, maximum)) { return false; }
				return node.canBeReused(opened);
			}),
			incrementCached: () => { parser._itemsFromCache++; },
			skipNode: node => parser.tokenizer.skip(node.length),
			lengthAccepts: (node, maximum) => maximum === null || lengthLessThan(node.length, maximum),
			canReuse: (node, opened) => node.canBeReused(opened),
			incrementConstructed: () => { parser._itemsConstructed++; },
			read: () => parser.tokenizer.read(),
			tokenKind: token => token.kind,
			invalid: token => new InvalidBracketAstNode(token.bracketIds, token.length),
			text: token => token.astNode as TextAstNode,
			newText: token => new TextAstNode(token.length),
			merge: (opened, token) => opened.merge(token.bracketIds),
			parseList: (opened, level) => parser.parseList(opened, level),
			closesPair: (closing, opening) => closing.kind === TokenKind.ClosingBracket && (closing.bracketId === opening.bracketId || closing.bracketIds.intersects(opening.bracketIds)),
			pair: (opening, child, closing) => PairAstNode.create(opening.astNode as BracketAstNode, child, closing === null ? null : closing.astNode as BracketAstNode),
			unexpected: () => new Error('unexpected')
		};
	}
}
