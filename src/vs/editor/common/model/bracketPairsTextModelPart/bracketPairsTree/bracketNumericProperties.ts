/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Native scalar/array records expose numeric data and the original property attributes. */
export interface IBracketNumberProperties {
	get(index: number): number;
	attributes(index: number): number;
}

/** Reconstructs one configurable numeric descriptor without retaining a host backing value. */
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
