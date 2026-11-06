/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Range } from '../../../core/range.js';
import { ITextModel } from '../../../model.js';
import { BracketInfo, BracketPairWithMinIndentationInfo, IFoundBracket } from '../../../textModelBracketPairs.js';
import { TextModel } from '../../textModel.js';
import { IModelContentChangedEvent, IModelTokensChangedEvent } from '../../../textModelEvents.js';
import { ResolvedLanguageConfiguration } from '../../../languages/languageConfigurationRegistry.js';
import { AstNode, AstNodeKind, iterateBracketChildren, PairAstNode } from './ast.js';
import { TextEditInfo } from './beforeEditPositionMapper.js';
import { LanguageAgnosticBracketTokens } from './brackets.js';
import { Length, lengthAdd, lengthGreaterThanEqual, lengthLessThan, lengthLessThanEqual, lengthsToRange, lengthZero, positionToLength, toLength } from './length.js';
import { parseDocument } from './parser.js';
import { DenseKeyProvider } from './smallImmutableSet.js';
import { FastTokenizer, TextBufferTokenizer, Token, TokenKind } from './tokenizer.js';
import { BackgroundTokenizationState } from '../../../tokenizationTextModelPart.js';
import { Position } from '../../../core/position.js';
import { CallbackIterable } from '../../../../../base/common/arrays.js';
import { combineTextEditInfos } from './combineTextEditInfos.js';
import { ClosingBracketKind, OpeningBracketKind } from '../../../languages/supports/languageBracketsConfiguration.js';
import { IRustBracketCollectionHost, tryCollectRustBrackets } from './rustBracketCollection.js';
import { IRustBracketPairCollectionHost, tryCollectRustBracketPairs } from './rustBracketPairCollection.js';
import { IRustBracketSearchHost, tryFindRustBracket, tryHasUnmatchedRustBracket } from './rustBracketSearch.js';
import { IRustBracketLifecycleHost, RustBracketLifecycleOperation, tryRunRustBracketLifecycle } from './rustBracketLifecycle.js';

export class BracketPairsTree extends Disposable {
	private readonly didChangeEmitter;

	/*
		There are two trees:
		* The initial tree that has no token information and is used for performant initial bracket colorization.
		* The tree that used token information to detect bracket pairs.

		To prevent flickering, we only switch from the initial tree to tree with token information
		when tokenization completes.
		Since the text can be edited while background tokenization is in progress, we need to update both trees.
	*/
	private initialAstWithoutTokens: AstNode | undefined;
	private astWithTokens: AstNode | undefined;

	private readonly denseKeyProvider;
	private readonly brackets;

	public didLanguageChange(languageId: string): boolean {
		return this.brackets.didLanguageChange(languageId);
	}

	public readonly onDidChange;
	private queuedTextEditsForInitialAstWithoutTokens: TextEditInfo[];
	private queuedTextEdits: TextEditInfo[];

	public constructor(
		private readonly textModel: TextModel,
		private readonly getLanguageConfiguration: (languageId: string) => ResolvedLanguageConfiguration
	) {
		super();
		this.didChangeEmitter = this._register(new Emitter<void>());
		this.denseKeyProvider = new DenseKeyProvider<string>();
		this.brackets = new LanguageAgnosticBracketTokens(this.denseKeyProvider, this.getLanguageConfiguration);
		this.onDidChange = this.didChangeEmitter.event;
		this.queuedTextEditsForInitialAstWithoutTokens = [];
		this.queuedTextEdits = [];

		if (tryRunRustBracketLifecycle(RustBracketLifecycleOperation.Initialize, false, () => BracketPairsTree.createRustLifecycleHost(this, [], textModel))) { return; }
		if (!textModel.tokenization.hasTokens) {
			const brackets = this.brackets.getSingleLanguageBracketTokens(this.textModel.getLanguageId());
			const tokenizer = new FastTokenizer(this.textModel.getValue(), brackets);
			this.initialAstWithoutTokens = parseDocument(tokenizer, [], undefined, true);
			this.astWithTokens = this.initialAstWithoutTokens;
		} else if (textModel.tokenization.backgroundTokenizationState === BackgroundTokenizationState.Completed) {
			// Skip the initial ast, as there is no flickering.
			// Directly create the tree with token information.
			this.initialAstWithoutTokens = undefined;
			this.astWithTokens = this.parseDocumentFromTextBuffer([], undefined, false);
		} else {
			// We missed some token changes already, so we cannot use the fast tokenizer + delta increments
			this.initialAstWithoutTokens = this.parseDocumentFromTextBuffer([], undefined, true);
			this.astWithTokens = this.initialAstWithoutTokens;
		}
	}

