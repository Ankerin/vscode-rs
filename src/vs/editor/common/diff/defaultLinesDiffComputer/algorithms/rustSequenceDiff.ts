/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { OffsetRange } from '../../../core/ranges/offsetRange.js';
import { LineRange } from '../../../core/ranges/lineRange.js';
import { Range } from '../../../core/range.js';
import { DetailedLineRangeMapping, LineRangeMapping, RangeMapping } from '../../rangeMapping.js';
import { ILinesDiffComputerOptions, LinesDiff, MovedText } from '../../linesDiffComputer.js';
import { DateTimeout, DiffAlgorithmResult, InfiniteTimeout, ISequence, ITimeout, SequenceDiff } from './diffAlgorithm.js';

/** Generated sequence alignment bindings, independent of the storage ABI. */
export interface IRustSequenceDiffModule {
	sequence_diff_abi_version(): number;
	diff_dynamic(original: Float64Array, modified: Float64Array, originalExact: Uint32Array, modifiedExact: Uint32Array, scores: Float64Array, timeout?: () => boolean, deadline?: number): Uint32Array;
	diff_myers(original: Float64Array, modified: Float64Array, timeout?: () => boolean, deadline?: number): Uint32Array | undefined;
	optimize_diff(original: Float64Array, modified: Float64Array, originalStrong: Uint32Array, modifiedStrong: Uint32Array, originalScores: Float64Array, modifiedScores: Float64Array, ranges: Uint32Array): Uint32Array | undefined;
	refine_diff(original: Uint16Array, modified: Uint16Array, originalOffsets: Uint32Array, modifiedOffsets: Uint32Array, settings: Uint32Array, timeout?: () => boolean, deadline?: number): Uint32Array | undefined;
	diff_lines(original: Uint16Array, modified: Uint16Array, originalOffsets: Uint32Array, modifiedOffsets: Uint32Array, equalityScores: Float64Array, timeout?: () => boolean, deadline?: number): Uint32Array | undefined;
	moved_lines(original: Uint16Array, modified: Uint16Array, originalOffsets: Uint32Array, modifiedOffsets: Uint32Array, hashes: Uint32Array, changes: Uint32Array, deadline?: number): Uint32Array | undefined;
	diff_document(original: Uint16Array, modified: Uint16Array, originalOffsets: Uint32Array, modifiedOffsets: Uint32Array, equalityScores: Float64Array, settings: number, deadline?: number): Uint32Array | undefined;
}

const maxDynamicDiffCells = 4 * 1024 * 1024;
const dateTimeoutIsValid = DateTimeout.prototype.isValid;
let registeredModule: IRustSequenceDiffModule | undefined;

/** Registers algorithms only for the lifetime of the initialized editor core. */
export function registerRustSequenceDiff(module: IRustSequenceDiffModule): IDisposable {
	if (typeof module.sequence_diff_abi_version !== 'function' || module.sequence_diff_abi_version() !== 8) {
		throw new Error('The Rust sequence diff bindings do not match the current algorithm contract');
	}
	if (registeredModule) {
		throw new Error('A Rust sequence diff module is already registered');
	}
	registeredModule = module;
	return toDisposable(() => {
		if (registeredModule === module) {
			registeredModule = undefined;
		}
	});
}

