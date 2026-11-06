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

/** Native scalar/reference records share a collector-visible anchor protocol. */
export interface IBracketNativeProperties {
	get(index: number): BracketScalarValue;
	attributes(index: number): number;
	define(index: number, value: BracketScalarValue, writable: boolean, enumerable: boolean): void;
	reference(index: number): number | undefined;
	define_reference(index: number, reference: number, writable: boolean, enumerable: boolean): void;
	remove(index: number): void;
}

/** Descriptor access retains exact host identities and releases obsolete reference anchors. */
export interface IBracketPropertyAccess extends IBracketNumberProperties {
	define(index: number, descriptor: PropertyDescriptor): void;
	remove(index: number): void;
	truncateReferences(length: number): void;
	clearReferences(): void;
}

/** Keeps native handles independent of JavaScript graph roots, including cyclic facade references. */
export function createBracketPropertyAccess(record: IBracketNativeProperties): IBracketPropertyAccess {
	const references = new Map<number, object | symbol>();
	return {
		get: index => {
			const reference = record.reference(index);
			return reference === undefined ? record.get(index) : references.get(reference);
		},
		attributes: index => record.attributes(index),
		define: (index, descriptor) => {
			if (isBracketScalarValue(descriptor.value)) {
				record.define(index, descriptor.value, !!descriptor.writable, !!descriptor.enumerable);
				references.delete(index);
			} else {
				record.define_reference(index, index, !!descriptor.writable, !!descriptor.enumerable);
				references.set(index, descriptor.value as object | symbol);
			}
		},
		remove: index => { record.remove(index); references.delete(index); },
		truncateReferences: length => { for (const index of references.keys()) { if (index >= length) { references.delete(index); } } },
		clearReferences: () => references.clear()
	};
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
