/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BugIndicatingError } from '../../../../../base/common/errors.js';
import { CursorColumns } from '../../../core/cursorColumns.js';
import { BracketKind } from '../../../languages/supports/languageBracketsConfiguration.js';
import { ITextModel } from '../../../model.js';
import { Length, lengthAdd, lengthGetLineCount, lengthToObj, lengthZero } from './length.js';
import { SmallImmutableSet } from './smallImmutableSet.js';
import { OpeningBracketId } from './tokenizer.js';
import { IRustBracketIndentationHost, RustBracketIndentationOperation, tryComputeRustBracketIndentation } from './rustBracketIndentation.js';
import { IRustBracketAstHost, IRustBracketChildHost, RustBracketAstOperation, RustBracketChildOperation, tryAccessRustBracketChild, tryRunRustBracketAst } from './rustBracketAst.js';
import { IRustBracketMutationHost, RustBracketMutationOperation, tryMutateRustBracketList } from './rustBracketMutation.js';
import { IRustBracketTransformHost, RustBracketTransformOperation, tryTransformRustBracketAst } from './rustBracketTransform.js';
import { ownRustBracketNodeMetadata } from './rustBracketNodeMetadata.js';

export const enum AstNodeKind {
	Text = 0,
	Bracket = 1,
	Pair = 2,
	UnexpectedClosingBracket = 3,
	List = 4,
}

export type AstNode = PairAstNode | ListAstNode | BracketAstNode | InvalidBracketAstNode | TextAstNode;

/**
 * The base implementation for all AST nodes.
*/
abstract class BaseAstNode {
	public abstract readonly kind: AstNodeKind;

	public abstract readonly childrenLength: number;

	/**
	 * Might return null even if {@link idx} is smaller than {@link BaseAstNode.childrenLength}.
	*/
	public abstract getChild(idx: number): AstNode | null;

	/**
	 * Try to avoid using this property, as implementations might need to allocate the resulting array.
	*/
	public abstract readonly children: readonly AstNode[];

	/**
	 * Represents the set of all (potentially) missing opening bracket ids in this node.
	 * E.g. in `{ ] ) }` that set is {`[`, `(` }.
	*/
	public abstract readonly missingOpeningBracketIds: SmallImmutableSet<OpeningBracketId>;

	/**
	 * In case of a list, determines the height of the (2,3) tree.
	*/
	public abstract readonly listHeight: number;

	protected _length: Length;

	/**
	 * The length of the entire node, which should equal the sum of lengths of all children.
	*/
	public get length(): Length {
		return this._length;
	}

	public constructor(length: Length) {
		this._length = length;
		return ownRustBracketNodeMetadata(this);
	}

	/**
	 * @param openBracketIds The set of all opening brackets that have not yet been closed.
	 */
	public abstract canBeReused(
		openBracketIds: SmallImmutableSet<OpeningBracketId>
	): boolean;

	/**
	 * Flattens all lists in this AST. Only for debugging.
	 */
	public abstract flattenLists(): AstNode;

	/**
	 * Creates a deep clone.
	 */
	public abstract deepClone(): AstNode;

	public abstract computeMinIndentation(offset: Length, textModel: ITextModel): number;
}

/**
 * Represents a bracket pair including its child (e.g. `{ ... }`).
 * Might be unclosed.
 * Immutable, if all children are immutable.
*/
export class PairAstNode extends BaseAstNode {
	public static create(
		openingBracket: BracketAstNode,
		child: AstNode | null,
		closingBracket: BracketAstNode | null
	) {
		const native = tryRunRustBracketAst(RustBracketAstOperation.CreatePair, () => createRustBracketAstHost({ items: [openingBracket, child, closingBracket], createPair: (length, ids) => new PairAstNode(length, openingBracket, child, closingBracket, ids) }));
		if (native !== undefined) { return native.value as PairAstNode; }
		let length = openingBracket.length;
		if (child) {
			length = lengthAdd(length, child.length);
		}
		if (closingBracket) {
			length = lengthAdd(length, closingBracket.length);
		}
		return new PairAstNode(length, openingBracket, child, closingBracket, child ? child.missingOpeningBracketIds : SmallImmutableSet.getEmpty());
	}

	public get kind(): AstNodeKind.Pair {
		return AstNodeKind.Pair;
	}
	public get listHeight() {
		return 0;
	}
	public get childrenLength(): number {
		return 3;
	}
	public getChild(idx: number): AstNode | null {
		const native = tryAccessRustBracketChild(RustBracketChildOperation.ReadChild, () => PairAstNode.createRustChildHost(this, idx));
		if (native !== undefined) { return native.value as AstNode | null; }
		switch (idx) {
			case 0: return this.openingBracket;
			case 1: return this.child;
			case 2: return this.closingBracket;
		}
		throw new Error('Invalid child index');
	}

	/**
	 * Avoid using this property, it allocates an array!
	*/
	public get children() {
		const native = tryAccessRustBracketChild(RustBracketChildOperation.PairChildren, () => PairAstNode.createRustChildHost(this));
		if (native !== undefined) { return native.value as AstNode[]; }
		const result: AstNode[] = [];
		result.push(this.openingBracket);
		if (this.child) {
			result.push(this.child);
		}
		if (this.closingBracket) {
			result.push(this.closingBracket);
		}
		return result;
	}

	private constructor(
		length: Length,
		public readonly openingBracket: BracketAstNode,
		public readonly child: AstNode | null,
		public readonly closingBracket: BracketAstNode | null,
		public readonly missingOpeningBracketIds: SmallImmutableSet<OpeningBracketId>
	) {
		super(length);
	}

