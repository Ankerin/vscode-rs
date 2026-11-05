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
import { registerRustSequenceDiff, tryComputeRustCharacterDiff, tryComputeRustDocumentDiff, tryComputeRustLineAlignment, tryComputeRustLineDiff, tryComputeRustMovedLines } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/rustSequenceDiff.js';
import { DefaultLinesDiffComputer } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js';
import { extendDiffsToEntireWordIfAppropriate, optimizeSequenceDiffs, removeShortMatches, removeVeryShortMatchingLinesBetweenDiffs, removeVeryShortMatchingTextBetweenLongDiffs } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/heuristicSequenceOptimizations.js';
import { LineSequence } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/lineSequence.js';
import { LinesSliceCharSequence } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/linesSliceCharSequence.js';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { RangeMapping } from '../../src/vs/editor/common/diff/rangeMapping.js';
import { computeMovedLines } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/computeMovedLines.js';
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
			assert.deepStrictEqual(withRust(() => tryComputeRustDocumentDiff(lines[0], lines[1], InfiniteTimeout.instance, options, true)), reference, `Native document ${folder}`);
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

function alignLinesReference(original: string[], modified: string[]) {
	const identities = new Map<string, number>();
	const hash = (line: string) => {
		const trimmed = line.trim();
		let value = identities.get(trimmed);
		if (value === undefined) { value = identities.size; identities.set(trimmed, value); }
		return value;
	};
	const originalHashes = original.map(hash);
	const modifiedHashes = modified.map(hash);
	const first = new LineSequence(originalHashes, original);
	const second = new LineSequence(modifiedHashes, modified);
	const alignment = original.length + modified.length < 1700
		? new DynamicProgrammingDiffing().compute(first, second, InfiniteTimeout.instance, (one, two) => original[one] === modified[two] ? modified[two].length === 0 ? 0.1 : 1 + Math.log(1 + modified[two].length) : 0.99)
		: new MyersDiffAlgorithm().compute(first, second);
	const diffs = removeVeryShortMatchingLinesBetweenDiffs(first, second, optimizeSequenceDiffs(first, second, alignment.diffs));
	return { diffs, hitTimeout: alignment.hitTimeout, originalHashes, modifiedHashes };
}

test('Rust line refinement preserves identity assignment, exact weights, indentation, and short matching lines', () => {
	let seed = 41;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const alphabet = ['', ' ', '\t', ' a ', 'a', '\tb', 'b', '\uFEFFc\u2007', '\u0085', '\u180E', '\uD800', '\uDC00', '😀', ' '.repeat(1024) + 'longIndent'];
	for (let iteration = 0; iteration < 512; iteration++) {
		const original = Array.from({ length: 1 + random(64) }, () => alphabet[random(alphabet.length)]);
		const modified = Array.from({ length: 1 + random(64) }, () => alphabet[random(alphabet.length)]);
		assert.deepStrictEqual(withRust(() => tryComputeRustLineAlignment(original, modified, InfiniteTimeout.instance)), alignLinesReference(original, modified), `Line refinement ${iteration}`);
	}
	for (const count of [849, 850, 1200]) {
		const original = Array.from({ length: count }, (_, index) => `line ${index}`);
		const modified = original.slice();
		modified.splice(12, 3, 'inserted one', 'inserted two');
		assert.deepStrictEqual(withRust(() => tryComputeRustLineAlignment(original, modified, InfiniteTimeout.instance)), alignLinesReference(original, modified));
	}
});

test('Rust line refinement validates weights and retains timeout latching and custom orchestration', () => {
	const original = ['one', 'two'];
	const modified = ['three', 'four'];
	let checks = 0;
	assert.strictEqual(withRust(() => tryComputeRustLineAlignment(original, modified, { isValid: () => { checks++; return true; } })), undefined);
	assert.strictEqual(checks, 0);
	const timeout = new DateTimeout(30000);
	const registration = registerRustSequenceDiff({ ...rust, diff_lines: (...args) => { args[6] = Number.NEGATIVE_INFINITY; return rust.diff_lines(...args); } });
	try {
		const result = tryComputeRustLineAlignment(original, modified, timeout);
		assert.deepStrictEqual({ hitTimeout: result?.hitTimeout, valid: timeout.isValid() }, { hitTimeout: true, valid: false });
	} finally {
		registration.dispose();
	}
	const units = new Uint16Array([97]);
	const offsets = new Uint32Array([0, 1]);
	assert.throws(() => rust.diff_lines(units, units, offsets, offsets, new Float64Array()), /scores/);
	assert.throws(() => rust.diff_lines(units, units, new Uint32Array([0, 2]), offsets, new Float64Array([1])), /ranges/);
	assert.throws(() => rust.diff_lines(units, units, offsets, offsets, new Float64Array([1]), () => { throw new Error('Line timeout failure'); }), /Line timeout failure/);
});

