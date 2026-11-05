/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISequence } from '../../src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/diffAlgorithm.js';

/** Stable numeric elements for differential algorithm tests and benchmarks. */
export class ArraySequence implements ISequence {
	constructor(private readonly elements: readonly number[]) { }
	public get length(): number { return this.elements.length; }
	public getElement(offset: number): number { return this.elements[offset]; }
	public isStronglyEqual(first: number, second: number): boolean { return this.elements[first] === this.elements[second]; }
	public getStrongElement(offset: number): number { return this.elements[offset]; }
}
