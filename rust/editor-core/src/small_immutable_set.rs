/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket identifier sets retain signed bitwise words, exact lengths, and lazy query reads.

use crate::ecmascript::to_uint32;

const MAX_WORDS: usize = 262_144;

/// Adds one dense key; header flags preserve unchanged-object and additional-array identities.
pub fn small_set_add<F>(word: f64, key: f64, length: usize, mut read: F) -> Option<Vec<f64>>
where
	F: FnMut(usize) -> Option<f64>,
{
	if length > MAX_WORDS {
		return None;
	}
	let key = to_uint32(key) as i32;
	let index = key >> 5;
	let bit = 1u32 << (key as u32 & 31);
	if index == 0 {
		let next = f64::from((to_uint32(word) | bit) as i32);
		return Some(vec![next, f64::from(next == word), 1.0]);
	}
	let index = usize::try_from(index - 1).ok()?;
	let count = length.max(index.checked_add(1)?);
	if count > MAX_WORDS {
		return None;
	}
	let mut result = Vec::new();
	result.try_reserve_exact(count + 3).ok()?;
	result.extend_from_slice(&[word, 0.0, 0.0]);
	for index in 0..length {
		result.push(read(index)?);
	}
	result.resize(count + 3, 0.0);
	result[index + 3] = f64::from((to_uint32(result[index + 3]) | bit) as i32);
	Some(result)
}

/// Merges signed words without trimming empty tails or changing cache selection at the host boundary.
pub fn small_set_merge<F>(
	first: f64,
	second: f64,
	first_length: usize,
	second_length: usize,
	mut read: F,
) -> Option<Vec<f64>>
where
	F: FnMut(bool, usize) -> Option<f64>,
{
	let length = first_length.max(second_length);
	if length > MAX_WORDS {
		return None;
	}
	let mut result = Vec::new();
	result.try_reserve_exact(length + 1).ok()?;
	result.push(f64::from((to_uint32(first) | to_uint32(second)) as i32));
	for index in 0..length {
		let first = if index < first_length {
			read(false, index)?
		} else {
			0.0
		};
		let second = if index < second_length {
			read(true, index)?
		} else {
			0.0
		};
		result.push(f64::from((to_uint32(first) | to_uint32(second)) as i32));
	}
	Some(result)
}

/// Runs membership, intersection, or exact equality with only the original required word reads.
pub fn small_set_query<F>(
	operation: u32,
	first: f64,
	second: f64,
	key: f64,
	first_length: usize,
	second_length: usize,
	mut read: F,
) -> Option<bool>
where
	F: FnMut(bool, i32) -> Option<f64>,
{
	if first_length.max(second_length) > MAX_WORDS {
		return None;
	}
	match operation {
		0 => {
			let key = to_uint32(key) as i32;
			let index = key >> 5;
			let word = if index == 0 {
				first
			} else {
				read(false, index - 1)?
			};
			Some(to_uint32(word) & (1u32 << (key as u32 & 31)) != 0)
		}
		1 => {
			if to_uint32(first) & to_uint32(second) != 0 {
				return Some(true);
			}
			for index in 0..first_length.min(second_length) {
				if to_uint32(read(false, index as i32)?) & to_uint32(read(true, index as i32)?) != 0
				{
					return Some(true);
				}
			}
			Some(false)
		}
		2 => {
			if first != second || first_length != second_length {
				return Some(false);
			}
			for index in 0..first_length {
				if read(false, index as i32)? != read(true, index as i32)? {
					return Some(false);
				}
			}
			Some(true)
		}
		_ => None,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn sets_keep_signed_words_high_key_copying_and_short_circuit_reads() {
		assert_eq!(
			small_set_add(0.0, 31.0, 0, |_| panic!(
				"Low keys do not read additional words"
			)),
			Some(vec![-2_147_483_648.0, 0.0, 1.0])
		);
		assert_eq!(
			small_set_add(0.0, 64.0, 0, |_| None),
			Some(vec![0.0, 0.0, 0.0, 0.0, 1.0])
		);
		assert_eq!(
			small_set_add(1.0, 4_294_967_296.0, 0, |_| None),
			Some(vec![1.0, 1.0, 1.0])
		);
		assert_eq!(
			small_set_query(1, 1.0, 1.0, 0.0, 100, 100, |_, _| panic!(
				"Low-word intersection short circuits"
			)),
			Some(true)
		);
		assert_eq!(
			small_set_query(2, f64::NAN, f64::NAN, 0.0, 0, 0, |_, _| None),
			Some(false)
		);
		assert_eq!(
			small_set_query(2, 0.0, 0.0, 0.0, 1, 2, |_, _| None),
			Some(false)
		);
		assert_eq!(
			small_set_merge(1.0, 2.0, 1, 2, |second, index| Some(if second {
				(index + 2) as f64
			} else {
				1.0
			})),
			Some(vec![3.0, 3.0, 3.0])
		);
	}
}
