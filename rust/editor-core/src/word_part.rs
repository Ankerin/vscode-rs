/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Word-part traversal preserves the original ASCII case, digit, snake, and kebab boundaries.

/// Scans from the original loop's first column and returns its next word-part boundary.
/// Callers must bound every requested unit by the supplied maximum column.
pub fn word_part_column<E>(
	mut column: usize,
	max_column: usize,
	right: bool,
	mut unit: impl FnMut(usize) -> Result<u16, E>,
) -> Result<usize, E> {
	while if right {
		column < max_column
	} else {
		column > 1
	} {
		let left = unit(column - 2)?;
		let next = unit(column - 1)?;
		if [95, 45].iter().any(|&separator| {
			if right {
				left != separator && next == separator
			} else {
				left == separator && next != separator
			}
		}) || (lower_or_digit(left) && upper(next))
		{
			return Ok(column);
		}
		if upper(left) && upper(next) && column + 1 < max_column && lower_or_digit(unit(column)?) {
			return Ok(column);
		}
		if right {
			column += 1;
		} else {
			column -= 1;
		}
	}
	Ok(if right { max_column } else { 1 })
}

fn lower_or_digit(unit: u16) -> bool {
	matches!(unit, 97..=122 | 48..=57)
}

fn upper(unit: u16) -> bool {
	matches!(unit, 65..=90)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::convert::Infallible;

	#[test]
	fn traversal_keeps_separator_affinity_acronyms_and_digits() {
		let text = "thisISMixed_use-Case2Word";
		let read = |index| Ok::<_, Infallible>(u16::from(text.as_bytes()[index]));
		assert_eq!(
			[
				word_part_column(2, text.len() + 1, true, read).unwrap(),
				word_part_column(6, text.len() + 1, true, read).unwrap(),
				word_part_column(16, text.len() + 1, false, read).unwrap(),
				word_part_column(24, text.len() + 1, false, read).unwrap(),
			],
			[5, 7, 13, 22]
		);
	}

	#[test]
	fn traversal_reads_only_the_needed_adjacent_units_and_propagates_errors() {
		let mut reads = Vec::new();
		let result = word_part_column(2, 1_000_001, true, |index| {
			reads.push(index);
			Ok::<_, Infallible>(if index == 0 { 97 } else { 65 })
		})
		.unwrap();
		assert_eq!((result, reads), (2, vec![0, 1]));
		assert_eq!(
			word_part_column(2, 4, false, |_| Err::<u16, _>(37)),
			Err(37)
		);
	}
}
