/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { DateTimeout, DiffAlgorithmResult, InfiniteTimeout } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/diffAlgorithm.js';
import { DynamicProgrammingDiffing } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/dynamicProgrammingDiffing.js';
import { MyersDiffAlgorithm } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/myersDiffAlgorithm.js';
import { registerRustSequenceDiff, tryComputeRustCharacterDiff, tryComputeRustLineDiff } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/rustSequenceDiff.js';
import { DefaultLinesDiffComputer } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js';
import { extendDiffsToEntireWordIfAppropriate, optimizeSequenceDiffs, removeShortMatches, removeVeryShortMatchingTextBetweenLongDiffs } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/heuristicSequenceOptimizations.js';
import { LinesSliceCharSequence } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/linesSliceCharSequence.js';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { RangeMapping } from '../../src/vs/editor/common/diff/rangeMapping.js';
import { IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { ArraySequence } from './testSequence.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const rust = await import(pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

function withRust<T>(compute: () => T): T {
	const registration = registerRustSequenceDiff(rust);
	try {
		return compute();
	} finally {
		registration.dispose();
	}
}

test('Rust dynamic and Myers alignment preserve seeded sequence results and numeric equality', () => {
	let seed = 42;
	const random = (limit: number) => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed % limit;
	};
	const alphabet = [0, -0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0xD800, 0xDC00];
	const algorithms = [new DynamicProgrammingDiffing(), new MyersDiffAlgorithm()];
	for (let iteration = 0; iteration < 512; iteration++) {
		const original = new ArraySequence(Array.from({ length: random(iteration % 8 === 0 ? 512 : 64) }, () => alphabet[random(alphabet.length)]));
		const modified = new ArraySequence(Array.from({ length: random(64) }, () => alphabet[random(alphabet.length)]));
		for (const algorithm of algorithms) {
			const reference = algorithm.compute(original, modified);
			assert.deepStrictEqual(withRust(() => algorithm.compute(original, modified)), reference);
		}
	}
});

test('Rust dynamic alignment preserves weighted line preference without floating-point score changes', () => {
	const algorithm = new DynamicProgrammingDiffing();
	for (const originalLines of [['', 'a', '', 'b'], [' a ', 'a', '\ta', 'a'], ['short', 'long'.repeat(512), 'short']]) {
		for (const modifiedLines of [originalLines.slice().reverse(), ['', '', 'a', ' a ', 'b'], ['short', 'short', 'long'.repeat(512)]]) {
			const hashes = new Map<string, number>();
			const hash = (text: string) => {
				const trimmed = text.trim();
				let value = hashes.get(trimmed);
				if (value === undefined) {
					value = hashes.size;
					hashes.set(trimmed, value);
				}
				return value;
			};
			const original = new ArraySequence(originalLines.map(hash));
			const modified = new ArraySequence(modifiedLines.map(hash));
			const reference = algorithm.compute(original, modified, InfiniteTimeout.instance, (first, second) => originalLines[first] === modifiedLines[second] ? modifiedLines[second].length === 0 ? 0.1 : 1 + Math.log(1 + modifiedLines[second].length) : 0.99);
			assert.deepStrictEqual(withRust(() => tryComputeRustLineDiff(original, modified, originalLines, modifiedLines, InfiniteTimeout.instance)), reference);
		}
	}
});

