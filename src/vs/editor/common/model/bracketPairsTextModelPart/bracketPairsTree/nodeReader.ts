/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AstNode } from './ast.js';
import { lengthAdd, lengthZero, Length, lengthLessThan } from './length.js';
import { IRustBracketNodeReaderHost, tryAdvanceRustBracketNode, tryReadRustBracketNode } from './rustBracketNodeReader.js';
import { ownRustBracketNumericState, RustBracketNumericStateKind } from './rustBracketNodeMetadata.js';

/**
 * Allows to efficiently find a longest child at a given offset in a fixed node.
 * The requested offsets must increase monotonously.
*/
export class NodeReader {
	private readonly nextNodes: AstNode[];
	private readonly offsets: Length[];
	private readonly idxs: number[];
	private lastOffset: Length = lengthZero;

	constructor(node: AstNode) {
		this.nextNodes = [node];
		this.offsets = [lengthZero];
		this.idxs = [];
		return ownRustBracketNumericState(this, RustBracketNumericStateKind.NodeReader);
	}

	/**
	 * Returns the longest node at `offset` that satisfies the predicate.
	 * @param offset must be greater than or equal to the last offset this method has been called with!
	*/
	readLongestNodeAt(offset: Length, predicate: (node: AstNode) => boolean): AstNode | undefined {
		if (lengthLessThan(offset, this.lastOffset)) {
			throw new Error('Invalid offset');
		}
		this.lastOffset = offset;
		const native = tryReadRustBracketNode(offset, () => NodeReader.createRustHost(this, predicate));
		if (native !== undefined) { return native.node; }

		// Find the longest node of all those that are closest to the current offset.
		while (true) {
			const curNode = lastOrUndefined(this.nextNodes);

			if (!curNode) {
				return undefined;
			}
			const curNodeOffset = lastOrUndefined(this.offsets)!;

			if (lengthLessThan(offset, curNodeOffset)) {
				// The next best node is not here yet.
				// The reader must advance before a cached node is hit.
				return undefined;
			}

			if (lengthLessThan(curNodeOffset, offset)) {
				// The reader is ahead of the current node.
				if (lengthAdd(curNodeOffset, curNode.length) <= offset) {
					// The reader is after the end of the current node.
					this.nextNodeAfterCurrent();
				} else {
					// The reader is somewhere in the current node.
					const nextChildIdx = getNextChildIdx(curNode);
					if (nextChildIdx !== -1) {
						// Go to the first child and repeat.
						this.nextNodes.push(curNode.getChild(nextChildIdx)!);
						this.offsets.push(curNodeOffset);
						this.idxs.push(nextChildIdx);
					} else {
						// We don't have children
						this.nextNodeAfterCurrent();
					}
				}
			} else {
				// readerOffsetBeforeChange === curNodeOffset
				if (predicate(curNode)) {
					this.nextNodeAfterCurrent();
					return curNode;
				} else {
					const nextChildIdx = getNextChildIdx(curNode);
					// look for shorter node
					if (nextChildIdx === -1) {
						// There is no shorter node.
						this.nextNodeAfterCurrent();
						return undefined;
					} else {
						// Descend into first child & repeat.
						this.nextNodes.push(curNode.getChild(nextChildIdx)!);
						this.offsets.push(curNodeOffset);
						this.idxs.push(nextChildIdx);
					}
				}
			}
		}
	}

	// Navigates to the longest node that continues after the current node.
	private nextNodeAfterCurrent(): void {
		if (tryAdvanceRustBracketNode(() => NodeReader.createRustHost(this, () => false))) { return; }
		while (true) {
			const currentOffset = lastOrUndefined(this.offsets);
			const currentNode = lastOrUndefined(this.nextNodes);
			this.nextNodes.pop();
			this.offsets.pop();

			if (this.idxs.length === 0) {
				// We just popped the root node, there is no next node.
				break;
			}

			// Parent is not undefined, because idxs is not empty
			const parent = lastOrUndefined(this.nextNodes)!;
			const nextChildIdx = getNextChildIdx(parent, this.idxs[this.idxs.length - 1]);

			if (nextChildIdx !== -1) {
				this.nextNodes.push(parent.getChild(nextChildIdx)!);
				this.offsets.push(lengthAdd(currentOffset!, currentNode!.length));
				this.idxs[this.idxs.length - 1] = nextChildIdx;
				break;
			} else {
				this.idxs.pop();
			}
			// We fully consumed the parent.
			// Current node is now parent, so call nextNodeAfterCurrent again
		}
	}

	/** Host capabilities retain ordered state reads, virtual calls, and partial stack writes. */
	private static createRustHost(reader: NodeReader, predicate: (node: AstNode) => boolean): IRustBracketNodeReaderHost {
		return {
			currentNode: () => lastOrUndefined(reader.nextNodes),
			currentOffset: () => lastOrUndefined(reader.offsets),
			truthy: node => !!node,
			offsetBefore: (first, second) => lengthLessThan(first, second),
			endBefore: (node, current, requested) => lengthAdd(current, node.length) <= requested,
			predicate: node => predicate(node),
			advance: () => reader.nextNodeAfterCurrent(),
			incrementIndex: (index = -1) => ++index,
			indexAtEnd: (node, index) => index >= node.childrenLength,
			childExists: (node, index) => !!node.getChild(index),
			missingIndex: index => index === -1,
			descend: (node, offset, index) => { reader.nextNodes.push(node.getChild(index)!); reader.offsets.push(offset); reader.idxs.push(index); },
			popCurrent: () => { reader.nextNodes.pop(); reader.offsets.pop(); },
			noParents: () => reader.idxs.length === 0,
			lastChildIndex: () => reader.idxs[reader.idxs.length - 1],
			moveToChild: (parent, current, offset, index) => { reader.nextNodes.push(parent.getChild(index)!); reader.offsets.push(lengthAdd(offset, current.length)); reader.idxs[reader.idxs.length - 1] = index; },
			popParent: () => { reader.idxs.pop(); }
		};
	}
}

function getNextChildIdx(node: AstNode, curIdx: number = -1): number | -1 {
	while (true) {
		curIdx++;
		if (curIdx >= node.childrenLength) {
			return -1;
		}
		if (node.getChild(curIdx)) {
			return curIdx;
		}
	}
}

function lastOrUndefined<T>(arr: readonly T[]): T | undefined {
	return arr.length > 0 ? arr[arr.length - 1] : undefined;
}
