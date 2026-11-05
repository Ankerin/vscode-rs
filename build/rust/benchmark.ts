/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

interface BenchmarkResult {
	engine: 'existing' | 'storage' | 'rust';
	fixture: string;
	inputUtf16Units: number;
	linesRead?: number;
	randomLineReads?: number;
	measurements: Record<string, number>;
	memory: Record<string, number>;
	checksum: number;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sequenceDiff = process.argv.includes('--diff');
const textChanges = process.argv.includes('--undo');
const modelEdits = process.argv.includes('--edits');
const benchmark = sequenceDiff ? 'sequenceDiffBenchmark' : textChanges ? 'textChangeBenchmark' : modelEdits ? 'modelEditsBenchmark' : 'textBufferBenchmark';
const output = resolve(root, `.build/rust/${benchmark}.mjs`);
await build({
	entryPoints: [resolve(root, `test/rust/${benchmark}.ts`)],
	outfile: output,
	bundle: true,
	platform: 'node',
	format: 'esm',
	packages: 'external',
	tsconfig: resolve(root, 'src/tsconfig.json')
});

const runs: BenchmarkResult[] = [];
const fixtures = sequenceDiff ? ['small', 'medium', 'large', 'unicode'] : textChanges || modelEdits ? ['typing', 'multicursor', 'fragmented', 'unicode'] : ['ascii', 'latin1', 'unicode', 'longLine'];
for (const fixture of fixtures) {
	for (let iteration = 0; iteration < 3; iteration++) {
		const engines = modelEdits ? ['existing', 'storage', 'rust'] : ['existing', 'rust'];
		for (const engine of iteration % 2 === 0 ? engines : engines.reverse()) {
			const result = spawnSync(process.execPath, [...(sequenceDiff || textChanges || modelEdits ? ['--expose-gc'] : []), output, engine, fixture], { cwd: root, encoding: 'utf8', windowsHide: true });
			if (result.error) {
				throw result.error;
			}
			if (result.status !== 0) {
				process.stderr.write(result.stderr);
				process.exit(result.status ?? 1);
			}
			runs.push(JSON.parse(result.stdout) as BenchmarkResult);
		}
	}

	if (new Set(runs.filter(run => run.fixture === fixture).map(run => run.checksum)).size !== 1) {
		throw new Error('The benchmark engines produced different results');
	}
}

function median(values: number[]): number {
	return values.sort((first, second) => first - second)[Math.floor(values.length / 2)];
}

const rows = fixtures.flatMap(fixture => Object.keys(runs[0].measurements).map(workload => {
	const existing = median(runs.filter(run => run.fixture === fixture && run.engine === 'existing').map(run => run.measurements[workload]));
	const rust = median(runs.filter(run => run.fixture === fixture && run.engine === 'rust').map(run => run.measurements[workload]));
	const storage = modelEdits ? median(runs.filter(run => run.fixture === fixture && run.engine === 'storage').map(run => run.measurements[workload])) : undefined;
	return { fixture, workload, existingMs: existing.toFixed(2), ...(storage === undefined ? {} : { storageMs: storage.toFixed(2) }), rustMs: rust.toFixed(2), rustOverExisting: (rust / existing).toFixed(2) };
}));
const resultsFile = `.build/rust/${sequenceDiff ? 'diff-benchmark' : textChanges ? 'undo-benchmark' : modelEdits ? 'edits-benchmark' : 'benchmark'}.json`;
await writeFile(resolve(root, resultsFile), JSON.stringify({ node: process.version, platform: process.platform, architecture: process.arch, runs }, null, '\t') + '\n');
console.table(rows);
console.log(`Raw runs and process memory observations: ${resultsFile}`);
