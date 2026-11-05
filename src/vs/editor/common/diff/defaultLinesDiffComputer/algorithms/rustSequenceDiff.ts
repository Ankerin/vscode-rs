/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { OffsetRange } from '../../../core/ranges/offsetRange.js';
import { DateTimeout, DiffAlgorithmResult, InfiniteTimeout, ISequence, ITimeout, SequenceDiff } from './diffAlgorithm.js';

/** Generated sequence alignment bindings, independent of the storage ABI. */
export interface IRustSequenceDiffModule {
	sequence_diff_abi_version(): number;
	diff_dynamic(original: Float64Array, modified: Float64Array, originalExact: Uint32Array, modifiedExact: Uint32Array, scores: Float64Array, timeout?: () => boolean, deadline?: number): Uint32Array;
	diff_myers(original: Float64Array, modified: Float64Array, timeout?: () => boolean, deadline?: number): Uint32Array | undefined;
	optimize_diff(original: Float64Array, modified: Float64Array, originalStrong: Uint32Array, modifiedStrong: Uint32Array, originalScores: Float64Array, modifiedScores: Float64Array, ranges: Uint32Array): Uint32Array | undefined;
}

const maxDynamicDiffCells = 4 * 1024 * 1024;
const dateTimeoutIsValid = DateTimeout.prototype.isValid;
let registeredModule: IRustSequenceDiffModule | undefined;

/** Registers algorithms only for the lifetime of the initialized editor core. */
export function registerRustSequenceDiff(module: IRustSequenceDiffModule): IDisposable {
	if (typeof module.sequence_diff_abi_version !== 'function' || module.sequence_diff_abi_version() !== 4) {
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

function toElements(sequence: ISequence): Float64Array {
	const elements = new Float64Array(sequence.length);
	for (let offset = 0; offset < elements.length; offset++) {
		elements[offset] = sequence.getElement(offset);
	}
	return elements;
}

function decodeResult(ranges: Uint32Array, timeout: ITimeout): DiffAlgorithmResult {
	const diffs: SequenceDiff[] = [];
	for (let offset = 1; offset < ranges.length; offset += 4) {
		diffs.push(new SequenceDiff(new OffsetRange(ranges[offset], ranges[offset + 1]), new OffsetRange(ranges[offset + 2], ranges[offset + 3])));
	}
	const hitTimeout = ranges[0] === 1;
	if (hitTimeout && timeout instanceof DateTimeout) {
		timeout.invalidate();
	}
	return new DiffAlgorithmResult(diffs, hitTimeout);
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
