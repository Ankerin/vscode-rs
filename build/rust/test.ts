/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, '.build/rust/textBufferParity.mjs');
await build({
	entryPoints: [resolve(root, 'test/rust/textBufferParity.ts')],
	outfile: output,
	bundle: true,
	platform: 'node',
	format: 'esm',
	packages: 'external',
	tsconfig: resolve(root, 'src/tsconfig.json')
});

const result = spawnSync(process.execPath, ['--expose-gc', '--test', output], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) {
	throw result.error;
}
process.exit(result.status ?? 1);
