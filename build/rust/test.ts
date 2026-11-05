/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outputDirectory = resolve(root, '.build/rust');
const browserTests = process.argv.includes('--browser');
const tests = browserTests ? ['browserWorkerParity'] : ['textBufferParity', 'mirrorModelParity', 'sequenceDiffParity', 'textChangeParity'];
await build({
	entryPoints: (browserTests ? tests : [...tests, 'editorWorkerRealm']).map(file => resolve(root, `test/rust/${file}.ts`)),
	outdir: outputDirectory,
	outExtension: { '.js': '.mjs' },
	bundle: true,
	platform: 'node',
	format: 'esm',
	packages: 'external',
	tsconfig: resolve(root, 'src/tsconfig.json')
});

if (browserTests) {
	await build({
		entryPoints: ['browserWorkerFixture', 'browserEditorWorkerRealm'].map(file => resolve(root, `test/rust/${file}.ts`)),
		outdir: outputDirectory,
		outExtension: { '.js': '.mjs' },
		bundle: true,
		platform: 'browser',
		format: 'esm',
		tsconfig: resolve(root, 'src/tsconfig.json')
	});
}

const result = spawnSync(process.execPath, ['--expose-gc', '--test', ...tests.map(file => resolve(outputDirectory, `${file}.mjs`))], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) {
	throw result.error;
}
process.exit(result.status ?? 1);