	//#region TextModel events

	public handleDidChangeBackgroundTokenizationState(): void {
		if (tryRunRustBracketLifecycle(RustBracketLifecycleOperation.CompleteTokenization, false, () => BracketPairsTree.createRustLifecycleHost(this))) { return; }
		if (this.textModel.tokenization.backgroundTokenizationState === BackgroundTokenizationState.Completed) {
			const wasUndefined = this.initialAstWithoutTokens === undefined;
			// Clear the initial tree as we can use the tree with token information now.
			this.initialAstWithoutTokens = undefined;
			if (!wasUndefined) {
				this.didChangeEmitter.fire();
			}
		}
	}

	public handleDidChangeTokens({ ranges }: IModelTokensChangedEvent): void {
		const edits = ranges.map(r =>
			new TextEditInfo(
				toLength(r.fromLineNumber - 1, 0),
				toLength(r.toLineNumber, 0),
				toLength(r.toLineNumber - r.fromLineNumber + 1, 0)
			)
		);

		if (tryRunRustBracketLifecycle(RustBracketLifecycleOperation.HandleChange, true, () => BracketPairsTree.createRustLifecycleHost(this, edits))) { return; }
		this.handleEdits(edits, true);

		if (!this.initialAstWithoutTokens) {
			this.didChangeEmitter.fire();
		}
	}

	public handleContentChanged(change: IModelContentChangedEvent) {
		const edits = TextEditInfo.fromModelContentChanges(change.changes);
		if (tryRunRustBracketLifecycle(RustBracketLifecycleOperation.HandleChange, false, () => BracketPairsTree.createRustLifecycleHost(this, edits))) { return; }
		this.handleEdits(edits, false);
	}

	private handleEdits(edits: TextEditInfo[], tokenChange: boolean): void {
		if (tryRunRustBracketLifecycle(RustBracketLifecycleOperation.QueueEdits, tokenChange, () => BracketPairsTree.createRustLifecycleHost(this, edits))) { return; }
		// Lazily queue the edits and only apply them when the tree is accessed.
		const result = combineTextEditInfos(this.queuedTextEdits, edits);

		this.queuedTextEdits = result;
		if (this.initialAstWithoutTokens && !tokenChange) {
			this.queuedTextEditsForInitialAstWithoutTokens = combineTextEditInfos(this.queuedTextEditsForInitialAstWithoutTokens, edits);
		}
	}

	//#endregion

	private flushQueue() {
		if (tryRunRustBracketLifecycle(RustBracketLifecycleOperation.FlushQueues, false, () => BracketPairsTree.createRustLifecycleHost(this))) { return; }
		if (this.queuedTextEdits.length > 0) {
			this.astWithTokens = this.parseDocumentFromTextBuffer(this.queuedTextEdits, this.astWithTokens, false);
			this.queuedTextEdits = [];
		}
		if (this.queuedTextEditsForInitialAstWithoutTokens.length > 0) {
			if (this.initialAstWithoutTokens) {
				this.initialAstWithoutTokens = this.parseDocumentFromTextBuffer(this.queuedTextEditsForInitialAstWithoutTokens, this.initialAstWithoutTokens, false);
			}
			this.queuedTextEditsForInitialAstWithoutTokens = [];
		}
	}