test('Rust move detection preserves seeded block rotations, approximate moves, and repeated triples', () => {
	let seed = 41;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const computer = new DefaultLinesDiffComputer();
	const options = { ignoreTrimWhitespace: false, maxComputationTimeMs: 0, computeMoves: false };
	const alphabet = ['first repeated line', 'second repeated line', 'third repeated line', '\uD800', '\uDC00', '\uFEFF', '\t', 'a', ''];
	for (let iteration = 0; iteration < 512; iteration++) {
		const blocks = Array.from({ length: 3 + random(6) }, (_, block) => Array.from({ length: 3 + random(6) }, (_, line) => iteration % 3 === 0 ? alphabet[line % alphabet.length] : `block ${block} line ${line} long enough`));
		const original = blocks.flat();
		const reordered = blocks.slice();
		for (let index = reordered.length - 1; index > 0; index--) {
			const other = random(index + 1);
			[reordered[index], reordered[other]] = [reordered[other], reordered[index]];
		}
		const modified = reordered.flat().map((line, index) => iteration % 2 === 0 && index % 7 === 0 ? `${line} changed` : line);
		const changes = computer.computeDiff(original, modified, options).changes.slice();
		const { originalHashes, modifiedHashes } = alignLinesReference(original, modified);
		const reference = computeMovedLines(changes, original, modified, originalHashes, modifiedHashes, InfiniteTimeout.instance);
		assert.deepStrictEqual(withRust(() => tryComputeRustMovedLines(changes, original, modified, originalHashes, modifiedHashes, InfiniteTimeout.instance)), reference, `Moved blocks ${iteration}`);
	}
});

test('Rust move detection validates packets and retains deadline latching and fallback', () => {
	const original = ['alpha line one', 'alpha line two', 'alpha line three', 'beta line one', 'beta line two', 'beta line three'];
	const modified = [...original.slice(3), ...original.slice(0, 3)];
	const changes = new DefaultLinesDiffComputer().computeDiff(original, modified, { ignoreTrimWhitespace: false, maxComputationTimeMs: 0, computeMoves: false }).changes.slice();
	const { originalHashes, modifiedHashes } = alignLinesReference(original, modified);
	const reference = computeMovedLines(changes, original, modified, originalHashes, modifiedHashes, InfiniteTimeout.instance);
	let checks = 0;
	assert.strictEqual(withRust(() => tryComputeRustMovedLines(changes, original, modified, originalHashes, modifiedHashes, { isValid: () => { checks++; return true; } })), undefined);
	assert.strictEqual(checks, 0);
	let attempts = 0;
	let registration = registerRustSequenceDiff({ ...rust, moved_lines: () => { attempts++; return undefined; } });
	try {
		assert.deepStrictEqual({ moves: computeMovedLines(changes, original, modified, originalHashes, modifiedHashes, InfiniteTimeout.instance), attempts }, { moves: reference, attempts: 1 });
	} finally {
		registration.dispose();
	}
	const timeout = new DateTimeout(30000);
	registration = registerRustSequenceDiff({ ...rust, moved_lines: (...args) => { args[6] = Number.NEGATIVE_INFINITY; return rust.moved_lines(...args); } });
	try {
		assert.deepStrictEqual({ moves: tryComputeRustMovedLines(changes, original, modified, originalHashes, modifiedHashes, timeout), valid: timeout.isValid() }, { moves: [], valid: false });
	} finally {
		registration.dispose();
	}
	const units = new Uint16Array([97]);
	const offsets = new Uint32Array([0, 1]);
	const hashes = new Uint32Array([0, 0]);
	assert.throws(() => rust.moved_lines(units, units, new Uint32Array([0, 2]), offsets, hashes, new Uint32Array()), /ranges/);
	assert.throws(() => rust.moved_lines(units, units, offsets, offsets, hashes, new Uint32Array([0])), /ranges/);
	assert.strictEqual(rust.moved_lines(units, units, offsets, offsets, new Uint32Array([0]), new Uint32Array()), undefined);
	assert.strictEqual(rust.moved_lines(units, units, offsets, offsets, hashes, new Uint32Array([0, 2, 0, 1])), undefined);
});

