/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Backspace deletes the original emoji component or one complete UTF-16 code point.

use crate::cursor_columns::{is_emoji_imprecise, unicode_code_point};

/// Returns the original left-delete coordinate, including its approximate emoji-base rules.
/// Callers must provide a backward offset in `1..=length`.
pub fn unicode_left_delete_offset<E>(
	length: usize,
	offset: usize,
	mut unit: impl FnMut(usize) -> Result<u16, E>,
) -> Result<usize, E> {
	let (mut point, mut before) = unicode_code_point(length, offset, true, &mut unit)?;
	let single_point_offset = before;
	while matches!(point, 0x1F3FB..=0x1F3FF | 0xFE0F | 0x20E3) {
		if before == 0 {
			return Ok(single_point_offset);
		}
		(point, before) = unicode_code_point(length, before, true, &mut unit)?;
	}
	if !is_emoji_imprecise(point) {
		return Ok(single_point_offset);
	}
	if before > 0 {
		let (point, previous) = unicode_code_point(length, before, true, &mut unit)?;
		if point == 0x200D {
			return Ok(previous);
		}
	}
	Ok(before)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::convert::Infallible;

	#[test]
	fn delete_keeps_components_optional_joiners_and_isolated_modifier_fallback() {
		let run = |text: &str| {
			let units: Vec<_> = text.encode_utf16().collect();
			unicode_left_delete_offset(units.len(), units.len(), |index| {
				Ok::<_, Infallible>(units[index])
			})
			.unwrap()
		};
		assert_eq!(
			[
				run("\u{1F476}\u{1F3FE}"),
				run("\u{1F468}\u{200D}\u{1F469}\u{1F3FD}\u{200D}\u{1F467}\u{200D}\u{1F466}"),
				run("a\u{200D}\u{1F600}"),
				run("\u{1F3FB}\u{FE0F}"),
				run("1\u{FE0F}\u{20E3}"),
				run("a\u{0301}"),
			],
			[0, 10, 1, 2, 2, 1]
		);
	}

	#[test]
	fn delete_reads_only_preceding_units_and_propagates_failures() {
		let mut reads = Vec::new();
		let result = unicode_left_delete_offset(1_000_000, 500_000, |index| {
			reads.push(index);
			Ok::<_, Infallible>(97)
		})
		.unwrap();
		assert_eq!((result, reads), (499_999, vec![499_999]));
		assert_eq!(
			unicode_left_delete_offset(4, 3, |_| Err::<u16, _>(31)),
			Err(31)
		);
	}
}