	/**
	 * @pure (only if isPure = true)
	*/
	private parseDocumentFromTextBuffer(edits: TextEditInfo[], previousAst: AstNode | undefined, immutable: boolean): AstNode {
		// Is much faster if `isPure = false`.
		const isPure = false;
		const previousAstClone = isPure ? previousAst?.deepClone() : previousAst;
		const tokenizer = new TextBufferTokenizer(this.textModel, this.brackets);
		const result = parseDocument(tokenizer, edits, previousAstClone, immutable);
		return result;
	}

	public getBracketsInRange(range: Range, onlyColorizedBrackets: boolean): CallbackIterable<BracketInfo> {
		this.flushQueue();

		const startOffset = toLength(range.startLineNumber - 1, range.startColumn - 1);
		const endOffset = toLength(range.endLineNumber - 1, range.endColumn - 1);
		return new CallbackIterable(cb => {
			const node = this.initialAstWithoutTokens || this.astWithTokens!;
			collectBrackets(node, lengthZero, node.length, startOffset, endOffset, cb, 0, 0, new Map(), onlyColorizedBrackets);
		});
	}

	public getBracketPairsInRange(range: Range, includeMinIndentation: boolean): CallbackIterable<BracketPairWithMinIndentationInfo> {
		this.flushQueue();

		const startLength = positionToLength(range.getStartPosition());
		const endLength = positionToLength(range.getEndPosition());

		return new CallbackIterable(cb => {
			const node = this.initialAstWithoutTokens || this.astWithTokens!;
			const context = new CollectBracketPairsContext(cb, includeMinIndentation, this.textModel);
			collectBracketPairs(node, lengthZero, node.length, startLength, endLength, context, 0, new Map());
		});
	}

	public hasUnmatchedClosingBracketAfter(position: Position, openingBracket: OpeningBracketKind): boolean {
		// Defer semantic bracket checks until tokenization is accurate for the entire model.
		if (!this.textModel.tokenization.hasAccurateTokensForLine(this.textModel.getLineCount())) {
			return false;
		}
		this.flushQueue();
		const openingBracketToken = this.brackets.getToken(openingBracket.bracketText, openingBracket.languageId);
		if (!openingBracketToken || openingBracketToken.kind !== TokenKind.OpeningBracket) {
			return false;
		}
		const node = this.astWithTokens!;
		return hasUnmatchedClosingBracketAfter(node, positionToLength(position), openingBracketToken);
	}

	public getFirstBracketAfter(position: Position): IFoundBracket | null {
		this.flushQueue();

		const node = this.initialAstWithoutTokens || this.astWithTokens!;
		return getFirstBracketAfter(node, lengthZero, node.length, positionToLength(position));
	}

	public getFirstBracketBefore(position: Position): IFoundBracket | null {
		this.flushQueue();

		const node = this.initialAstWithoutTokens || this.astWithTokens!;
		return getFirstBracketBefore(node, lengthZero, node.length, positionToLength(position));
	}

	/** Static capabilities avoid additional instance property reads before the original lifecycle. */
	private static createRustLifecycleHost(tree: BracketPairsTree, edits: TextEditInfo[] = [], constructorModel?: TextModel): IRustBracketLifecycleHost {
		return {
			truthy: node => !!node,
			isUndefined: node => node === undefined,
			hasTokens: () => !!constructorModel!.tokenization.hasTokens,
			completed: constructing => (constructing ? constructorModel! : tree.textModel).tokenization.backgroundTokenizationState === BackgroundTokenizationState.Completed,
			initialBrackets: () => tree.brackets.getSingleLanguageBracketTokens(tree.textModel.getLanguageId()),
			fastTokenizer: brackets => new FastTokenizer(tree.textModel.getValue(), brackets),
			parseInitial: tokenizer => parseDocument(tokenizer, [], undefined, true),
			initial: () => tree.initialAstWithoutTokens,
			setInitial: node => { tree.initialAstWithoutTokens = node; },
			setCurrent: node => { tree.astWithTokens = node; },
			parseEmpty: immutable => tree.parseDocumentFromTextBuffer([], undefined, immutable),
			fire: () => { tree.didChangeEmitter.fire(); },
			combineQueue: initial => combineTextEditInfos(initial ? tree.queuedTextEditsForInitialAstWithoutTokens : tree.queuedTextEdits, edits),
			setQueue: (initial, edits) => { if (initial) { tree.queuedTextEditsForInitialAstWithoutTokens = edits; } else { tree.queuedTextEdits = edits; } },
			handleEdits: tokenChange => { tree.handleEdits(edits, tokenChange); },
			queueNonempty: initial => (initial ? tree.queuedTextEditsForInitialAstWithoutTokens : tree.queuedTextEdits).length > 0,
			parseQueue: initial => initial ? tree.parseDocumentFromTextBuffer(tree.queuedTextEditsForInitialAstWithoutTokens, tree.initialAstWithoutTokens, false) : tree.parseDocumentFromTextBuffer(tree.queuedTextEdits, tree.astWithTokens, false),
			clearQueue: initial => { if (initial) { tree.queuedTextEditsForInitialAstWithoutTokens = []; } else { tree.queuedTextEdits = []; } }
		};
	}
}

