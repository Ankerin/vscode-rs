/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Primitive values cannot introduce a native ownership cycle through a host facade. */
export type BracketScalarValue = number | boolean | string | bigint | null | undefined;

/** Object/function/symbol values use host anchors addressed by native property handles. */
export type BracketPropertyValue = BracketScalarValue | object | symbol;

/** Native scalar/array records expose primitive data and the original property attributes. */
export interface IBracketNumberProperties {
	get(index: number): BracketPropertyValue;
	attributes(index: number): number;
}

/** Symbols remain on the host because they can be weak collection keys, just like objects. */
export function isBracketScalarValue(value: unknown): value is BracketScalarValue {
	return value === null || (typeof value !== 'object' && typeof value !== 'function' && typeof value !== 'symbol');
}

/** Reconstructs one configurable scalar descriptor without retaining a host backing value. */
export function bracketNumberDescriptor(record: IBracketNumberProperties, index: number): PropertyDescriptor {
	const attributes = record.attributes(index);
	return { value: record.get(index), writable: !!(attributes & 1), enumerable: !!(attributes & 2), configurable: true };
}

/** Lets ECMAScript validate and merge data/accessor attributes without invoking property values. */
export function mergeBracketNumberDescriptor(key: string | symbol, current: PropertyDescriptor | undefined, descriptor: PropertyDescriptor): PropertyDescriptor | undefined {
	const property = Object.create(null) as object;
	if (current) {
		Reflect.defineProperty(property, key, current);
	}
	return Reflect.defineProperty(property, key, descriptor) ? Reflect.getOwnPropertyDescriptor(property, key) : undefined;
}