	/** Preserves pair property reads and push method lookup before each child argument. */
	private static createRustChildHost(node: PairAstNode, index?: number): IRustBracketChildHost {
		const fields = ['openingBracket', 'child', 'closingBracket'] as const;
		return {
			item: slot => node[fields[slot]],
			isIndex: slot => index === slot,
			invalidIndex: () => { throw new Error('Invalid child index'); },
			createArray: () => [],
			pushItem: (array, slot) => { array.push(node[fields[slot]]!); }
		};
	}

	public canBeReused(openBracketIds: SmallImmutableSet<OpeningBracketId>) {
		const native = tryRunRustBracketAst(RustBracketAstOperation.ReusePair, () => createRustBracketAstHost({ node: this, openBracketIds }));
		if (native !== undefined) { return native.value as boolean; }
		if (this.closingBracket === null) {
			// Unclosed pair ast nodes only
			// end at the end of the document
			// or when a parent node is closed.

			// This could be improved:
			// Only return false if some next token is neither "undefined" nor a bracket that closes a parent.

			return false;
		}

		if (openBracketIds.intersects(this.missingOpeningBracketIds)) {
			return false;
		}

		return true;
	}

	public flattenLists(): PairAstNode {
		const native = tryTransformRustBracketAst(RustBracketTransformOperation.FlattenPair, () => createRustBracketTransformHost({ node: this }));
		if (native !== undefined) { return native.value as PairAstNode; }
		return PairAstNode.create(
			this.openingBracket.flattenLists(),
			this.child && this.child.flattenLists(),
			this.closingBracket && this.closingBracket.flattenLists()
		);
	}

	public deepClone(): PairAstNode {
		const native = tryTransformRustBracketAst(RustBracketTransformOperation.ClonePair, () => createRustBracketTransformHost({ node: this, clonePair: (length, opening, child, closing, missing) => new PairAstNode(length, opening, child, closing, missing) }));
		if (native !== undefined) { return native.value as PairAstNode; }
		return new PairAstNode(
			this.length,
			this.openingBracket.deepClone(),
			this.child && this.child.deepClone(),
			this.closingBracket && this.closingBracket.deepClone(),
			this.missingOpeningBracketIds
		);
	}

	public computeMinIndentation(offset: Length, textModel: ITextModel): number {
		const native = tryComputeRustBracketIndentation(RustBracketIndentationOperation.Pair, offset, () => createRustBracketIndentationHost(this, textModel));
		if (native !== undefined) { return native.indentation; }
		return this.child ? this.child.computeMinIndentation(lengthAdd(offset, this.openingBracket.length), textModel) : Number.MAX_SAFE_INTEGER;
	}
}

export abstract class ListAstNode extends BaseAstNode {
	/**
	 * This method uses more memory-efficient list nodes that can only store 2 or 3 children.
	*/
	public static create23(item1: AstNode, item2: AstNode, item3: AstNode | null, immutable: boolean = false): ListAstNode {
		const native = tryRunRustBracketAst(RustBracketAstOperation.CreateCompactList, () => createRustBracketAstHost({ items: [item1, item2, item3], immutable }));
		if (native !== undefined) { return native.value as ListAstNode; }
		let length = item1.length;
		let missingBracketIds = item1.missingOpeningBracketIds;

		if (item1.listHeight !== item2.listHeight) {
			throw new Error('Invalid list heights');
		}

		length = lengthAdd(length, item2.length);
		missingBracketIds = missingBracketIds.merge(item2.missingOpeningBracketIds);

		if (item3) {
			if (item1.listHeight !== item3.listHeight) {
				throw new Error('Invalid list heights');
			}
			length = lengthAdd(length, item3.length);
			missingBracketIds = missingBracketIds.merge(item3.missingOpeningBracketIds);
		}
		return immutable
			? new Immutable23ListAstNode(length, item1.listHeight + 1, item1, item2, item3, missingBracketIds)
			: new TwoThreeListAstNode(length, item1.listHeight + 1, item1, item2, item3, missingBracketIds);
	}

	public static create(items: AstNode[], immutable: boolean = false): ListAstNode {
		const native = tryRunRustBracketAst(RustBracketAstOperation.CreateArrayList, () => createRustBracketAstHost({ items, immutable, emptyList: () => this.getEmpty() }));
		if (native !== undefined) { return native.value as ListAstNode; }
		if (items.length === 0) {
			return this.getEmpty();
		} else {
			let length = items[0].length;
			let unopenedBrackets = items[0].missingOpeningBracketIds;
			for (let i = 1; i < items.length; i++) {
				length = lengthAdd(length, items[i].length);
				unopenedBrackets = unopenedBrackets.merge(items[i].missingOpeningBracketIds);
			}
			return immutable
				? new ImmutableArrayListAstNode(length, items[0].listHeight + 1, items, unopenedBrackets)
				: new ArrayListAstNode(length, items[0].listHeight + 1, items, unopenedBrackets);
		}
	}

	public static getEmpty() {
		return new ImmutableArrayListAstNode(lengthZero, 0, [], SmallImmutableSet.getEmpty());
	}

	public get kind(): AstNodeKind.List {
		return AstNodeKind.List;
	}

	public get missingOpeningBracketIds(): SmallImmutableSet<OpeningBracketId> {
		return this._missingOpeningBracketIds;
	}

	private cachedMinIndentation: number = -1;