function hasUnmatchedClosingBracketAfter(root: AstNode, positionLength: Length, openingBracketToken: Token): boolean {
	const native = tryHasUnmatchedRustBracket(root, () => createRustBracketSearchHost(positionLength, openingBracketToken));
	if (native !== undefined) { return native; }
	const openingBracketIds = openingBracketToken.bracketIds;
	if (!root.missingOpeningBracketIds.intersects(openingBracketIds)) {
		return false;
	}
	const nodesToVisit: { node: AstNode; offset: Length }[] = [{ node: root, offset: lengthZero }];
	while (nodesToVisit.length > 0) {
		const { node, offset } = nodesToVisit.pop()!;
		// UnexpectedClosingBracket nodes represent globally unmatched closing brackets.
		if (node.kind === AstNodeKind.UnexpectedClosingBracket) {
			// Ignore unmatched closers before the cursor because the new opener cannot pair with them.
			if (lengthGreaterThanEqual(offset, positionLength)) {
				return true;
			}
			continue;
		}
		let childOffset = offset;
		for (const child of node.children) {
			// child.length is the span of source text represented by that AST child—not its number of descendants
			const childEndOffset = lengthAdd(childOffset, child.length);
			const childEndsAfterPosition = lengthGreaterThanEqual(childEndOffset, positionLength);
			const childCanContainMatchingOrphan = child.missingOpeningBracketIds.intersects(openingBracketIds);
			// Visit only children that are after the cursor and may contain the matching orphan
			if (childEndsAfterPosition && childCanContainMatchingOrphan) {
				nodesToVisit.push({ node: child, offset: childOffset });
			}
			childOffset = childEndOffset;
		}
	}
	return false;
}

function getFirstBracketBefore(node: AstNode, nodeOffsetStart: Length, nodeOffsetEnd: Length, position: Length): IFoundBracket | null {
	const native = tryFindRustBracket(node, nodeOffsetStart, nodeOffsetEnd, true, () => createRustBracketSearchHost(position));
	if (native !== undefined) { return native.bracket; }
	if (node.kind === AstNodeKind.List || node.kind === AstNodeKind.Pair) {
		const lengths: { nodeOffsetStart: Length; nodeOffsetEnd: Length }[] = [];
		for (const child of node.children) {
			nodeOffsetEnd = lengthAdd(nodeOffsetStart, child.length);
			lengths.push({ nodeOffsetStart, nodeOffsetEnd });
			nodeOffsetStart = nodeOffsetEnd;
		}
		for (let i = lengths.length - 1; i >= 0; i--) {
			const { nodeOffsetStart, nodeOffsetEnd } = lengths[i];
			if (lengthLessThan(nodeOffsetStart, position)) {
				const result = getFirstBracketBefore(node.children[i], nodeOffsetStart, nodeOffsetEnd, position);
				if (result) {
					return result;
				}
			}
		}
		return null;
	} else if (node.kind === AstNodeKind.UnexpectedClosingBracket) {
		return null;
	} else if (node.kind === AstNodeKind.Bracket) {
		const range = lengthsToRange(nodeOffsetStart, nodeOffsetEnd);
		return {
			bracketInfo: node.bracketInfo,
			range
		};
	}
	return null;
}