/** Shares source lines and identities across the complete native advanced diff pipeline. */
export function tryComputeRustDocumentDiff(original: string[], modified: string[], timeout: ITimeout, options: ILinesDiffComputerOptions, includeRawChanges: boolean): { diff: LinesDiff; rawChanges: RangeMapping[] } | undefined {
	if (!registeredModule || original.length === 0 || modified.length === 0) {
		return undefined;
	}
	const { check, deadline } = getTimeout(timeout);
	if (check) {
		return undefined;
	}
	const first = encodeLines(original, new Range(1, 1, original.length, original[original.length - 1].length + 1));
	const second = encodeLines(modified, new Range(1, 1, modified.length, modified[modified.length - 1].length + 1));
	if (!first || !second) {
		return undefined;
	}
	const scores = original.length + modified.length < 1700 ? Float64Array.from(modified, line => line.length === 0 ? 0.1 : 1 + Math.log(1 + line.length)) : new Float64Array();
	const settings = Number(!options.ignoreTrimWhitespace) | (Number(options.computeMoves) << 1) | (Number(!!options.extendToSubwords) << 2) | (Number(includeRawChanges) << 3);
	const values = registeredModule.diff_document(first.units, second.units, first.offsets, second.offsets, scores, settings, deadline);
	if (!values) {
		return undefined;
	}
	let offset = 4;
	const readLineMapping = () => {
		const mapping = new LineRangeMapping(new LineRange(values[offset] + 1, values[offset + 1] + 1), new LineRange(values[offset + 2] + 1, values[offset + 3] + 1));
		offset += 4;
		return mapping;
	};
	const readTextMapping = () => {
		const mapping = decodeTextMapping(values, offset);
		offset += 8;
		return mapping;
	};
	const readChanges = (count: number) => Array.from({ length: count }, () => {
		const mapping = readLineMapping();
		const innerCount = values[offset++];
		return new DetailedLineRangeMapping(mapping.original, mapping.modified, Array.from({ length: innerCount }, readTextMapping));
	});
	const changes = readChanges(values[1]);
	const moves = Array.from({ length: values[2] }, () => {
		const mapping = readLineMapping();
		const count = values[offset++];
		return new MovedText(mapping, readChanges(count));
	});
	const rawChanges = Array.from({ length: values[3] }, readTextMapping);
	const hitTimeout = values[0] === 1;
	if (hitTimeout && timeout instanceof DateTimeout) {
		timeout.invalidate();
	}
	return { diff: new LinesDiff(changes, moves, hitTimeout), rawChanges };
}

function decodeTextMapping(values: Uint32Array, offset: number): RangeMapping {
	return new RangeMapping(new Range(values[offset], values[offset + 1], values[offset + 2], values[offset + 3]), new Range(values[offset + 4], values[offset + 5], values[offset + 6], values[offset + 7]));
}

/** Runs the existing block matching and extension rules in the native line-coordinate domain. */
export function tryComputeRustMovedLines(changes: DetailedLineRangeMapping[], original: string[], modified: string[], originalHashes: number[], modifiedHashes: number[], timeout: ITimeout): LineRangeMapping[] | undefined {
	if (!registeredModule || original.length === 0 || modified.length === 0) {
		return undefined;
	}
	const { check, deadline } = getTimeout(timeout);
	if (check) {
		return undefined;
	}
	const first = encodeLines(original, new Range(1, 1, original.length, original[original.length - 1].length + 1));
	const second = encodeLines(modified, new Range(1, 1, modified.length, modified[modified.length - 1].length + 1));
	if (!first || !second) {
		return undefined;
	}
	const hashes = new Uint32Array(originalHashes.length + modifiedHashes.length);
	hashes.set(originalHashes);
	hashes.set(modifiedHashes, originalHashes.length);
	const ranges = new Uint32Array(changes.length * 4);
	for (let index = 0; index < changes.length; index++) {
		const change = changes[index];
		ranges.set([change.original.startLineNumber - 1, change.original.endLineNumberExclusive - 1, change.modified.startLineNumber - 1, change.modified.endLineNumberExclusive - 1], index * 4);
	}
	const result = registeredModule.moved_lines(first.units, second.units, first.offsets, second.offsets, hashes, ranges, deadline);
	return result ? decodeResult(result, timeout).diffs.map(diff => new LineRangeMapping(new LineRange(diff.seq1Range.start + 1, diff.seq1Range.endExclusive + 1), new LineRange(diff.seq2Range.start + 1, diff.seq2Range.endExclusive + 1))) : undefined;
}

function encodeLines(lines: string[], range: Range): { units: Uint16Array; offsets: Uint32Array } | undefined {
	const lineCount = range.endLineNumber - range.startLineNumber + 1;
	if (lineCount - 1 > maxDynamicDiffCells) {
		return undefined;
	}
	const offsets = new Uint32Array(lineCount + 1);
	for (let index = 1; index < offsets.length; index++) {
		const length = offsets[index - 1] + lines[range.startLineNumber + index - 2].length;
		if (length + offsets.length - 2 > maxDynamicDiffCells) {
			return undefined;
		}
		offsets[index] = length;
	}
	const units = new Uint16Array(offsets[offsets.length - 1]);
	for (let index = 0; index + 1 < offsets.length; index++) {
		const line = lines[range.startLineNumber + index - 1];
		for (let column = 0; column < line.length; column++) {
			units[offsets[index] + column] = line.charCodeAt(column);
		}
	}
	return { units, offsets };
}