	/**
	 * Use ListAstNode.create.
	*/
	constructor(
		length: Length,
		public readonly listHeight: number,
		private _missingOpeningBracketIds: SmallImmutableSet<OpeningBracketId>
	) {
		super(length);
	}

	protected throwIfImmutable(): void {
		// NOOP
	}

	protected abstract setChild(idx: number, child: AstNode): void;

	public makeLastElementMutable(): AstNode | undefined {
		const native = tryRunRustBracketAst(RustBracketAstOperation.MakeLastMutable, () => ListAstNode.createRustMutationHost(this));
		if (native !== undefined) { return native.value as AstNode | undefined; }
		this.throwIfImmutable();
		const childCount = this.childrenLength;
		if (childCount === 0) {
			return undefined;
		}
		const lastChild = this.getChild(childCount - 1)!;
		const mutable = lastChild.kind === AstNodeKind.List ? lastChild.toMutable() : lastChild;
		if (lastChild !== mutable) {
			this.setChild(childCount - 1, mutable);
		}
		return mutable;
	}

	public makeFirstElementMutable(): AstNode | undefined {
		const native = tryRunRustBracketAst(RustBracketAstOperation.MakeFirstMutable, () => ListAstNode.createRustMutationHost(this));
		if (native !== undefined) { return native.value as AstNode | undefined; }
		this.throwIfImmutable();
		const childCount = this.childrenLength;
		if (childCount === 0) {
			return undefined;
		}
		const firstChild = this.getChild(0)!;
		const mutable = firstChild.kind === AstNodeKind.List ? firstChild.toMutable() : firstChild;
		if (firstChild !== mutable) {
			this.setChild(0, mutable);
		}
		return mutable;
	}

	public canBeReused(openBracketIds: SmallImmutableSet<OpeningBracketId>): boolean {
		const native = tryRunRustBracketAst(RustBracketAstOperation.ReuseList, () => createRustBracketAstHost({ node: this, openBracketIds }));
		if (native !== undefined) { return native.value as boolean; }
		if (openBracketIds.intersects(this.missingOpeningBracketIds)) {
			return false;
		}

		if (this.childrenLength === 0) {
			// Don't reuse empty lists.
			return false;
		}

		let lastChild: ListAstNode = this;
		while (lastChild.kind === AstNodeKind.List) {
			const lastLength = lastChild.childrenLength;
			if (lastLength === 0) {
				// Empty lists should never be contained in other lists.
				throw new BugIndicatingError();
			}
			lastChild = lastChild.getChild(lastLength - 1) as ListAstNode;
		}

		return lastChild.canBeReused(openBracketIds);
	}

	public handleChildrenChanged(): void {
		const native = tryRunRustBracketAst(RustBracketAstOperation.UpdateChildren, () => ListAstNode.createRustMutationHost(this));
		if (native !== undefined) { return; }
		this.throwIfImmutable();

		const count = this.childrenLength;

		let length = this.getChild(0)!.length;
		let unopenedBrackets = this.getChild(0)!.missingOpeningBracketIds;

		for (let i = 1; i < count; i++) {
			const child = this.getChild(i)!;
			length = lengthAdd(length, child.length);
			unopenedBrackets = unopenedBrackets.merge(child.missingOpeningBracketIds);
		}

		this._length = length;
		this._missingOpeningBracketIds = unopenedBrackets;
		this.cachedMinIndentation = -1;
	}

	public flattenLists(): ListAstNode {
		const native = tryTransformRustBracketAst(RustBracketTransformOperation.FlattenList, () => createRustBracketTransformHost({ node: this }));
		if (native !== undefined) { return native.value as ListAstNode; }
		const items: AstNode[] = [];
		for (const c of this.children) {
			const normalized = c.flattenLists();
			if (normalized.kind === AstNodeKind.List) {
				items.push(...normalized.children);
			} else {
				items.push(normalized);
			}
		}
		return ListAstNode.create(items);
	}

	public computeMinIndentation(offset: Length, textModel: ITextModel): number {
		const native = tryComputeRustBracketIndentation(RustBracketIndentationOperation.List, offset, () => createRustBracketIndentationHost(this, textModel, () => this.cachedMinIndentation, value => { this.cachedMinIndentation = value; }));
		if (native !== undefined) { return native.indentation; }
		if (this.cachedMinIndentation !== -1) {
			return this.cachedMinIndentation;
		}

		let minIndentation = Number.MAX_SAFE_INTEGER;
		let childOffset = offset;
		for (let i = 0; i < this.childrenLength; i++) {
			const child = this.getChild(i);
			if (child) {
				minIndentation = Math.min(minIndentation, child.computeMinIndentation(childOffset, textModel));
				childOffset = lengthAdd(childOffset, child.length);
			}
		}

		this.cachedMinIndentation = minIndentation;
		return minIndentation;
	}

	/**
	 * Creates a shallow clone that is mutable, or itself if it is already mutable.
	 */
	public abstract toMutable(): ListAstNode;

	public abstract appendChildOfSameHeight(node: AstNode): void;
	public abstract unappendChild(): AstNode | undefined;
	public abstract prependChildOfSameHeight(node: AstNode): void;
	public abstract unprependChild(): AstNode | undefined;

	/** Static capabilities retain protected dispatch and private metadata setter observations. */
	private static createRustMutationHost(node: ListAstNode): IRustBracketAstHost {
		return createRustBracketAstHost({
			node,
			throwIfImmutable: () => node.throwIfImmutable(),
			setLength: value => { node._length = value; },
			setMissing: value => { node._missingOpeningBracketIds = value; },
			resetIndentation: () => { node.cachedMinIndentation = -1; },
			setEdge: (count, child, last) => node.setChild(last ? count - 1 : 0, child)
		});
	}
}