function getFirstBracketAfter(node: AstNode, nodeOffsetStart: Length, nodeOffsetEnd: Length, position: Length): IFoundBracket | null {
	const native = tryFindRustBracket(node, nodeOffsetStart, nodeOffsetEnd, false, () => createRustBracketSearchHost(position));
	if (native !== undefined) { return native.bracket; }
	if (node.kind === AstNodeKind.List || node.kind === AstNodeKind.Pair) {
		for (const child of node.children) {
			nodeOffsetEnd = lengthAdd(nodeOffsetStart, child.length);
			if (lengthLessThan(position, nodeOffsetEnd)) {
				const result = getFirstBracketAfter(child, nodeOffsetStart, nodeOffsetEnd, position);
				if (result) {
					return result;
				}
			}
			nodeOffsetStart = nodeOffsetEnd;
		}
		return null;
	} else if (node.kind === AstNodeKind.UnexpectedClosingBracket) {
		return null;
	} else if (node.kind === AstNodeKind.Bracket) {
		const range = lengthsToRange(nodeOffsetStart, nodeOffsetEnd);
		return {
			bracketInfo: node.bracketInfo,
			range
		};
	}
	return null;
}

function collectBrackets(
	node: AstNode,
	nodeOffsetStart: Length,
	nodeOffsetEnd: Length,
	startOffset: Length,
	endOffset: Length,
	push: (item: BracketInfo) => boolean,
	level: number,
	nestingLevelOfEqualBracketType: number,
	levelPerBracketType: Map<string, number>,
	onlyColorizedBrackets: boolean,
	parentPairIsIncomplete: boolean = false,
): boolean {
	const native = tryCollectRustBrackets(node, nodeOffsetStart, nodeOffsetEnd, level, nestingLevelOfEqualBracketType, parentPairIsIncomplete, () => createRustBracketCollectionHost(startOffset, endOffset, push, levelPerBracketType, onlyColorizedBrackets));
	if (native !== undefined) { return native.continued; }
	if (level > 200) {
		return true;
	}

	whileLoop:
	while (true) {
		switch (node.kind) {
			case AstNodeKind.List: {
				const childCount = node.childrenLength;
				for (let i = 0; i < childCount; i++) {
					const child = node.getChild(i);
					if (!child) {
						continue;
					}
					nodeOffsetEnd = lengthAdd(nodeOffsetStart, child.length);
					if (
						lengthLessThanEqual(nodeOffsetStart, endOffset) &&
						lengthGreaterThanEqual(nodeOffsetEnd, startOffset)
					) {
						const childEndsAfterEnd = lengthGreaterThanEqual(nodeOffsetEnd, endOffset);
						if (childEndsAfterEnd) {
							// No child after this child in the requested window, don't recurse
							node = child;
							continue whileLoop;
						}

						const shouldContinue = collectBrackets(child, nodeOffsetStart, nodeOffsetEnd, startOffset, endOffset, push, level, 0, levelPerBracketType, onlyColorizedBrackets);
						if (!shouldContinue) {
							return false;
						}
					}
					nodeOffsetStart = nodeOffsetEnd;
				}
				return true;
			}
			case AstNodeKind.Pair: {
				const colorize = !onlyColorizedBrackets || !node.closingBracket || (node.closingBracket.bracketInfo as ClosingBracketKind).closesColorized(node.openingBracket.bracketInfo as OpeningBracketKind);

				let levelPerBracket = 0;
				if (levelPerBracketType) {
					let existing = levelPerBracketType.get(node.openingBracket.text);
					if (existing === undefined) {
						existing = 0;
					}
					levelPerBracket = existing;
					if (colorize) {
						existing++;
						levelPerBracketType.set(node.openingBracket.text, existing);
					}
				}

				const childCount = node.childrenLength;
				for (let i = 0; i < childCount; i++) {
					const child = node.getChild(i);
					if (!child) {
						continue;
					}
					nodeOffsetEnd = lengthAdd(nodeOffsetStart, child.length);
					if (
						lengthLessThanEqual(nodeOffsetStart, endOffset) &&
						lengthGreaterThanEqual(nodeOffsetEnd, startOffset)
					) {
						const childEndsAfterEnd = lengthGreaterThanEqual(nodeOffsetEnd, endOffset);
						if (childEndsAfterEnd && child.kind !== AstNodeKind.Bracket) {
							// No child after this child in the requested window, don't recurse
							// Don't do this for brackets because of unclosed/unopened brackets
							node = child;
							if (colorize) {
								level++;
								nestingLevelOfEqualBracketType = levelPerBracket + 1;
							} else {
								nestingLevelOfEqualBracketType = levelPerBracket;
							}
							continue whileLoop;
						}

						if (colorize || child.kind !== AstNodeKind.Bracket || !node.closingBracket) {
							const shouldContinue = collectBrackets(
								child,
								nodeOffsetStart,
								nodeOffsetEnd,
								startOffset,
								endOffset,
								push,
								colorize ? level + 1 : level,
								colorize ? levelPerBracket + 1 : levelPerBracket,
								levelPerBracketType,
								onlyColorizedBrackets,
								!node.closingBracket,
							);
							if (!shouldContinue) {
								return false;
							}
						}
					}
					nodeOffsetStart = nodeOffsetEnd;
				}

				levelPerBracketType?.set(node.openingBracket.text, levelPerBracket);

				return true;
			}
			case AstNodeKind.UnexpectedClosingBracket: {
				const range = lengthsToRange(nodeOffsetStart, nodeOffsetEnd);
				return push(new BracketInfo(range, level - 1, 0, true));
			}
			case AstNodeKind.Bracket: {
				const range = lengthsToRange(nodeOffsetStart, nodeOffsetEnd);
				return push(new BracketInfo(range, level - 1, nestingLevelOfEqualBracketType - 1, parentPairIsIncomplete));
			}
			case AstNodeKind.Text:
				return true;
		}
	}
}

