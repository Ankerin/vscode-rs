/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as strings from '../../../../base/common/strings.js';
import { CursorColumns } from '../cursorColumns.js';
import { tryNormalizeRustIndentation } from '../rustTextShape.js';

function _normalizeIndentationFromWhitespace(str: string, indentSize: number, insertSpaces: boolean): string {
	let spacesCnt = 0;
	for (let i = 0; i < str.length; i++) {
		if (str.charAt(i) === '\t') {
			spacesCnt = CursorColumns.nextIndentTabStop(spacesCnt, indentSize);
		} else {
			spacesCnt++;
		}
	}

	let result = '';
	if (!insertSpaces) {
		const tabsCnt = Math.floor(spacesCnt / indentSize);
		spacesCnt = spacesCnt % indentSize;
		for (let i = 0; i < tabsCnt; i++) {
			result += '\t';
		}
	}

	for (let i = 0; i < spacesCnt; i++) {
		result += ' ';
	}

	return result;
}

export function normalizeIndentation(str: string, indentSize: number, insertSpaces: boolean): string {
	const native = indentationMethods.every(({ name, descriptor }) => {
		const current = Object.getOwnPropertyDescriptor(CursorColumns, name);
		return current?.value === descriptor?.value && current?.get === descriptor?.get;
	}) ? tryNormalizeRustIndentation(str, indentSize, insertSpaces) : undefined;
	if (native !== undefined) { return native; }
	let firstNonWhitespaceIndex = strings.firstNonWhitespaceIndex(str);
	if (firstNonWhitespaceIndex === -1) {
		firstNonWhitespaceIndex = str.length;
	}
	return _normalizeIndentationFromWhitespace(str.substring(0, firstNonWhitespaceIndex), indentSize, insertSpaces) + str.substring(firstNonWhitespaceIndex);
}

const indentationMethods = ['nextIndentTabStop', 'nextRenderTabStop'].map(name => ({ name, descriptor: Object.getOwnPropertyDescriptor(CursorColumns, name) }));
