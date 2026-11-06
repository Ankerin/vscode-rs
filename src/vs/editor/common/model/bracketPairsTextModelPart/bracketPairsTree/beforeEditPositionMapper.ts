/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Range } from '../../../core/range.js';
import { Length, lengthAdd, lengthDiffNonNegative, lengthLessThanEqual, lengthOfString, lengthToObj, positionToLength, toLength } from './length.js';
import { TextLength } from '../../../core/text/textLength.js';
import { IModelContentChange } from '../../mirrorTextModel.js';
import { IRustBracketPositionMapperHost, tryAdjustRustBracketPosition, tryRustBracketChangeDistance, tryTranslateRustBracketPosition } from './rustBracketPositionMapper.js';

export class TextEditInfo {
	public static fromModelContentChanges(changes: IModelContentChange[]): TextEditInfo[] {
		// Must be sorted in ascending order
		const edits = changes.map(c => {
			const range = Range.lift(c.range);
			return new TextEditInfo(
				positionToLength(range.getStartPosition()),
				positionToLength(range.getEndPosition()),
				lengthOfString(c.text)
			);
		}).reverse();
		return edits;
	}

	constructor(
		public readonly startOffset: Length,
		public readonly endOffset: Length,
		public readonly newLength: Length
	) {
	}

	toString(): string {
		return `[${lengthToObj(this.startOffset)}...${lengthToObj(this.endOffset)}) -> ${lengthToObj(this.newLength)}`;
	}
}

export class BeforeEditPositionMapper {
	private nextEditIdx = 0;
	private deltaOldToNewLineCount = 0;
	private deltaOldToNewColumnCount = 0;
	private deltaLineIdxInOld = -1;
	private readonly edits: readonly TextEditInfoCache[];

	/**
	 * @param edits Must be sorted by offset in ascending order.
	*/
	constructor(
		edits: readonly TextEditInfo[],
	) {
		this.edits = edits.map(edit => TextEditInfoCache.from(edit));
	}

	/**
	 * @param offset Must be equal to or greater than the last offset this method has been called with.
	*/
	getOffsetBeforeChange(offset: Length): Length {
		this.adjustNextEdit(offset);
		return this.translateCurToOld(offset);
	}

	/**
	 * @param offset Must be equal to or greater than the last offset this method has been called with.
	 * Returns null if there is no edit anymore.
	*/
	getDistanceToNextChange(offset: Length): Length | null {
		this.adjustNextEdit(offset);
		const native = tryRustBracketChangeDistance(offset, () => BeforeEditPositionMapper.createRustHost(this));
		if (native !== undefined) { return native.distance; }

		const nextEdit = this.edits[this.nextEditIdx];
		const nextChangeOffset = nextEdit ? this.translateOldToCur(nextEdit.offsetObj) : null;
		if (nextChangeOffset === null) {
			return null;
		}

		return lengthDiffNonNegative(offset, nextChangeOffset);
	}

	private translateOldToCur(oldOffsetObj: TextLength): Length {
		const native = tryTranslateRustBracketPosition(oldOffsetObj, false, () => BeforeEditPositionMapper.createRustHost(this));
		if (native !== undefined) { return native.offset; }
		if (oldOffsetObj.lineCount === this.deltaLineIdxInOld) {
			return toLength(oldOffsetObj.lineCount + this.deltaOldToNewLineCount, oldOffsetObj.columnCount + this.deltaOldToNewColumnCount);
		} else {
			return toLength(oldOffsetObj.lineCount + this.deltaOldToNewLineCount, oldOffsetObj.columnCount);
		}
	}

	private translateCurToOld(newOffset: Length): Length {
		const native = tryTranslateRustBracketPosition(newOffset, true, () => BeforeEditPositionMapper.createRustHost(this));
		if (native !== undefined) { return native.offset; }
		const offsetObj = lengthToObj(newOffset);
		if (offsetObj.lineCount - this.deltaOldToNewLineCount === this.deltaLineIdxInOld) {
			return toLength(offsetObj.lineCount - this.deltaOldToNewLineCount, offsetObj.columnCount - this.deltaOldToNewColumnCount);
		} else {
			return toLength(offsetObj.lineCount - this.deltaOldToNewLineCount, offsetObj.columnCount);
		}
	}