/** Ordered capabilities retain the original range traversal's providers, maps, and callback values. */
function createRustBracketCollectionHost(startOffset: Length, endOffset: Length, push: (item: BracketInfo) => boolean, levels: Map<string, number>, onlyColorizedBrackets: boolean): IRustBracketCollectionHost {
	return {
		truthy: value => !!value,
		kind: node => node.kind,
		childCount: node => node.childrenLength,
		indexBefore: (index, count) => index < count,
		child: (node, index) => node.getChild(index),
		end: (start, child) => lengthAdd(start, child.length),
		inRange: (start, end) => lengthLessThanEqual(start, endOffset) && lengthGreaterThanEqual(end, startOffset),
		reachesEnd: end => lengthGreaterThanEqual(end, endOffset),
		isBracket: node => node.kind === AstNodeKind.Bracket,
		colorize: node => !onlyColorizedBrackets || !(node as PairAstNode).closingBracket || ((node as PairAstNode).closingBracket!.bracketInfo as ClosingBracketKind).closesColorized((node as PairAstNode).openingBracket.bracketInfo as OpeningBracketKind),
		hasLevels: () => !!levels,
		getLevel: node => levels.get((node as PairAstNode).openingBracket.text),
		isUndefined: value => value === undefined,
		increment: value => ++value,
		addOne: value => value + 1,
		setLevel: (node, value) => { levels.set((node as PairAstNode).openingBracket.text, value); },
		restoreLevel: (node, value) => { levels?.set((node as PairAstNode).openingBracket.text, value); },
		hasClosing: node => !!(node as PairAstNode).closingBracket,
		collect: (node, start, end, level, equalLevel, incomplete) => collectBrackets(node, start, end, startOffset, endOffset, push, level, equalLevel, levels, onlyColorizedBrackets, incomplete),
		emitUnexpected: (start, end, level) => { const range = lengthsToRange(start, end); return push(new BracketInfo(range, level - 1, 0, true)); },
		emitBracket: (start, end, level, equalLevel, incomplete) => { const range = lengthsToRange(start, end); return push(new BracketInfo(range, level - 1, equalLevel - 1, incomplete)); }
	};
}

