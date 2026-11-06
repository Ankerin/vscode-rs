/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Shared numeric conversions retain ECMAScript bitwise and typed-array semantics.

pub(crate) fn to_uint32(value: f64) -> u32 {
	if value.is_finite() {
		value.trunc().rem_euclid(4_294_967_296.0) as u32
	} else {
		0
	}
}