class TwoThreeListAstNode extends ListAstNode {
	public get childrenLength(): number {
		const native = tryAccessRustBracketChild(RustBracketChildOperation.CompactCount, () => TwoThreeListAstNode.createRustChildHost(this));
		if (native !== undefined) { return native.value as number; }
		return this._item3 !== null ? 3 : 2;
	}
	public getChild(idx: number): AstNode | null {
		const native = tryAccessRustBracketChild(RustBracketChildOperation.ReadChild, () => TwoThreeListAstNode.createRustChildHost(this, idx));
		if (native !== undefined) { return native.value as AstNode | null; }
		switch (idx) {
			case 0: return this._item1;
			case 1: return this._item2;
			case 2: return this._item3;
		}
		throw new Error('Invalid child index');
	}
	protected setChild(idx: number, node: AstNode): void {
		const native = tryAccessRustBracketChild(RustBracketChildOperation.WriteChild, () => TwoThreeListAstNode.createRustChildHost(this, idx, node));
		if (native !== undefined) { return; }
		switch (idx) {
			case 0: this._item1 = node; return;
			case 1: this._item2 = node; return;
			case 2: this._item3 = node; return;
		}
		throw new Error('Invalid child index');
	}

	public get children(): readonly AstNode[] {
		const native = tryAccessRustBracketChild(RustBracketChildOperation.CompactChildren, () => TwoThreeListAstNode.createRustChildHost(this));
		if (native !== undefined) { return native.value as readonly AstNode[]; }
		return this._item3 ? [this._item1, this._item2, this._item3] : [this._item1, this._item2];
	}

	/** Preserves private slot receivers, strict index checks, and array-literal child identities. */
	private static createRustChildHost(node: TwoThreeListAstNode, index?: number, incoming?: AstNode): IRustBracketChildHost {
		const fields = ['_item1', '_item2', '_item3'] as const;
		return {
			item: slot => node[fields[slot]],
			isIndex: slot => index === slot,
			invalidIndex: () => { throw new Error('Invalid child index'); },
			setItem: slot => { node[fields[slot]] = incoming!; },
			array2: (first, second) => [first, second],
			array3: (first, second, third) => [first, second, third!]
		};
	}

	public get item1(): AstNode {
		return this._item1;
	}
	public get item2(): AstNode {
		return this._item2;
	}
	public get item3(): AstNode | null {
		return this._item3;
	}

	public constructor(
		length: Length,
		listHeight: number,
		private _item1: AstNode,
		private _item2: AstNode,
		private _item3: AstNode | null,
		missingOpeningBracketIds: SmallImmutableSet<OpeningBracketId>
	) {
		super(length, listHeight, missingOpeningBracketIds);
	}

	public deepClone(): ListAstNode {
		const native = tryTransformRustBracketAst(RustBracketTransformOperation.CloneCompactList, () => TwoThreeListAstNode.createRustCompactTransformHost(this));
		if (native !== undefined) { return native.value as ListAstNode; }
		return new TwoThreeListAstNode(
			this.length,
			this.listHeight,
			this._item1.deepClone(),
			this._item2.deepClone(),
			this._item3 ? this._item3.deepClone() : null,
			this.missingOpeningBracketIds
		);
	}

	public appendChildOfSameHeight(node: AstNode): void {
		const native = tryMutateRustBracketList(RustBracketMutationOperation.Append, true, () => TwoThreeListAstNode.createRustCompactMutationHost(this, node));
		if (native !== undefined) { return; }
		if (this._item3) {
			throw new Error('Cannot append to a full (2,3) tree node');
		}
		this.throwIfImmutable();
		this._item3 = node;
		this.handleChildrenChanged();
	}

	public unappendChild(): AstNode | undefined {
		const native = tryMutateRustBracketList(RustBracketMutationOperation.Unappend, true, () => TwoThreeListAstNode.createRustCompactMutationHost(this));
		if (native !== undefined) { return native.value; }
		if (!this._item3) {
			throw new Error('Cannot remove from a non-full (2,3) tree node');
		}
		this.throwIfImmutable();
		const result = this._item3;
		this._item3 = null;
		this.handleChildrenChanged();
		return result;
	}

	public prependChildOfSameHeight(node: AstNode): void {
		const native = tryMutateRustBracketList(RustBracketMutationOperation.Prepend, true, () => TwoThreeListAstNode.createRustCompactMutationHost(this, node));
		if (native !== undefined) { return; }
		if (this._item3) {
			throw new Error('Cannot prepend to a full (2,3) tree node');
		}
		this.throwIfImmutable();
		this._item3 = this._item2;
		this._item2 = this._item1;
		this._item1 = node;
		this.handleChildrenChanged();
	}

	public unprependChild(): AstNode | undefined {
		const native = tryMutateRustBracketList(RustBracketMutationOperation.Unprepend, true, () => TwoThreeListAstNode.createRustCompactMutationHost(this));
		if (native !== undefined) { return native.value; }
		if (!this._item3) {
			throw new Error('Cannot remove from a non-full (2,3) tree node');
		}
		this.throwIfImmutable();
		const result = this._item1;
		this._item1 = this._item2;
		this._item2 = this._item3;
		this._item3 = null;

		this.handleChildrenChanged();
		return result;
	}