class CollectBracketPairsContext {
	constructor(
		public readonly push: (item: BracketPairWithMinIndentationInfo) => boolean,
		public readonly includeMinIndentation: boolean,
		public readonly textModel: ITextModel,
	) {
	}
}

function collectBracketPairs(
	node: AstNode,
	nodeOffsetStart: Length,
	nodeOffsetEnd: Length,
	startOffset: Length,
	endOffset: Length,
	context: CollectBracketPairsContext,
	level: number,
	levelPerBracketType: Map<string, number>
): boolean {
	const native = tryCollectRustBracketPairs(node, nodeOffsetStart, nodeOffsetEnd, level, () => createRustBracketPairCollectionHost(startOffset, endOffset, context, levelPerBracketType));
	if (native !== undefined) { return native.continued; }
	if (level > 200) {
		return true;
	}

	let shouldContinue = true;

	if (node.kind === AstNodeKind.Pair) {
		let levelPerBracket = 0;
		if (levelPerBracketType) {
			let existing = levelPerBracketType.get(node.openingBracket.text);
			if (existing === undefined) {
				existing = 0;
			}
			levelPerBracket = existing;
			existing++;
			levelPerBracketType.set(node.openingBracket.text, existing);
		}

		const openingBracketEnd = lengthAdd(nodeOffsetStart, node.openingBracket.length);
		let minIndentation = -1;
		if (context.includeMinIndentation) {
			minIndentation = node.computeMinIndentation(
				nodeOffsetStart,
				context.textModel
			);
		}

		shouldContinue = context.push(
			new BracketPairWithMinIndentationInfo(
				lengthsToRange(nodeOffsetStart, nodeOffsetEnd),
				lengthsToRange(nodeOffsetStart, openingBracketEnd),
				node.closingBracket
					? lengthsToRange(
						lengthAdd(openingBracketEnd, node.child?.length || lengthZero),
						nodeOffsetEnd
					)
					: undefined,
				level,
				levelPerBracket,
				node,
				minIndentation
			)
		);

		nodeOffsetStart = openingBracketEnd;
		if (shouldContinue && node.child) {
			const child = node.child;
			nodeOffsetEnd = lengthAdd(nodeOffsetStart, child.length);
			if (
				lengthLessThanEqual(nodeOffsetStart, endOffset) &&
				lengthGreaterThanEqual(nodeOffsetEnd, startOffset)
			) {
				shouldContinue = collectBracketPairs(
					child,
					nodeOffsetStart,
					nodeOffsetEnd,
					startOffset,
					endOffset,
					context,
					level + 1,
					levelPerBracketType
				);
				if (!shouldContinue) {
					return false;
				}
			}
		}

		levelPerBracketType?.set(node.openingBracket.text, levelPerBracket);
	} else {
		let curOffset = nodeOffsetStart;
		for (const child of node.children) {
			const childOffset = curOffset;
			curOffset = lengthAdd(curOffset, child.length);

			if (
				lengthLessThanEqual(childOffset, endOffset) &&
				lengthLessThanEqual(startOffset, curOffset)
			) {
				shouldContinue = collectBracketPairs(
					child,
					childOffset,
					curOffset,
					startOffset,
					endOffset,
					context,
					level,
					levelPerBracketType
				);
				if (!shouldContinue) {
					return false;
				}
			}
		}
	}
	return shouldContinue;
}

