/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, '.build/rust/registerTextBuffer.mjs');
const tests = [
	'textModel.test.ts',
	'textModelWithTokens.test.ts',
	'model.line.test.ts',
	'tokensStore.test.ts',
	'textModelTokens.test.ts',
	'textModelSearch.test.ts',
	'editableTextModel.test.ts',
	'editStack.test.ts',
	'textChange.test.ts',
	'modelEditOperation.test.ts',
	'modelDecorations.test.ts',
	'intervalTree.test.ts'
];

try {
	await access(resolve(root, 'out/vs/editor/test/common/model/textModel.test.js'));
} catch {
	throw new Error('Build the current client with pnpm run build-fast --client-only, then rebuild the Rust bindings');
}

await build({
	entryPoints: [resolve(root, 'test/rust/registerTextBuffer.ts')],
	outfile: output,
	bundle: true,
	platform: 'node',
	format: 'esm',
	packages: 'external',
	tsconfig: resolve(root, 'src/tsconfig.json')
});

const testArgs = [
	...tests.flatMap(file => ['--run', `src/vs/editor/test/common/model/${file}`]),
	'--run', 'src/vs/editor/test/common/services/editorWebWorker.test.ts',
	'--run', 'src/vs/editor/test/common/diff/diffComputer.test.ts',
	'--run', 'src/vs/editor/test/node/diffing/defaultLinesDiffComputer.test.ts',
	'--run', 'src/vs/editor/test/node/diffing/verifyLinesDiff.test.ts',
	'--run', 'src/vs/platform/undoRedo/test/common/undoRedoService.test.ts',
	'--run', 'src/vs/editor/contrib/folding/test/browser/indentRangeProvider.test.ts',
	'--run', 'src/vs/editor/contrib/folding/test/browser/foldingRanges.test.ts',
	'--run', 'src/vs/editor/test/common/core/lineTokens.test.ts',
	'--run', 'src/vs/editor/test/common/core/cursorColumns.test.ts',
	'--run', 'src/vs/editor/test/common/controller/cursorAtomicMoveOperations.test.ts',
	'--run', 'src/vs/base/test/common/strings.test.ts'
];
for (const engine of ['existing', 'rust']) {
	const args = engine === 'rust' ? ['--import', pathToFileURL(output).href] : [];
	const result = spawnSync(process.execPath, [
		...args,
		resolve(root, 'test/unit/node/index.js'),
		...testArgs,
		'--workers', '1'
	], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		process.stdout.write(result.stdout);
		process.stderr.write(result.stderr);
		process.exit(result.status ?? 1);
	}
	const count = /(?<count>\d+) passing/.exec(stripVTControlCharacters(result.stdout))?.groups?.count;
	console.log(`${engine}: ${count ?? 'all selected'} model, worker, diff, and folding tests passed through the canonical unit runner`);
}
