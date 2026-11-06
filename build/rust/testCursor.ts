/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { access, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, 'out/vs/editor/test/browser/controller/rustCursor.test.js');
await access(resolve(root, 'out/vs/editor/test/browser/controller/cursor.test.js'));
await access(resolve(root, 'out/vs/editor/common/model/rustTextBuffer/vscode_editor_wasm.js'));

// Load the unchanged canonical cursor suite after registering the same compiled editor core.
await writeFile(output, `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import initialize, * as rust from '../../../common/model/rustTextBuffer/vscode_editor_wasm.js';
import { registerRustTextBuffer } from '../../../common/model/rustTextBuffer/rustTextBuffer.js';

await initialize();
const registration = registerRustTextBuffer(rust);
globalThis.addEventListener('unload', () => registration.dispose(), { once: true });
await import('./cursor.test.js');
`);

try {
	for (const engine of ['existing', 'rust']) {
		const suite = engine === 'rust' ? 'rustCursor' : 'cursor';
		const result = spawnSync(process.execPath, [
			resolve(root, 'test/unit/browser/index.js'),
			'--run', `src/vs/editor/test/browser/controller/${suite}.test.ts`,
			'--browser', 'chromium', '--workers', '1', '--reporter', 'dot',
			...process.argv.slice(2)
		], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
		if (result.error) { throw result.error; }
		if (result.status !== 0) {
			process.stdout.write(result.stdout);
			process.stderr.write(result.stderr);
			process.exitCode = result.status ?? 1;
			break;
		}
		const count = /(?<count>\d+) passing/.exec(stripVTControlCharacters(result.stdout))?.groups?.count;
		console.log(`${engine}: ${count ?? 'all selected'} cursor tests passed through the canonical Chromium unit runner`);
	}
} finally {
	await unlink(output);
}