	override toMutable(): ListAstNode {
		const native = tryTransformRustBracketAst(RustBracketTransformOperation.Identity, () => createRustBracketTransformHost({ node: this }));
		if (native !== undefined) { return native.value as ListAstNode; }
		return this;
	}

	/** Static capabilities preserve private compact-slot getter/setter order and virtual metadata calls. */
	private static createRustCompactMutationHost(node: TwoThreeListAstNode, incoming?: AstNode): IRustBracketMutationHost {
		return createRustBracketMutationHost({
			incoming,
			item: index => index === 0 ? node._item1 : index === 1 ? node._item2 : node._item3,
			setItem: (index, value) => { if (index === 0) { node._item1 = value!; } else if (index === 1) { node._item2 = value!; } else { node._item3 = value; } },
			throwIfImmutable: () => node.throwIfImmutable(),
			update: () => node.handleChildrenChanged()
		});
	}

	/** Compact clone callbacks retain private fields while shallow copies retain public getter reads. */
	protected static createRustCompactTransformHost(node: TwoThreeListAstNode): IRustBracketTransformHost {
		return createRustBracketTransformHost({
			node, compactItem: (index, clone) => {
				if (index === 0) { return clone ? node._item1.deepClone() : node.item1; }
				if (index === 1) { return clone ? node._item2.deepClone() : node.item2; }
				return clone ? (node._item3 ? node._item3.deepClone() : null) : node.item3;
			}
		});
	}
}

/**
 * Immutable, if all children are immutable.
*/
class Immutable23ListAstNode extends TwoThreeListAstNode {
	override toMutable(): ListAstNode {
		const native = tryTransformRustBracketAst(RustBracketTransformOperation.MutableCompactList, () => Immutable23ListAstNode.createRustCompactTransformHost(this));
		if (native !== undefined) { return native.value as ListAstNode; }
		return new TwoThreeListAstNode(this.length, this.listHeight, this.item1, this.item2, this.item3, this.missingOpeningBracketIds);
	}

	protected override throwIfImmutable(): void {
		throw new Error('this instance is immutable');
	}
}

/**
 * For debugging.
*/
class ArrayListAstNode extends ListAstNode {
	get childrenLength(): number {
		return this._children.length;
	}
	getChild(idx: number): AstNode | null {
		return this._children[idx];
	}
	protected setChild(idx: number, child: AstNode): void {
		this._children[idx] = child;
	}
	get children(): readonly AstNode[] {
		return this._children;
	}

	constructor(
		length: Length,
		listHeight: number,
		private readonly _children: AstNode[],
		missingOpeningBracketIds: SmallImmutableSet<OpeningBracketId>
	) {
		super(length, listHeight, missingOpeningBracketIds);
	}

	deepClone(): ListAstNode {
		const native = tryTransformRustBracketAst(RustBracketTransformOperation.CloneArrayList, () => ArrayListAstNode.createRustArrayTransformHost(this));
		if (native !== undefined) { return native.value as ListAstNode; }
		const children = new Array<AstNode>(this._children.length);
		for (let i = 0; i < this._children.length; i++) {
			children[i] = this._children[i].deepClone();
		}
		return new ArrayListAstNode(this.length, this.listHeight, children, this.missingOpeningBracketIds);
	}

	public appendChildOfSameHeight(node: AstNode): void {
		const native = tryMutateRustBracketList(RustBracketMutationOperation.Append, false, () => ArrayListAstNode.createRustArrayMutationHost(this, node));
		if (native !== undefined) { return; }
		this.throwIfImmutable();
		this._children.push(node);
		this.handleChildrenChanged();
	}

	public unappendChild(): AstNode | undefined {
		const native = tryMutateRustBracketList(RustBracketMutationOperation.Unappend, false, () => ArrayListAstNode.createRustArrayMutationHost(this));
		if (native !== undefined) { return native.value; }
		this.throwIfImmutable();
		const item = this._children.pop();
		this.handleChildrenChanged();
		return item;
	}

	public prependChildOfSameHeight(node: AstNode): void {
		const native = tryMutateRustBracketList(RustBracketMutationOperation.Prepend, false, () => ArrayListAstNode.createRustArrayMutationHost(this, node));
		if (native !== undefined) { return; }
		this.throwIfImmutable();
		this._children.unshift(node);
		this.handleChildrenChanged();
	}

	public unprependChild(): AstNode | undefined {
		const native = tryMutateRustBracketList(RustBracketMutationOperation.Unprepend, false, () => ArrayListAstNode.createRustArrayMutationHost(this));
		if (native !== undefined) { return native.value; }
		this.throwIfImmutable();
		const item = this._children.shift();
		this.handleChildrenChanged();
		return item;
	}

	public override toMutable(): ListAstNode {
		const native = tryTransformRustBracketAst(RustBracketTransformOperation.Identity, () => createRustBracketTransformHost({ node: this }));
		if (native !== undefined) { return native.value as ListAstNode; }
		return this;
	}

	/** Static capabilities retain original array method lookup, aliases, and post-mutation metadata calls. */
	private static createRustArrayMutationHost(node: ArrayListAstNode, incoming?: AstNode): IRustBracketMutationHost {
		return createRustBracketMutationHost({
			incoming,
			arrayMutation: operation => {
				switch (operation) {
					case RustBracketMutationOperation.Append: node._children.push(incoming!); return undefined;
					case RustBracketMutationOperation.Unappend: return node._children.pop();
					case RustBracketMutationOperation.Prepend: node._children.unshift(incoming!); return undefined;
					case RustBracketMutationOperation.Unprepend: return node._children.shift();
				}
			},
			throwIfImmutable: () => node.throwIfImmutable(),
			update: () => node.handleChildrenChanged()
		});
	}

