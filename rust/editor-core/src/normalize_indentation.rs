/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Leading indentation normalization preserves the original numeric tab and repeat rules.

use crate::next_cursor_tab_stop;

/// The replacement whitespace and the start of the unchanged original UTF-16 suffix.
pub struct NormalizedIndentation {
	pub prefix_length: usize,
	pub whitespace: String,
}

/// Borrows only the initial whitespace, preserving fractional and exceptional numeric sizes.
pub fn normalize_indentation<E>(
	length: usize,
	indent_size: f64,
	insert_spaces: bool,
	mut unit: impl FnMut(usize) -> Result<u16, E>,
) -> Result<Option<NormalizedIndentation>, E> {
	let mut prefix = 0;
	let mut spaces = 0.0;
	while prefix < length {
		spaces = match unit(prefix)? {
			9 => next_cursor_tab_stop(spaces, indent_size),
			32 => spaces + 1.0,
			_ => break,
		};
		prefix += 1;
	}
	let tabs = if insert_spaces {
		0.0
	} else {
		let tabs = (spaces / indent_size).floor();
		spaces %= indent_size;
		tabs
	};
	let Some(tabs) = repeat_count(tabs) else {
		return Ok(None);
	};
	let Some(spaces) = repeat_count(spaces) else {
		return Ok(None);
	};
	if tabs + spaces > 4 * 1024 * 1024 {
		return Ok(None);
	}
	let mut whitespace = String::new();
	if whitespace.try_reserve_exact(tabs + spaces).is_err() {
		return Ok(None);
	}
	whitespace.extend(std::iter::repeat_n('\t', tabs));
	whitespace.extend(std::iter::repeat_n(' ', spaces));
	Ok(Some(NormalizedIndentation {
		prefix_length: prefix,
		whitespace,
	}))
}

fn repeat_count(value: f64) -> Option<usize> {
	if value.is_nan() || value <= 0.0 {
		Some(0)
	} else if value <= (4 * 1024 * 1024) as f64 {
		Some(value.ceil() as usize)
	} else {
		None
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::convert::Infallible;

	#[test]
	fn normalization_keeps_prefix_only_reads_fractional_repeats_and_numeric_fallback() {
		let run = |size, insert_spaces| {
			let text = [32, 9, 32, 0xD800, 97];
			let result = normalize_indentation(text.len(), size, insert_spaces, |index| {
				Ok::<_, Infallible>(text[index])
			})
			.unwrap()
			.unwrap();
			(result.prefix_length, result.whitespace)
		};
		assert_eq!(
			[
				run(4.0, false),
				run(1.5, false),
				run(f64::NAN, false),
				run(-2.0, true)
			],
			[
				(3, "\t ".into()),
				(3, "\t ".into()),
				(3, "".into()),
				(3, "".into())
			]
		);
		let mut reads = Vec::new();
		let result = normalize_indentation(1_000_000, 4.0, true, |index| {
			reads.push(index);
			Ok::<_, Infallible>(97)
		})
		.unwrap()
		.unwrap();
		assert_eq!(
			(result.prefix_length, result.whitespace, reads),
			(0, "".into(), vec![0])
		);
		assert!(
			normalize_indentation(1, f64::INFINITY, true, |_| Ok::<_, Infallible>(9))
				.unwrap()
				.is_none()
		);
		assert!(matches!(
			normalize_indentation(1, 4.0, true, |_| Err::<u16, _>(41)),
			Err(41)
		));
	}
}