test('Rust complete document diffs preserve seeded whitespace, raw edits, grouping, and move refinement', () => {
	let seed = 43;
	const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	const alphabet = ['', 'alpha line one', 'beta line two', '  alpha line one\t', 'fooBar12', 'a', '\t', '\uFEFF', '\u0085', '\uD800', '\uDC00', '\uD83D\uDE00'];
	const computer = new DefaultLinesDiffComputer();
	for (let iteration = 0; iteration < 1024; iteration++) {
		const create = () => Array.from({ length: 1 + random(32) }, () => alphabet[random(alphabet.length)]);
		const original = create();
		const modified = iteration % 3 === 0 ? [...original.slice(3), ...original.slice(0, 3)].map((line, index) => index % 5 === 0 ? `${line} changed` : line) : create();
		const options = { ignoreTrimWhitespace: iteration % 2 === 0, maxComputationTimeMs: 0, computeMoves: iteration % 5 !== 0, extendToSubwords: iteration % 3 === 0 };
		const raw = iteration % 4 !== 0;
		const reference = raw ? computer.computeDiffWithRawChanges(original, modified, options) : { diff: computer.computeDiff(original, modified, options), rawChanges: [] };
		assert.deepStrictEqual(withRust(() => tryComputeRustDocumentDiff(original, modified, InfiniteTimeout.instance, options, raw)), reference, `Complete document ${iteration}`);
	}
	for (const count of [849, 850, 1200]) {
		const original = Array.from({ length: count }, (_, index) => `line ${index} long enough to move`);
		const modified = original.slice();
		modified.splice(50, 0, ...modified.splice(12, 8));
		modified[30] = '  ' + modified[30];
		const options = { ignoreTrimWhitespace: false, maxComputationTimeMs: 0, computeMoves: true, extendToSubwords: true };
		assert.deepStrictEqual(withRust(() => tryComputeRustDocumentDiff(original, modified, InfiniteTimeout.instance, options, true)), computer.computeDiffWithRawChanges(original, modified, options));
	}
});

test('Rust document computation shares one boundary and retains deadlines and unsupported-state fallback', () => {
	const original = ['alpha line one', 'alpha line two', 'alpha line three', 'beta line one', 'beta line two', 'beta line three'];
	const modified = [...original.slice(3), ...original.slice(0, 3)];
	const options = { ignoreTrimWhitespace: false, maxComputationTimeMs: 0, computeMoves: true, extendToSubwords: true };
	const computer = new DefaultLinesDiffComputer();
	const reference = computer.computeDiffWithRawChanges(original, modified, options);
	let calls = 0;
	let registration = registerRustSequenceDiff({
		...rust,
		diff_document: (...args) => { calls++; return rust.diff_document(...args); },
		diff_lines: () => { throw new Error('Unexpected separate line transfer'); },
		refine_diff: () => { throw new Error('Unexpected separate character transfer'); },
		moved_lines: () => { throw new Error('Unexpected separate move transfer'); }
	});
	try {
		assert.deepStrictEqual({ result: computer.computeDiffWithRawChanges(original, modified, options), calls }, { result: reference, calls: 1 });
	} finally {
		registration.dispose();
	}
	registration = registerRustSequenceDiff({ ...rust, diff_document: () => undefined });
	try {
		assert.deepStrictEqual(computer.computeDiffWithRawChanges(original, modified, options), reference);
	} finally {
		registration.dispose();
	}
	let checks = 0;
	assert.strictEqual(withRust(() => tryComputeRustDocumentDiff(original, modified, { isValid: () => { checks++; return true; } }, options, true)), undefined);
	assert.strictEqual(checks, 0);
	const timeout = new DateTimeout(30000);
	registration = registerRustSequenceDiff({ ...rust, diff_document: (...args) => { args[6] = Number.NEGATIVE_INFINITY; return rust.diff_document(...args); } });
	try {
		assert.deepStrictEqual({ hitTimeout: tryComputeRustDocumentDiff(original, modified, timeout, options, true)?.diff.hitTimeout, valid: timeout.isValid() }, { hitTimeout: true, valid: false });
	} finally {
		registration.dispose();
	}
	const units = new Uint16Array([97]);
	const offsets = new Uint32Array([0, 1]);
	assert.throws(() => rust.diff_document(units, units, offsets, offsets, new Float64Array([1]), 16), /ranges/);
	assert.throws(() => rust.diff_document(units, units, new Uint32Array([0, 2]), offsets, new Float64Array([1]), 0), /ranges/);
	assert.throws(() => rust.diff_document(units, new Uint16Array([98]), offsets, offsets, new Float64Array(), 0), /scores/);
});