/** Ordered capabilities retain nearest-query rereads and unmatched-query stack/provider order. */
function createRustBracketSearchHost(position: Length, openingBracketToken?: Token): IRustBracketSearchHost {
	return {
		truthy: value => !!value,
		container: node => node.kind === AstNodeKind.List || node.kind === AstNodeKind.Pair,
		unexpected: node => node.kind === AstNodeKind.UnexpectedClosingBracket,
		bracket: node => node.kind === AstNodeKind.Bracket,
		found: (node, start, end) => { const range = lengthsToRange(start, end); return { bracketInfo: (node as PairAstNode['openingBracket']).bracketInfo, range }; },
		iterator: node => iterateBracketChildren(node),
		next: iterator => iterator.next(),
		done: step => !!step.done,
		stepValue: step => step.value,
		close: iterator => { iterator.return(undefined); },
		end: (start, node) => lengthAdd(start, node.length),
		beforePosition: offset => lengthLessThan(offset, position),
		positionBefore: offset => lengthLessThan(position, offset),
		find: (node, start, end, before) => before ? getFirstBracketBefore(node, start, end, position) : getFirstBracketAfter(node, start, end, position),
		lengths: () => [],
		pushLength: (lengths, start, end) => { lengths.push({ nodeOffsetStart: start, nodeOffsetEnd: end }); },
		lastIndex: lengths => lengths.length - 1,
		validIndex: index => index >= 0,
		lengthEntry: (lengths, index) => lengths[index],
		entryStart: entry => entry.nodeOffsetStart,
		entryEnd: entry => entry.nodeOffsetEnd,
		indexedChild: (node, index) => node.children[index],
		decrement: index => --index,
		openingIds: () => openingBracketToken!.bracketIds,
		intersects: (node, ids) => node.missingOpeningBracketIds.intersects(ids),
		stack: root => [{ node: root, offset: lengthZero }],
		hasStack: stack => stack.length > 0,
		pop: stack => stack.pop()!,
		entryNode: entry => entry.node,
		entryOffset: entry => entry.offset,
		afterPosition: offset => lengthGreaterThanEqual(offset, position),
		pushNode: (stack, node, offset) => { stack.push({ node, offset }); }
	};
}

/** Ordered capabilities preserve pair factories, context reads, and partially restored nesting. */
function createRustBracketPairCollectionHost(startOffset: Length, endOffset: Length, context: CollectBracketPairsContext, levels: Map<string, number>): IRustBracketPairCollectionHost {
	return {
		truthy: value => !!value,
		isPair: node => node.kind === AstNodeKind.Pair,
		hasLevels: () => !!levels,
		getLevel: node => levels.get((node as PairAstNode).openingBracket.text),
		isUndefined: value => value === undefined,
		increment: value => ++value,
		setLevel: (node, value) => { levels.set((node as PairAstNode).openingBracket.text, value); },
		restoreLevel: (node, value) => { levels?.set((node as PairAstNode).openingBracket.text, value); },
		openingEnd: (node, start) => lengthAdd(start, (node as PairAstNode).openingBracket.length),
		includeIndentation: () => !!context.includeMinIndentation,
		indentation: (node, start) => (node as PairAstNode).computeMinIndentation(start, context.textModel),
		emitPair: (node, start, end, opening, level, equalLevel, indentation) => context.push(new BracketPairWithMinIndentationInfo(
			lengthsToRange(start, end),
			lengthsToRange(start, opening),
			(node as PairAstNode).closingBracket ? lengthsToRange(lengthAdd(opening, (node as PairAstNode).child?.length || lengthZero), end) : undefined,
			level, equalLevel, node as PairAstNode, indentation
		)),
		hasChild: node => !!(node as PairAstNode).child,
		child: node => (node as PairAstNode).child!,
		end: (start, child) => lengthAdd(start, child.length),
		inPairRange: (start, end) => lengthLessThanEqual(start, endOffset) && lengthGreaterThanEqual(end, startOffset),
		inListRange: (start, end) => lengthLessThanEqual(start, endOffset) && lengthLessThanEqual(startOffset, end),
		collect: (node, start, end, level) => collectBracketPairs(node, start, end, startOffset, endOffset, context, level, levels),
		iterator: node => iterateBracketChildren(node),
		next: iterator => iterator.next(),
		done: step => !!step.done,
		stepValue: step => step.value,
		close: iterator => { iterator.return(undefined); }
	};
}