	private adjustNextEdit(offset: Length) {
		if (tryAdjustRustBracketPosition(offset, () => BeforeEditPositionMapper.createRustHost(this))) { return; }
		while (this.nextEditIdx < this.edits.length) {
			const nextEdit = this.edits[this.nextEditIdx];

			// After applying the edit, what is its end offset (considering all previous edits)?
			const nextEditEndOffsetInCur = this.translateOldToCur(nextEdit.endOffsetAfterObj);

			if (lengthLessThanEqual(nextEditEndOffsetInCur, offset)) {
				// We are after the edit, skip it
				this.nextEditIdx++;

				const nextEditEndOffsetInCurObj = lengthToObj(nextEditEndOffsetInCur);

				// Before applying the edit, what is its end offset (considering all previous edits)?
				const nextEditEndOffsetBeforeInCurObj = lengthToObj(this.translateOldToCur(nextEdit.endOffsetBeforeObj));

				const lineDelta = nextEditEndOffsetInCurObj.lineCount - nextEditEndOffsetBeforeInCurObj.lineCount;
				this.deltaOldToNewLineCount += lineDelta;

				const previousColumnDelta = this.deltaLineIdxInOld === nextEdit.endOffsetBeforeObj.lineCount ? this.deltaOldToNewColumnCount : 0;
				const columnDelta = nextEditEndOffsetInCurObj.columnCount - nextEditEndOffsetBeforeInCurObj.columnCount;
				this.deltaOldToNewColumnCount = previousColumnDelta + columnDelta;
				this.deltaLineIdxInOld = nextEdit.endOffsetBeforeObj.lineCount;
			} else {
				// We are in or before the edit.
				break;
			}
		}
	}

	/** Static capabilities preserve the receiver's original field and private-method observations. */
	private static createRustHost(mapper: BeforeEditPositionMapper): IRustBracketPositionMapperHost {
		return {
			add: (first, second) => first + second,
			subtract: (first, second) => first - second,
			equal: (first, second) => first === second,
			component: (coordinate, column) => column ? coordinate.columnCount : coordinate.lineCount,
			delta: field => field === 0 ? mapper.deltaOldToNewLineCount : field === 1 ? mapper.deltaOldToNewColumnCount : mapper.deltaLineIdxInOld,
			setDelta: (field, value) => {
				if (field === 0) { mapper.deltaOldToNewLineCount = value; }
				else if (field === 1) { mapper.deltaOldToNewColumnCount = value; }
				else { mapper.deltaLineIdxInOld = value; }
			},
			pack: (line, column) => toLength(line, column),
			parts: offset => lengthToObj(offset),
			hasNextEdit: () => mapper.nextEditIdx < mapper.edits.length,
			nextEdit: () => mapper.edits[mapper.nextEditIdx],
			editExists: edit => !!edit,
			editCoordinate: (edit, field) => field === 0 ? edit.offsetObj : field === 1 ? edit.endOffsetBeforeObj : edit.endOffsetAfterObj,
			translateEdit: (edit, field) => mapper.translateOldToCur(field === 0 ? edit.offsetObj : field === 1 ? edit.endOffsetBeforeObj : edit.endOffsetAfterObj),
			incrementEdit: () => { mapper.nextEditIdx++; },
			lessEqual: (first, second) => lengthLessThanEqual(first, second),
			isNull: offset => offset === null,
			distance: (first, second) => lengthDiffNonNegative(first, second)
		};
	}
}

class TextEditInfoCache {
	static from(edit: TextEditInfo): TextEditInfoCache {
		return new TextEditInfoCache(edit.startOffset, edit.endOffset, edit.newLength);
	}

	public readonly endOffsetBeforeObj: TextLength;
	public readonly endOffsetAfterObj: TextLength;
	public readonly offsetObj: TextLength;

	constructor(
		startOffset: Length,
		endOffset: Length,
		textLength: Length,
	) {
		this.endOffsetBeforeObj = lengthToObj(endOffset);
		this.endOffsetAfterObj = lengthToObj(lengthAdd(startOffset, textLength));
		this.offsetObj = lengthToObj(startOffset);
	}
}