/** Keeps slice construction, alignment, raw edits, and display refinement in one native scope. */
export function tryComputeRustCharacterDiff(originalLines: string[], modifiedLines: string[], range: RangeMapping, timeout: ITimeout, considerWhitespaceChanges: boolean, extendToSubwords: boolean, includeRawChanges: boolean): { mappings: RangeMapping[]; rawChanges: RangeMapping[]; hitTimeout: boolean } | undefined {
	if (!registeredModule) {
		return undefined;
	}
	const { check, deadline } = getTimeout(timeout);
	// Stateful/custom callbacks keep the existing pipeline, including unsupported-path fallback.
	if (check) {
		return undefined;
	}
	const first = encodeLines(originalLines, range.originalRange);
	const second = encodeLines(modifiedLines, range.modifiedRange);
	if (!first || !second) {
		return undefined;
	}
	const toRange = (range: Range) => [range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn];
	const settings = new Uint32Array([...toRange(range.originalRange), ...toRange(range.modifiedRange), Number(considerWhitespaceChanges), Number(extendToSubwords) | (Number(includeRawChanges) << 1)]);
	const result = registeredModule.refine_diff(first.units, second.units, first.offsets, second.offsets, settings, undefined, deadline);
	if (!result) {
		return undefined;
	}
	const hitTimeout = result[0] === 1;
	if (hitTimeout && timeout instanceof DateTimeout) {
		timeout.invalidate();
	}
	const mappings: RangeMapping[] = [];
	const rawChanges: RangeMapping[] = [];
	for (let index = 0; index < result[1] + result[2]; index++) {
		const offset = 3 + index * 8;
		const mapping = decodeTextMapping(result, offset);
		(index < result[1] ? mappings : rawChanges).push(mapping);
	}
	return { mappings, rawChanges, hitTimeout };
}

function toElements(sequence: ISequence): Float64Array {
	const elements = new Float64Array(sequence.length);
	for (let offset = 0; offset < elements.length; offset++) {
		elements[offset] = sequence.getElement(offset);
	}
	return elements;
}

function decodeResult(ranges: Uint32Array, timeout: ITimeout, start: number = 1): DiffAlgorithmResult {
	const diffs: SequenceDiff[] = [];
	for (let offset = start; offset < ranges.length; offset += 4) {
		diffs.push(new SequenceDiff(new OffsetRange(ranges[offset], ranges[offset + 1]), new OffsetRange(ranges[offset + 2], ranges[offset + 3])));
	}
	const hitTimeout = ranges[0] === 1;
	if (hitTimeout && timeout instanceof DateTimeout) {
		timeout.invalidate();
	}
	return new DiffAlgorithmResult(diffs, hitTimeout);
}

/** Builds line identities and performs alignment/refinement without repeated sequence transfers. */
export function tryComputeRustLineAlignment(original: string[], modified: string[], timeout: ITimeout): { diffs: SequenceDiff[]; hitTimeout: boolean; originalHashes: number[]; modifiedHashes: number[] } | undefined {
	if (!registeredModule || original.length === 0 || modified.length === 0) {
		return undefined;
	}
	const { check, deadline } = getTimeout(timeout);
	if (check) {
		return undefined;
	}
	const first = encodeLines(original, new Range(1, 1, original.length, original[original.length - 1].length + 1));
	const second = encodeLines(modified, new Range(1, 1, modified.length, modified[modified.length - 1].length + 1));
	if (!first || !second) {
		return undefined;
	}
	const scores = original.length + modified.length < 1700 ? Float64Array.from(modified, line => line.length === 0 ? 0.1 : 1 + Math.log(1 + line.length)) : new Float64Array();
	const result = registeredModule.diff_lines(first.units, second.units, first.offsets, second.offsets, scores, undefined, deadline);
	if (!result) {
		return undefined;
	}
	const hashesEnd = 3 + result[1] + result[2];
	const alignment = decodeResult(result, timeout, hashesEnd);
	return {
		diffs: alignment.diffs,
		hitTimeout: alignment.hitTimeout,
		originalHashes: Array.from(result.subarray(3, 3 + result[1])),
		modifiedHashes: Array.from(result.subarray(3 + result[1], hashesEnd))
	};
}