	/** Clone callbacks retain constructor allocation, live source-length reads, and output slot writes. */
	private static createRustArrayTransformHost(node: ArrayListAstNode): IRustBracketTransformHost {
		return createRustBracketTransformHost({
			node,
			cloneArray: () => new Array<AstNode>(node._children.length),
			indexBeforeCount: index => index < node._children.length,
			cloneInto: (output, index) => { output[index] = node._children[index].deepClone(); }
		});
	}
}

/**
 * Immutable, if all children are immutable.
*/
class ImmutableArrayListAstNode extends ArrayListAstNode {
	override toMutable(): ListAstNode {
		const native = tryTransformRustBracketAst(RustBracketTransformOperation.MutableArrayList, () => createRustBracketTransformHost({ node: this }));
		if (native !== undefined) { return native.value as ListAstNode; }
		return new ArrayListAstNode(this.length, this.listHeight, [...this.children], this.missingOpeningBracketIds);
	}

	protected override throwIfImmutable(): void {
		throw new Error('this instance is immutable');
	}
}

const emptyArray: readonly AstNode[] = [];

abstract class ImmutableLeafAstNode extends BaseAstNode {
	public get listHeight() {
		return 0;
	}
	public get childrenLength(): number {
		return 0;
	}
	public getChild(idx: number): AstNode | null {
		return null;
	}
	public get children(): readonly AstNode[] {
		return emptyArray;
	}

	public flattenLists(): this & AstNode {
		const native = tryTransformRustBracketAst(RustBracketTransformOperation.Identity, () => createRustBracketTransformHost({ node: this as this & AstNode }));
		if (native !== undefined) { return native.value as this & AstNode; }
		return this as this & AstNode;
	}
	public deepClone(): this & AstNode {
		const native = tryTransformRustBracketAst(RustBracketTransformOperation.Identity, () => createRustBracketTransformHost({ node: this as this & AstNode }));
		if (native !== undefined) { return native.value as this & AstNode; }
		return this as this & AstNode;
	}
}

export class TextAstNode extends ImmutableLeafAstNode {
	public get kind(): AstNodeKind.Text {
		return AstNodeKind.Text;
	}
	public get missingOpeningBracketIds(): SmallImmutableSet<OpeningBracketId> {
		return SmallImmutableSet.getEmpty();
	}

	public canBeReused(_openedBracketIds: SmallImmutableSet<OpeningBracketId>) {
		const native = tryRunRustBracketAst(RustBracketAstOperation.ReuseText, () => createRustBracketAstHost({ node: this, openBracketIds: _openedBracketIds }));
		if (native !== undefined) { return native.value as boolean; }
		return true;
	}

	public computeMinIndentation(offset: Length, textModel: ITextModel): number {
		const native = tryComputeRustBracketIndentation(RustBracketIndentationOperation.Text, offset, () => createRustBracketIndentationHost(this, textModel));
		if (native !== undefined) { return native.indentation; }
		const start = lengthToObj(offset);
		// Text ast nodes don't have partial indentation (ensured by the tokenizer).
		// Thus, if this text node does not start at column 0, the first line cannot have any indentation at all.
		const startLineNumber = (start.columnCount === 0 ? start.lineCount : start.lineCount + 1) + 1;
		const endLineNumber = lengthGetLineCount(lengthAdd(offset, this.length)) + 1;

		let result = Number.MAX_SAFE_INTEGER;

		for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
			const firstNonWsColumn = textModel.getLineFirstNonWhitespaceColumn(lineNumber);
			const lineContent = textModel.getLineContent(lineNumber);
			if (firstNonWsColumn === 0) {
				continue;
			}

			const visibleColumn = CursorColumns.visibleColumnFromColumn(lineContent, firstNonWsColumn, textModel.getOptions().tabSize);
			result = Math.min(result, visibleColumn);
		}

		return result;
	}
}

export class BracketAstNode extends ImmutableLeafAstNode {
	public static create(
		length: Length,
		bracketInfo: BracketKind,
		bracketIds: SmallImmutableSet<OpeningBracketId>
	): BracketAstNode {
		const node = new BracketAstNode(length, bracketInfo, bracketIds);
		return node;
	}

	public get kind(): AstNodeKind.Bracket {
		return AstNodeKind.Bracket;
	}

	public get missingOpeningBracketIds(): SmallImmutableSet<OpeningBracketId> {
		return SmallImmutableSet.getEmpty();
	}

	private constructor(
		length: Length,
		public readonly bracketInfo: BracketKind,
		/**
		 * In case of a opening bracket, this is the id of the opening bracket.
		 * In case of a closing bracket, this contains the ids of all opening brackets it can close.
		*/
		public readonly bracketIds: SmallImmutableSet<OpeningBracketId>
	) {
		super(length);
	}

	public get text() {
		return this.bracketInfo.bracketText;
	}

	public get languageId() {
		return this.bracketInfo.languageId;
	}

	public canBeReused(_openedBracketIds: SmallImmutableSet<OpeningBracketId>) {
		const native = tryRunRustBracketAst(RustBracketAstOperation.ReuseBracket, () => createRustBracketAstHost({ node: this, openBracketIds: _openedBracketIds }));
		if (native !== undefined) { return native.value as boolean; }
		// These nodes could be reused,
		// but not in a general way.
		// Their parent may be reused.
		return false;
	}

