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
	engine: 'existing' | 'rust';
	inputUtf16Units: number;
	measurements: Record<string, number>;
	memory: Record<string, number>;
	checksum: number;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, '.build/rust/textBufferBenchmark.mjs');
await build({
	entryPoints: [resolve(root, 'test/rust/textBufferBenchmark.ts')],
	outfile: output,
	bundle: true,
	platform: 'node',
	format: 'esm',
	packages: 'external',
	tsconfig: resolve(root, 'src/tsconfig.json')
});

const runs: BenchmarkResult[] = [];
for (let iteration = 0; iteration < 3; iteration++) {
	for (const engine of iteration % 2 === 0 ? ['existing', 'rust'] : ['rust', 'existing']) {
		const result = spawnSync(process.execPath, [output, engine], { cwd: root, encoding: 'utf8', windowsHide: true });
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

if (new Set(runs.map(run => run.checksum)).size !== 1) {
	throw new Error('The benchmark engines produced different results');
}

function median(values: number[]): number {
	return values.sort((first, second) => first - second)[Math.floor(values.length / 2)];
}

const rows = Object.keys(runs[0].measurements).map(workload => {
	const existing = median(runs.filter(run => run.engine === 'existing').map(run => run.measurements[workload]));
	const rust = median(runs.filter(run => run.engine === 'rust').map(run => run.measurements[workload]));
	return { workload, existingMs: existing.toFixed(2), rustMs: rust.toFixed(2), rustOverExisting: (rust / existing).toFixed(2) };
});
await writeFile(resolve(root, '.build/rust/benchmark.json'), JSON.stringify({ node: process.version, platform: process.platform, architecture: process.arch, runs }, null, '\t') + '\n');
console.table(rows);
console.log('Raw runs and process memory observations: .build/rust/benchmark.json');