function getTimeout(timeout: ITimeout): { check: (() => boolean) | undefined; deadline: number | undefined } {
	if (timeout === InfiniteTimeout.instance) {
		return { check: undefined, deadline: undefined };
	}
	if (timeout instanceof DateTimeout && timeout.isValid === dateTimeoutIsValid) {
		return { check: undefined, deadline: timeout.getDeadline() };
	}
	return { check: () => timeout.isValid(), deadline: undefined };
}

function toOptimizationData(sequence: ISequence): { elements: Float64Array; strong: Uint32Array; scores: Float64Array } | undefined {
	if (!sequence.getStrongElement) {
		return undefined;
	}
	const identities = new Map<string | number, number>();
	const strong = new Uint32Array(sequence.length);
	for (let offset = 0; offset < strong.length; offset++) {
		const element = sequence.getStrongElement(offset);
		if (typeof element === 'number' && Number.isNaN(element)) {
			return undefined;
		}
		let identity = identities.get(element);
		if (identity === undefined) {
			identity = identities.size;
			identities.set(element, identity);
		}
		strong[offset] = identity;
	}
	const scores = new Float64Array(sequence.getBoundaryScore ? sequence.length + 1 : 0);
	for (let offset = 0; offset < scores.length; offset++) {
		scores[offset] = sequence.getBoundaryScore!(offset);
	}
	return { elements: toElements(sequence), strong, scores };
}

/** Ports both join passes and scored shifts while retaining custom sequence fallback. */
export function tryOptimizeRustSequenceDiffs(original: ISequence, modified: ISequence, diffs: SequenceDiff[]): SequenceDiff[] | undefined {
	if (!registeredModule || diffs.length === 0 || original.length + modified.length > maxDynamicDiffCells) {
		return undefined;
	}
	const first = toOptimizationData(original);
	const second = toOptimizationData(modified);
	if (!first || !second) {
		return undefined;
	}
	const ranges = new Uint32Array(diffs.length * 4);
	for (let index = 0; index < diffs.length; index++) {
		const diff = diffs[index];
		ranges.set([diff.seq1Range.start, diff.seq1Range.endExclusive, diff.seq2Range.start, diff.seq2Range.endExclusive], index * 4);
	}
	const result = registeredModule.optimize_diff(first.elements, second.elements, first.strong, second.strong, first.scores, second.scores, ranges);
	return result ? decodeResult(result, InfiniteTimeout.instance).diffs : undefined;
}

/** Uses native frontier/path state for large sequences, falling back at its allocation limits. */
export function tryComputeRustMyersDiff(original: ISequence, modified: ISequence, timeout: ITimeout): DiffAlgorithmResult | undefined {
	if (!registeredModule) {
		return undefined;
	}
	const { check, deadline } = getTimeout(timeout);
	const result = registeredModule.diff_myers(toElements(original), toElements(modified), check, deadline);
	return result ? decodeResult(result, timeout) : undefined;
}

/** Uses bounded native state for character alignment while retaining arbitrary score callbacks. */
export function tryComputeRustDynamicDiff(original: ISequence, modified: ISequence, timeout: ITimeout): DiffAlgorithmResult | undefined {
	if (!registeredModule || original.length * modified.length > maxDynamicDiffCells) {
		return undefined;
	}
	const { check, deadline } = getTimeout(timeout);
	return decodeResult(registeredModule.diff_dynamic(toElements(original), toElements(modified), new Uint32Array(), new Uint32Array(), new Float64Array(), check, deadline), timeout);
}

/** Preserves exact/trimmed line scoring without invoking a JavaScript score callback per cell. */
export function tryComputeRustLineDiff(original: ISequence, modified: ISequence, originalLines: string[], modifiedLines: string[], timeout: ITimeout): DiffAlgorithmResult | undefined {
	if (!registeredModule || original.length * modified.length > maxDynamicDiffCells) {
		return undefined;
	}
	const identities = new Map<string, number>();
	const getIdentity = (line: string) => {
		let identity = identities.get(line);
		if (identity === undefined) {
			identity = identities.size;
			identities.set(line, identity);
		}
		return identity;
	};
	const originalExact = Uint32Array.from(originalLines, getIdentity);
	const modifiedExact = Uint32Array.from(modifiedLines, getIdentity);
	const scores = Float64Array.from(modifiedLines, line => line.length === 0 ? 0.1 : 1 + Math.log(1 + line.length));
	const { check, deadline } = getTimeout(timeout);
	return decodeResult(registeredModule.diff_dynamic(toElements(original), toElements(modified), originalExact, modifiedExact, scores, check, deadline), timeout);
}