	public computeMinIndentation(offset: Length, textModel: ITextModel): number {
		const native = tryComputeRustBracketIndentation(RustBracketIndentationOperation.Leaf, offset, () => createRustBracketIndentationHost(this, textModel));
		if (native !== undefined) { return native.indentation; }
		return Number.MAX_SAFE_INTEGER;
	}
}

export class InvalidBracketAstNode extends ImmutableLeafAstNode {
	public get kind(): AstNodeKind.UnexpectedClosingBracket {
		return AstNodeKind.UnexpectedClosingBracket;
	}

	public readonly missingOpeningBracketIds: SmallImmutableSet<OpeningBracketId>;

	public constructor(closingBrackets: SmallImmutableSet<OpeningBracketId>, length: Length) {
		super(length);
		this.missingOpeningBracketIds = closingBrackets;
	}

	public canBeReused(openedBracketIds: SmallImmutableSet<OpeningBracketId>) {
		const native = tryRunRustBracketAst(RustBracketAstOperation.ReuseInvalid, () => createRustBracketAstHost({ node: this, openBracketIds: openedBracketIds }));
		if (native !== undefined) { return native.value as boolean; }
		return !openedBracketIds.intersects(this.missingOpeningBracketIds);
	}

	public computeMinIndentation(offset: Length, textModel: ITextModel): number {
		const native = tryComputeRustBracketIndentation(RustBracketIndentationOperation.Leaf, offset, () => createRustBracketIndentationHost(this, textModel));
		if (native !== undefined) { return native.indentation; }
		return Number.MAX_SAFE_INTEGER;
	}
}

/** Ordered capabilities retain Math/cursor callbacks, repeated child reads, and private cache writes. */
function createRustBracketIndentationHost(node: AstNode, textModel: ITextModel, readCached?: () => number, writeCached?: (value: number) => void): IRustBracketIndentationHost {
	return {
		maximum: () => Number.MAX_SAFE_INTEGER,
		pairHasChild: () => !!(node as PairAstNode).child,
		pairCompute: offset => (node as PairAstNode).child!.computeMinIndentation(lengthAdd(offset, (node as PairAstNode).openingBracket.length), textModel),
		cacheUncomputed: () => readCached!() === -1,
		cached: () => readCached!(),
		indexBeforeCount: index => index < node.childrenLength,
		child: index => node.getChild(index),
		truthy: value => !!value,
		minimumChild: (current, child, offset) => Math.min(current, child.computeMinIndentation(offset, textModel)),
		end: (offset, child) => lengthAdd(offset, child.length),
		setCached: value => { writeCached!(value); },
		startLine: offset => { const start = lengthToObj(offset); return (start.columnCount === 0 ? start.lineCount : start.lineCount + 1) + 1; },
		endLine: offset => lengthGetLineCount(lengthAdd(offset, node.length)) + 1,
		lineBeforeEnd: (line, end) => line <= end,
		firstColumn: line => textModel.getLineFirstNonWhitespaceColumn(line),
		lineContent: line => textModel.getLineContent(line),
		isZero: value => value === 0,
		visibleColumn: (content, first) => CursorColumns.visibleColumnFromColumn(content, first, textModel.getOptions().tabSize),
		minimum: (first, second) => Math.min(first, second),
		increment: line => ++line
	};
}

/** Original constructors and private mutation hooks remain at the AST class boundary. */
interface IBracketAstCapabilities {
	node?: AstNode;
	items?: (AstNode | null)[];
	immutable?: boolean;
	openBracketIds?: SmallImmutableSet<OpeningBracketId>;
	createPair?: (length: Length, ids: SmallImmutableSet<OpeningBracketId>) => PairAstNode;
	emptyList?: () => ListAstNode;
	throwIfImmutable?: () => void;
	setLength?: (value: Length) => void;
	setMissing?: (value: SmallImmutableSet<OpeningBracketId>) => void;
	resetIndentation?: () => void;
	setEdge?: (count: number, child: AstNode, last: boolean) => void;
}

/** Ordered capabilities preserve method lookup before array/provider arguments and partial setters. */
function createRustBracketAstHost(capabilities: IBracketAstCapabilities): IRustBracketAstHost {
	return {
		receiver: () => capabilities.node!,
		item: index => capabilities.items![index],
		truthy: value => !!value,
		length: node => node.length,
		missing: node => node.missingOpeningBracketIds,
		emptyIds: () => SmallImmutableSet.getEmpty(),
		addLength: (length, node) => lengthAdd(length, node.length),
		mergeIds: (ids, node) => ids.merge(node.missingOpeningBracketIds),
		mergeItem: (ids, index) => ids.merge(capabilities.items![index]!.missingOpeningBracketIds),
		equalHeights: (first, second) => first.listHeight === second.listHeight,
		invalidHeights: () => { throw new Error('Invalid list heights'); },
		createPair: (length, ids) => capabilities.createPair!(length, ids),
		createList: (length, ids, compact) => {
			const items = capabilities.items!;
			if (compact) {
				return capabilities.immutable ? new Immutable23ListAstNode(length, items[0]!.listHeight + 1, items[0]!, items[1]!, items[2], ids) : new TwoThreeListAstNode(length, items[0]!.listHeight + 1, items[0]!, items[1]!, items[2], ids);
			}
			return capabilities.immutable ? new ImmutableArrayListAstNode(length, items[0]!.listHeight + 1, items as AstNode[], ids) : new ArrayListAstNode(length, items[0]!.listHeight + 1, items as AstNode[], ids);
		},
		itemCount: () => capabilities.items!.length,
		isZero: value => value === 0,
		indexBefore: (index, count) => index < count,
		emptyList: () => capabilities.emptyList!(),
		throwIfImmutable: () => capabilities.throwIfImmutable!(),
		childCount: node => node.childrenLength,
		child: (node, index) => node.getChild(index),
		setLength: value => capabilities.setLength!(value),
		setMissing: value => capabilities.setMissing!(value),
		resetIndentation: () => capabilities.resetIndentation!(),
		closingMissing: () => (capabilities.node as PairAstNode).closingBracket === null,
		intersectsNode: node => capabilities.openBracketIds!.intersects(node.missingOpeningBracketIds),
		isList: node => node.kind === AstNodeKind.List,
		invalidEmptyChild: () => { throw new BugIndicatingError(); },
		edgeChild: (node, count, last) => node.getChild(last ? count - 1 : 0)!,
		reuseLeaf: node => node.canBeReused(capabilities.openBracketIds!),
		toMutable: node => (node as ListAstNode).toMutable(),
		same: (first, second) => first === second,
		setEdge: (count, child, last) => capabilities.setEdge!(count, child, last)
	};
}

