/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket-tree length arithmetic retains the original floating-point and packed-coordinate rules.

pub(crate) const FACTOR: f64 = 67_108_864.0;

/// Executes the existing scalar length operations without changing exceptional number behavior.
pub fn bracket_length(
	operation: u32,
	first: f64,
	second: f64,
	third: f64,
	fourth: f64,
) -> Option<f64> {
	Some(match operation {
		0 => first * FACTOR + second,
		1 => length_add(first, second),
		2 => length_diff(first, second),
		3 => {
			if first != third {
				(third - first) * FACTOR + fourth
			} else {
				0.0 * FACTOR + (fourth - second)
			}
		}
		4 => first - second,
		5 => f64::from(first < second),
		6 => f64::from(first <= second),
		7 => f64::from(first >= second),
		8 => f64::from(first == second),
		9 => f64::from(first == 0.0),
		10 => {
			if first > second {
				first
			} else {
				second
			}
		}
		11 => (first / FACTOR).floor(),
		_ => return None,
	})
}

/// Unpacks a coordinate using the original floor, multiplication, and subtraction order.
pub fn bracket_length_parts(length: f64) -> [f64; 2] {
	let line = (length / FACTOR).floor();
	[line, length - line * FACTOR]
}

pub(crate) fn length_add(first: f64, second: f64) -> f64 {
	let result = first + second;
	if second >= FACTOR {
		result - first % FACTOR
	} else {
		result
	}
}

pub(crate) fn length_diff(first: f64, second: f64) -> f64 {
	if second - first <= 0.0 {
		return 0.0;
	}
	let [first_line, first_column] = bracket_length_parts(first);
	let [second_line, second_column] = bracket_length_parts(second);
	if first_line == second_line {
		0.0 * FACTOR + (second_column - first_column)
	} else {
		(second_line - first_line) * FACTOR + second_column
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn lengths_keep_multiline_reset_flooring_exceptional_values_and_signed_zero() {
		assert_eq!(
			bracket_length(1, FACTOR + 7.0, FACTOR + 2.0, 0.0, 0.0),
			Some(2.0 * FACTOR + 2.0)
		);
		assert_eq!(
			bracket_length(2, FACTOR + 7.0, 3.0 * FACTOR + 2.0, 0.0, 0.0),
			Some(2.0 * FACTOR + 2.0)
		);
		assert_eq!(bracket_length_parts(-0.5), [-1.0, FACTOR - 0.5]);
		assert!(
			bracket_length(10, 1.0, f64::NAN, 0.0, 0.0)
				.unwrap()
				.is_nan()
		);
		assert!(
			bracket_length(10, 0.0, -0.0, 0.0, 0.0)
				.unwrap()
				.is_sign_negative()
		);
		assert!(
			!bracket_length(3, 0.0, 0.0, 0.0, -0.0)
				.unwrap()
				.is_sign_negative()
		);
		assert!(bracket_length_parts(f64::INFINITY)[1].is_nan());
		assert_eq!(bracket_length(99, 0.0, 0.0, 0.0, 0.0), None);
	}
}
