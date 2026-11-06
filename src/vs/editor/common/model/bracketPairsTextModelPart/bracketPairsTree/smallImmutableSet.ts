/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { canTrackRustSmallSetSlice, trackRustSmallSet, trackRustSmallSetItems, tryAddRustSmallSet, tryMergeRustSmallSet, tryQueryRustSmallSet } from './rustSmallImmutableSet.js';

const emptyArr: number[] = [];
trackRustSmallSetItems(emptyArr);

/**
 * Represents an immutable set that works best for a small number of elements (less than 32).
 * It uses bits to encode element membership efficiently.
*/
export class SmallImmutableSet<T> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private static cache = new Array<SmallImmutableSet<any>>(129);

	private static create<T>(items: number, additionalItems: readonly number[]): SmallImmutableSet<T> {
		if (items <= 128 && additionalItems.length === 0) {
			// We create a cache of 128=2^7 elements to cover all sets with up to 7 (dense) elements.
			let cached = SmallImmutableSet.cache[items];
			if (!cached) {
				cached = new SmallImmutableSet(items, additionalItems);
				SmallImmutableSet.cache[items] = cached;
			}
			return cached;
		}

		return new SmallImmutableSet(items, additionalItems);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private static empty = SmallImmutableSet.create<any>(0, emptyArr);
	public static getEmpty<T>(): SmallImmutableSet<T> {
		return this.empty;
	}

	private constructor(
		private readonly items: number,
		private readonly additionalItems: readonly number[]
	) {
		if (new.target === SmallImmutableSet) { trackRustSmallSet(this); }
	}

	public add(value: T, keyProvider: IDenseKeyProvider<T>): SmallImmutableSet<T> {
		const key = keyProvider.getKey(value);
		const native = tryAddRustSmallSet(this, key);
		if (native !== undefined) {
			if (native[1] === 1) { return this; }
			if (native[2] === 1) { return SmallImmutableSet.create(native[0], this.additionalItems); }
			const newItems: number[] = [];
			for (let index = 3; index < native.length; index++) { newItems.push(native[index]); }
			trackRustSmallSetItems(newItems);
			return SmallImmutableSet.create(native[0], newItems);
		}
		let idx = key >> 5; // divided by 32
		if (idx === 0) {
			// fast path
			const newItem = (1 << key) | this.items;
			if (newItem === this.items) {
				return this;
			}
			return SmallImmutableSet.create(newItem, this.additionalItems);
		}
		idx--;

		const additionalItems = this.additionalItems;
		const standardSlice = canTrackRustSmallSetSlice(additionalItems);
		const newItems = additionalItems.slice(0);
		while (newItems.length < idx) {
			newItems.push(0);
		}
		newItems[idx] |= 1 << (key & 31);
		if (standardSlice) { trackRustSmallSetItems(newItems); }

		return SmallImmutableSet.create(this.items, newItems);
	}

	public has(value: T, keyProvider: IDenseKeyProvider<T>): boolean {
		const key = keyProvider.getKey(value);
		const native = tryQueryRustSmallSet(this, undefined, key, 0);
		if (native !== undefined) { return native; }
		let idx = key >> 5; // divided by 32
		if (idx === 0) {
			// fast path
			return (this.items & (1 << key)) !== 0;
		}
		idx--;

		return ((this.additionalItems[idx] || 0) & (1 << (key & 31))) !== 0;
	}

	public merge(other: SmallImmutableSet<T>): SmallImmutableSet<T> {
		const native = tryMergeRustSmallSet(this, other);
		if (native !== undefined) {
			const merged = native[0];
			if (this.additionalItems === emptyArr && other.additionalItems === emptyArr) {
				if (merged === this.items) { return this; }
				if (merged === other.items) { return other; }
				return SmallImmutableSet.create(merged, emptyArr);
			}
			const newItems: number[] = [];
			for (let index = 1; index < native.length; index++) { newItems.push(native[index]); }
			trackRustSmallSetItems(newItems);
			return SmallImmutableSet.create(merged, newItems);
		}
		const merged = this.items | other.items;

		if (this.additionalItems === emptyArr && other.additionalItems === emptyArr) {
			// fast path
			if (merged === this.items) {
				return this;
			}
			if (merged === other.items) {
				return other;
			}
			return SmallImmutableSet.create(merged, emptyArr);
		}

		// This can be optimized, but it's not a common case
		const newItems: number[] = [];
		for (let i = 0; i < Math.max(this.additionalItems.length, other.additionalItems.length); i++) {
			const item1 = this.additionalItems[i] || 0;
			const item2 = other.additionalItems[i] || 0;
			newItems.push(item1 | item2);
		}

		trackRustSmallSetItems(newItems);
		return SmallImmutableSet.create(merged, newItems);
	}

	public intersects(other: SmallImmutableSet<T>): boolean {
		const native = tryQueryRustSmallSet(this, other, 0, 1);
		if (native !== undefined) { return native; }
		if ((this.items & other.items) !== 0) {
			return true;
		}

		for (let i = 0; i < Math.min(this.additionalItems.length, other.additionalItems.length); i++) {
			if ((this.additionalItems[i] & other.additionalItems[i]) !== 0) {
				return true;
			}
		}

		return false;
	}

	public equals(other: SmallImmutableSet<T>): boolean {
		const native = tryQueryRustSmallSet(this, other, 0, 2);
		if (native !== undefined) { return native; }
		if (this.items !== other.items) {
			return false;
		}

		if (this.additionalItems.length !== other.additionalItems.length) {
			return false;
		}

		for (let i = 0; i < this.additionalItems.length; i++) {
			if (this.additionalItems[i] !== other.additionalItems[i]) {
				return false;
			}
		}

		return true;
	}
}

export interface IDenseKeyProvider<T> {
	getKey(value: T): number;
}

export const identityKeyProvider: IDenseKeyProvider<number> = {
	getKey(value: number) {
		return value;
	}
};

/**
 * Assigns values a unique incrementing key.
*/
export class DenseKeyProvider<T> {
	private readonly items = new Map<T, number>();

	getKey(value: T): number {
		let existing = this.items.get(value);
		if (existing === undefined) {
			existing = this.items.size;
			this.items.set(value, existing);
		}
		return existing;
	}

	reverseLookup(value: number): T | undefined {
		return [...this.items].find(([_key, v]) => v === value)?.[0];
	}

	reverseLookupSet(set: SmallImmutableSet<T>): T[] {
		const result: T[] = [];
		for (const [key] of this.items) {
			if (set.has(key, this)) {
				result.push(key);
			}
		}
		return result;
	}

	keys(): IterableIterator<T> {
		return this.items.keys();
	}
}