test('Rust alignment preserves timeout callback order, exceptions, custom scores, and registration rollback', () => {
	const original = new ArraySequence([1, 2, 1, 2]);
	const modified = new ArraySequence([2, 1, 2]);
	const failure = new Error('The timeout callback failed');
	for (const algorithm of [new DynamicProgrammingDiffing(), new MyersDiffAlgorithm()]) {
		for (const budget of [0, 1, 5, 12, 13]) {
			const compute = () => {
				let checks = 0;
				const diff = algorithm.compute(original, modified, { isValid: () => ++checks <= budget });
				return { diff, checks };
			};
			assert.deepStrictEqual(withRust(compute), compute());
		}
		assert.throws(() => withRust(() => algorithm.compute(original, modified, { isValid: () => { throw failure; } })), error => error === failure);
	}
	const algorithm = new DynamicProgrammingDiffing();
	const score = (first: number, second: number) => first + second + 0.25;
	assert.deepStrictEqual(withRust(() => algorithm.compute(original, modified, InfiniteTimeout.instance, score)), algorithm.compute(original, modified, InfiniteTimeout.instance, score));
	assert.throws(() => registerRustTextBuffer({ ...rust, sequence_diff_abi_version: () => 0 }), /algorithm contract/);
	const registration = registerRustTextBuffer(rust);
	registration.dispose();
	assert.throws(() => rust.diff_dynamic(new Float64Array([1]), new Float64Array([1]), new Uint32Array([0]), new Uint32Array([0]), new Float64Array([Number.NaN])), /scores/);
});

test('Rust Myers alignment preserves equal inputs, long sequences, and bounded-state fallback', () => {
	const algorithm = new MyersDiffAlgorithm();
	for (const elements of [[1], [1, 2], [1, 2, 3], Array.from({ length: 32768 }, (_, index) => index)]) {
		const original = new ArraySequence(elements);
		for (const modified of [original, new ArraySequence([...elements.slice(0, elements.length / 2), 0xD800, ...elements.slice(elements.length / 2)])]) {
			const compute = () => {
				let checks = 0;
				const result = algorithm.compute(original, modified, { isValid: () => { checks++; return true; } });
				return { result, checks };
			};
			assert.deepStrictEqual(withRust(compute), compute());
		}
	}
	let attempts = 0;
	const registration = registerRustSequenceDiff({ ...rust, diff_myers: () => { attempts++; return undefined; } });
	let actual: DiffAlgorithmResult;
	try {
		actual = algorithm.compute(new ArraySequence([1, 2, 3]), new ArraySequence([3, 2, 1]));
	} finally {
		registration.dispose();
	}
	assert.deepStrictEqual({ actual, attempts }, { actual: algorithm.compute(new ArraySequence([1, 2, 3]), new ArraySequence([3, 2, 1])), attempts: 1 });
});

test('Rust deadline checks preserve expiration latching and custom DateTimeout implementations', () => {
	const original = new ArraySequence([1, 2, 3]);
	const modified = new ArraySequence([3, 2, 1]);
	class CountedTimeout extends DateTimeout {
		public checks = 0;
		public override isValid(): boolean { return ++this.checks < 3; }
	}
	const algorithm = new DynamicProgrammingDiffing();
	const compute = () => {
		const timeout = new CountedTimeout(30000);
		const result = algorithm.compute(original, modified, timeout);
		return { result, checks: timeout.checks };
	};
	assert.deepStrictEqual(withRust(compute), compute());
	const timeout = new DateTimeout(30000);
	const registration = registerRustSequenceDiff({
		...rust, diff_dynamic: (...args) => {
			args[6] = Number.NEGATIVE_INFINITY;
			return rust.diff_dynamic(...args);
		}
	});
	try {
		const result = algorithm.compute(original, modified, timeout);
		assert.deepStrictEqual({ hitTimeout: result.hitTimeout, valid: timeout.isValid(), deadline: timeout.getDeadline() }, { hitTimeout: true, valid: false, deadline: Number.NEGATIVE_INFINITY });
	} finally {
		registration.dispose();
	}
	const fractional = new DateTimeout(0.000001);
	assert.ok(Number.isInteger(fractional.getDeadline()));
});