/** Original concrete list fields and array operations remain behind their private class capabilities. */
interface IBracketMutationCapabilities {
	incoming?: AstNode;
	item?: (index: number) => AstNode | null;
	setItem?: (index: number, value: AstNode | null) => void;
	arrayMutation?: (operation: RustBracketMutationOperation) => AstNode | undefined;
	throwIfImmutable(): void;
	update(): void;
}

/** Shared capabilities retain capacity error wording and original concrete method dispatch. */
function createRustBracketMutationHost(capabilities: IBracketMutationCapabilities): IRustBracketMutationHost {
	return {
		incoming: () => capabilities.incoming,
		item: index => capabilities.item!(index),
		truthy: value => !!value,
		invalidCapacity: operation => {
			if (operation === RustBracketMutationOperation.Append) { throw new Error('Cannot append to a full (2,3) tree node'); }
			if (operation === RustBracketMutationOperation.Prepend) { throw new Error('Cannot prepend to a full (2,3) tree node'); }
			throw new Error('Cannot remove from a non-full (2,3) tree node');
		},
		throwIfImmutable: () => capabilities.throwIfImmutable(),
		setItem: (index, value) => capabilities.setItem!(index, value),
		arrayMutation: operation => capabilities.arrayMutation!(operation),
		update: () => capabilities.update()
	};
}

/** Original node-specific constructors and private clone loops remain behind class capabilities. */
interface IBracketTransformCapabilities {
	node: AstNode;
	clonePair?: IRustBracketTransformHost['clonePair'];
	compactItem?: IRustBracketTransformHost['compactItem'];
	cloneArray?: () => AstNode[];
	indexBeforeCount?: (index: number) => boolean;
	cloneInto?: (output: AstNode[], index: number) => void;
}

/** Delegates the original for-of protocol while Rust controls AST traversal and completion. */
export function* iterateBracketChildren(node: AstNode): Generator<AstNode, void, void> {
	for (const child of node.children) { yield child; }
}

/** Ordered clone/factory capabilities preserve argument evaluation and spread/iterator behavior. */
function createRustBracketTransformHost(capabilities: IBracketTransformCapabilities): IRustBracketTransformHost {
	const node = capabilities.node;
	return {
		receiver: () => node,
		length: () => node.length,
		height: () => node.listHeight,
		missing: () => node.missingOpeningBracketIds,
		pairFactory: () => { const factory = PairAstNode.create; return (opening, child, closing) => Reflect.apply(factory, PairAstNode, [opening, child, closing]) as PairAstNode; },
		pairOpening: clone => clone ? (node as PairAstNode).openingBracket.deepClone() : (node as PairAstNode).openingBracket.flattenLists(),
		pairChild: clone => clone ? (node as PairAstNode).child && (node as PairAstNode).child!.deepClone() : (node as PairAstNode).child && (node as PairAstNode).child!.flattenLists(),
		pairClosing: clone => clone ? (node as PairAstNode).closingBracket && (node as PairAstNode).closingBracket!.deepClone() : (node as PairAstNode).closingBracket && (node as PairAstNode).closingBracket!.flattenLists(),
		createPair: (factory, opening, child, closing) => factory(opening, child, closing),
		clonePair: (length, opening, child, closing, missing) => capabilities.clonePair!(length, opening, child, closing, missing),
		compactItem: (index, clone) => capabilities.compactItem!(index, clone),
		createCompact: (length, height, first, second, third, missing) => new TwoThreeListAstNode(length, height, first, second, third, missing),
		cloneArray: () => capabilities.cloneArray!(),
		indexBeforeCount: index => capabilities.indexBeforeCount!(index),
		cloneInto: (output, index) => capabilities.cloneInto!(output, index),
		spreadChildren: () => [...node.children],
		createArray: (length, height, children, missing) => new ArrayListAstNode(length, height, children, missing),
		emptyItems: () => [],
		iterator: () => iterateBracketChildren(node),
		next: iterator => iterator.next(),
		done: step => !!step.done,
		stepValue: step => step.value,
		close: iterator => { iterator.return(undefined); },
		flattenChild: child => child.flattenLists(),
		isList: child => child.kind === AstNodeKind.List,
		pushFlattened: (items, child, expand) => { if (expand) { items.push(...child.children); } else { items.push(child); } },
		createFlattened: items => ListAstNode.create(items)
	};
}
