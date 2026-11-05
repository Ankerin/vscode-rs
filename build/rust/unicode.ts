/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const target = resolve(root, 'rust/editor-core/src/unicode_grapheme_data.rs');

async function sourceData(): Promise<number[]> {
	const source = await readFile(resolve(root, 'src/vs/base/common/strings.ts'), 'utf8');
	const raw = /function getGraphemeBreakRawData\(\): number\[\] \{[\s\S]*?JSON\.parse\('(?<data>\[[\d,]+\])'\)/.exec(source)?.groups?.data;
	if (!raw) { throw new Error('The original grapheme data contract has changed'); }
	const data: number[] = JSON.parse(raw);
	if (data.length % 3 !== 0 || data.some(value => !Number.isSafeInteger(value) || value < 0 || value > 0x10FFFF)) { throw new Error('The original grapheme data is invalid'); }
	return data;
}

/** Keeps the checked-in Rust table identical to the original indexed Unicode data. */
export async function verifyUnicodeData(): Promise<void> {
	const expected = await sourceData();
	const source = await readFile(target, 'utf8');
	const rows = /= &\[(?<rows>[\s\S]*)\];/.exec(source)?.groups?.rows;
	const actual = rows?.match(/\d+/g)?.map(Number);
	if (!actual || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) { throw new Error('Update the Rust grapheme data with node build/rust/unicode.ts --write'); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.includes('--write')) {
		const data = await sourceData();
		const rows: string[] = [];
		for (let index = 0; index < data.length; index += 3) { rows.push(`\t[${data[index]}, ${data[index + 1]}, ${data[index + 2]}],`); }
		await writeFile(target, `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Generated from src/vs/base/common/strings.ts by build/rust/unicode.ts; preserve indexed layout.

pub(crate) const GRAPHEME_DATA: &[[u32; 3]] = &[
${rows.join('\n')}
];
`);
	} else {
		await verifyUnicodeData();
	}
}