test('Rust diff optimization preserves seeded scored shifts, joins, and malformed binding behavior', () => {
	class ScoredSequence extends ArraySequence {
		public getBoundaryScore(offset: number): number { return offset % 7 === 0 ? 100 : offset % 5; }
	}
	let seed = 42;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const algorithm = new MyersDiffAlgorithm();
	for (let iteration = 0; iteration < 512; iteration++) {
		const original = new ScoredSequence(Array.from({ length: 1 + random(64) }, () => random(4)));
		const modified = new ScoredSequence(Array.from({ length: 1 + random(64) }, () => random(4)));
		const raw = algorithm.compute(original, modified).diffs;
		const reference = optimizeSequenceDiffs(original, modified, raw);
		assert.deepStrictEqual(withRust(() => optimizeSequenceDiffs(original, modified, raw)), reference);
	}
	assert.throws(() => rust.optimize_diff(new Float64Array([1]), new Float64Array([1]), new Uint32Array([0]), new Uint32Array([0]), new Float64Array(), new Float64Array(), new Uint32Array([0])), /ranges/);
	assert.strictEqual(rust.optimize_diff(new Float64Array([1]), new Float64Array([1]), new Uint32Array([0]), new Uint32Array([0]), new Float64Array(), new Float64Array(), new Uint32Array([0, 2, 0, 1])), undefined);
});

test('Rust alignment preserves full display diffs, moved lines, and raw changes for repository fixtures', async () => {
	const fixtures = resolve('src/vs/editor/test/node/diffing/fixtures');
	const computer = new DefaultLinesDiffComputer();
	for (const folder of await readdir(fixtures)) {
		const files = await readdir(resolve(fixtures, folder));
		const before = files.find(file => file.startsWith('1.'));
		const after = files.find(file => file.startsWith('2.'));
		if (!before || !after) {
			throw new Error(`Missing input files in diff fixture ${folder}`);
		}
		const lines = await Promise.all([before, after].map(async file => (await readFile(resolve(fixtures, folder, file), 'utf8')).replace(/\r\n|\r/g, '\n').split('\n')));
		for (const ignoreTrimWhitespace of [false, true]) {
			const options = { ignoreTrimWhitespace, maxComputationTimeMs: 0, computeMoves: true, extendToSubwords: true };
			const reference = computer.computeDiffWithRawChanges(lines[0], lines[1], options);
			assert.deepStrictEqual(withRust(() => computer.computeDiffWithRawChanges(lines[0], lines[1], options)), reference, folder);
		}
	}
});

function refineReference(originalLines: string[], modifiedLines: string[], range: RangeMapping, considerWhitespaceChanges: boolean, subwords: boolean, raw: boolean) {
	const original = new LinesSliceCharSequence(originalLines, range.originalRange, considerWhitespaceChanges);
	const modified = new LinesSliceCharSequence(modifiedLines, range.modifiedRange, considerWhitespaceChanges);
	const dynamic = new DynamicProgrammingDiffing();
	const myers = new MyersDiffAlgorithm();
	const result = (original.length + modified.length < 500 ? dynamic : myers).compute(original, modified);
	const toMapping = (diff: DiffAlgorithmResult['diffs'][number]) => new RangeMapping(original.translateRange(diff.seq1Range), modified.translateRange(diff.seq2Range));
	const rawChanges = raw ? myers.compute(original, modified).diffs.map(toMapping) : [];
	let diffs = optimizeSequenceDiffs(original, modified, result.diffs);
	diffs = extendDiffsToEntireWordIfAppropriate(original, modified, diffs, (sequence, offset) => sequence.findWordContaining(offset));
	if (subwords) {
		diffs = extendDiffsToEntireWordIfAppropriate(original, modified, diffs, (sequence, offset) => sequence.findSubWordContaining(offset), true);
	}
	diffs = removeShortMatches(original, modified, diffs);
	diffs = removeVeryShortMatchingTextBetweenLongDiffs(original, modified, diffs);
	return { mappings: diffs.map(toMapping), rawChanges, hitTimeout: false };
}

