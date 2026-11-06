/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ArrayQueue } from '../../../../../base/common/arrays.js';
import { TextEditInfo } from './beforeEditPositionMapper.js';
import { Length, lengthAdd, lengthDiffNonNegative, lengthEquals, lengthIsZero, lengthToObj, lengthZero, sumLengths } from './length.js';
import { tryCombineRustBracketMappings } from './rustBracketEdits.js';
import { ownRustBracketArray } from './rustBracketNumberArray.js';

export function combineTextEditInfos(textEditInfoFirst: TextEditInfo[], textEditInfoSecond: TextEditInfo[]): TextEditInfo[] {
	if (textEditInfoFirst.length === 0) {
		return textEditInfoSecond;
	}
	if (textEditInfoSecond.length === 0) {
		return textEditInfoFirst;
	}

	// s0: State before any edits
	const firstMappings = toLengthMapping(textEditInfoFirst);
	const s0ToS1Map = new ArrayQueue(firstMappings);
	// s1: State after first edit, but before second edit
	const s1ToS2Map = toLengthMapping(textEditInfoSecond) as (LengthMapping | { lengthBefore: undefined; lengthAfter: undefined; modified: false })[];
	s1ToS2Map.push({ modified: false, lengthBefore: undefined, lengthAfter: undefined }); // Copy everything from old to new
	// s2: State after both edits
	const split = Object.getOwnPropertyDescriptor(LengthMapping.prototype, 'splitAt');
	const native = split?.value === standardSplit?.value && split?.get === standardSplit?.get ? tryCombineRustBracketMappings(firstMappings, s1ToS2Map, mapping => standardMappings.has(mapping as LengthMapping) && Object.getPrototypeOf(mapping) === LengthMapping.prototype) : undefined;
	if (native !== undefined) {
		const result: TextEditInfo[] = ownRustBracketArray([]);
		for (let index = 0; index < native.length; index += 4) {
			const startOffset = native[index] as unknown as Length;
			const endOffset = native[index + 1] as unknown as Length;
			const newLength = native[index + 2] as unknown as Length;
			result.push(native[index + 3] === 1 ? new TextEditInfo(startOffset, endOffset, newLength) : { startOffset, endOffset, newLength });
		}
		return result;
	}

	let curItem: LengthMapping | undefined = s0ToS1Map.dequeue();

	/**
	 * @param s1Length Use undefined for length "infinity"
	 */
	function nextS0ToS1MapWithS1LengthOf(s1Length: Length | undefined): LengthMapping[] {
		if (s1Length === undefined) {
			const arr = s0ToS1Map.takeWhile(v => true) || [];
			if (curItem) {
				arr.unshift(curItem);
			}
			return arr;
		}

		const result: LengthMapping[] = [];
		while (curItem && !lengthIsZero(s1Length)) {
			const [item, remainingItem] = curItem.splitAt(s1Length);
			result.push(item);
			s1Length = lengthDiffNonNegative(item.lengthAfter, s1Length);
			curItem = remainingItem ?? s0ToS1Map.dequeue();
		}
		if (!lengthIsZero(s1Length)) {
			result.push(new LengthMapping(false, s1Length, s1Length));
		}
		return result;
	}

	const result: TextEditInfo[] = ownRustBracketArray([]);

	function pushEdit(startOffset: Length, endOffset: Length, newLength: Length): void {
		if (result.length > 0 && lengthEquals(result[result.length - 1].endOffset, startOffset)) {
			const lastResult = result[result.length - 1];
			result[result.length - 1] = new TextEditInfo(lastResult.startOffset, endOffset, lengthAdd(lastResult.newLength, newLength));
		} else {
			result.push({ startOffset, endOffset, newLength });
		}
	}

	let s0offset = lengthZero;
	for (const s1ToS2 of s1ToS2Map) {
		const s0ToS1Map = nextS0ToS1MapWithS1LengthOf(s1ToS2.lengthBefore);
		if (s1ToS2.modified) {
			const s0Length = sumLengths(s0ToS1Map, s => s.lengthBefore);
			const s0EndOffset = lengthAdd(s0offset, s0Length);
			pushEdit(s0offset, s0EndOffset, s1ToS2.lengthAfter);
			s0offset = s0EndOffset;
		} else {
			for (const s1 of s0ToS1Map) {
				const s0startOffset = s0offset;
				s0offset = lengthAdd(s0offset, s1.lengthBefore);
				if (s1.modified) {
					pushEdit(s0startOffset, s0offset, s1.lengthAfter);
				}
			}
		}
	}

	return result;
}

const standardMappings = new WeakSet<LengthMapping>();

class LengthMapping {
	constructor(
		/**
		 * If false, length before and length after equal.
		 */
		public readonly modified: boolean,
		public readonly lengthBefore: Length,
		public readonly lengthAfter: Length,
	) {
		if (new.target === LengthMapping) { standardMappings.add(this); }
	}

	splitAt(lengthAfter: Length): [LengthMapping, LengthMapping | undefined] {
		const remainingLengthAfter = lengthDiffNonNegative(lengthAfter, this.lengthAfter);
		if (lengthEquals(remainingLengthAfter, lengthZero)) {
			return [this, undefined];
		} else if (this.modified) {
			return [
				new LengthMapping(this.modified, this.lengthBefore, lengthAfter),
				new LengthMapping(this.modified, lengthZero, remainingLengthAfter)
			];
		} else {
			return [
				new LengthMapping(this.modified, lengthAfter, lengthAfter),
				new LengthMapping(this.modified, remainingLengthAfter, remainingLengthAfter)
			];
		}
	}

	toString(): string {
		return `${this.modified ? 'M' : 'U'}:${lengthToObj(this.lengthBefore)} -> ${lengthToObj(this.lengthAfter)}`;
	}
}

const standardSplit = Object.getOwnPropertyDescriptor(LengthMapping.prototype, 'splitAt');

function toLengthMapping(textEditInfos: TextEditInfo[]): LengthMapping[] {
	const result: LengthMapping[] = [];
	let lastOffset = lengthZero;
	for (const textEditInfo of textEditInfos) {
		const spaceLength = lengthDiffNonNegative(lastOffset, textEditInfo.startOffset);
		if (!lengthIsZero(spaceLength)) {
			result.push(new LengthMapping(false, spaceLength, spaceLength));
		}

		const lengthBefore = lengthDiffNonNegative(textEditInfo.startOffset, textEditInfo.endOffset);
		result.push(new LengthMapping(true, lengthBefore, textEditInfo.newLength));
		lastOffset = textEditInfo.endOffset;
	}
	return result;
}