test('Rust owning character slices preserve seeded range translation, whitespace, words, subwords, and raw edits', () => {
	let seed = 41;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const alphabet = ['abc', 'ABC', 'fooBar', 'a1B2', 'word;', ', ', '\t', '\uFEFF', '\u2007', '\u0085', '\u180E', '\u2028', '\r', '\uD800', '\uDC00', '😀'];
	let nativeResults = 0;
	for (let iteration = 0; iteration < 1024; iteration++) {
		const create = () => Array.from({ length: 1 + random(8) }, () => Array.from({ length: random(iteration % 8 === 0 ? 48 : 12) }, () => alphabet[random(alphabet.length)]).join(''));
		const original = create();
		const modified = create();
		const rangeFor = (lines: string[]) => {
			const startLine = 1 + random(lines.length);
			const endLine = startLine + random(lines.length - startLine + 1);
			const startColumn = 1 + random(lines[startLine - 1].length + 1);
			const endColumn = startLine === endLine ? startColumn + random(lines[endLine - 1].length + 2 - startColumn) : 1 + random(lines[endLine - 1].length + 1);
			return new Range(startLine, startColumn, endLine, endColumn);
		};
		const range = new RangeMapping(rangeFor(original), rangeFor(modified));
		const considerWhitespaceChanges = iteration % 2 === 0;
		const subwords = iteration % 3 !== 0;
		const raw = iteration % 5 !== 0;
		const reference = refineReference(original, modified, range, considerWhitespaceChanges, subwords, raw);
		const result = withRust(() => tryComputeRustCharacterDiff(original, modified, range, InfiniteTimeout.instance, considerWhitespaceChanges, subwords, raw));
		if (result) {
			nativeResults++;
			assert.deepStrictEqual(result, reference, `Character slice ${iteration}`);
		}
	}
	assert.ok(nativeResults > 900, `Only ${nativeResults} slices used native refinement`);
});

test('Rust character refinement validates packed boundaries and preserves timeout and callback fallback', () => {
	const original = ['wordBefore '.repeat(20), '\tfooBar1; suffix'];
	const modified = ['wordAfter '.repeat(20), '  fooNewBar2; suffix'];
	const range = new RangeMapping(new Range(1, 1, 2, original[1].length + 1), new Range(1, 1, 2, modified[1].length + 1));
	const reference = refineReference(original, modified, range, true, true, true);
	assert.deepStrictEqual(withRust(() => tryComputeRustCharacterDiff(original, modified, range, InfiniteTimeout.instance, true, true, true)), reference);
	let checks = 0;
	assert.strictEqual(withRust(() => tryComputeRustCharacterDiff(original, modified, range, { isValid: () => { checks++; return true; } }, true, true, true)), undefined);
	assert.strictEqual(checks, 0);
	const timeout = new DateTimeout(30000);
	const registration = registerRustSequenceDiff({ ...rust, refine_diff: (...args) => { args[6] = Number.NEGATIVE_INFINITY; return rust.refine_diff(...args); } });
	try {
		const result = tryComputeRustCharacterDiff(original, modified, range, timeout, true, true, true);
		assert.deepStrictEqual({ hitTimeout: result?.hitTimeout, valid: timeout.isValid() }, { hitTimeout: true, valid: false });
	} finally {
		registration.dispose();
	}
	const settings = new Uint32Array([1, 1, 1, 2, 1, 1, 1, 2, 1, 0]);
	for (const offsets of [[1, 1], [0, 2], [0, 1, 0, 1], [0]]) {
		assert.throws(() => rust.refine_diff(new Uint16Array([97]), new Uint16Array([98]), new Uint32Array(offsets), new Uint32Array([0, 1]), settings), /ranges/);
	}
	assert.throws(() => rust.refine_diff(new Uint16Array([97]), new Uint16Array([98]), new Uint32Array([0, 1]), new Uint32Array([0, 1]), settings, () => { throw new Error('Refinement timeout failure'); }), /Refinement timeout failure/);
});
