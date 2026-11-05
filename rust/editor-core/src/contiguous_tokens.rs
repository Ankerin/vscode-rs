/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Contiguous token editing keeps mutable input aliases and original token-boundary affinity.

use crate::TokensError;

/// Distinguishes the shared empty-line sentinel from a newly allocated empty encoding.
#[derive(Debug, PartialEq, Eq)]
pub enum ContiguousTokensUpdate {
	EmptyLine,
	Words(usize),
}

/// Deletes a UTF-16 character range and returns the surviving prefix length without trimming input.
pub fn delete_contiguous_tokens(
	tokens: &mut [u32],
	from: i64,
	to: i64,
) -> Result<ContiguousTokensUpdate, TokensError> {
	if from < 0 || to < from || to > 1 << 40 {
		return Err(TokensError::InvalidEncoding);
	}
	let (tokens, tail) = tokens.as_chunks_mut::<2>();
	if !tail.is_empty() || tokens.is_empty() {
		return Err(TokensError::InvalidEncoding);
	}
	if from == to {
		return Ok(ContiguousTokensUpdate::Words(tokens.len() * 2));
	}
	if from == 0 && i64::from(tokens[tokens.len() - 1][0]) == to {
		return Ok(ContiguousTokensUpdate::EmptyLine);
	}
	let index = find_index(tokens, from);
	let start = if index == 0 {
		0
	} else {
		i64::from(tokens[index - 1][0])
	};
	let end = i64::from(tokens[index][0]);
	let delta = to - from;
	if to < end {
		for token in &mut tokens[index..] {
			token[0] = (i64::from(token[0]) - delta) as u32;
		}
		return Ok(ContiguousTokensUpdate::Words(tokens.len() * 2));
	}
	let (mut destination, mut last_end) = if start != from {
		tokens[index][0] = from as u32;
		(index + 1, from)
	} else {
		(index, start)
	};
	for source in index + 1..tokens.len() {
		let [end, metadata] = tokens[source];
		let end = i64::from(end) - delta;
		if end > last_end {
			tokens[destination] = [end as u32, metadata];
			destination += 1;
			last_end = end;
		}
	}
	Ok(ContiguousTokensUpdate::Words(destination * 2))
}

/// Insertion at a token boundary extends the previous token, including the final end offset.
pub fn insert_contiguous_tokens(
	tokens: &mut [u32],
	character: i64,
	length: i64,
) -> Result<ContiguousTokensUpdate, TokensError> {
	if !(0..=1 << 40).contains(&character) || !(0..=1 << 40).contains(&length) {
		return Err(TokensError::InvalidEncoding);
	}
	let (tokens, tail) = tokens.as_chunks_mut::<2>();
	if !tail.is_empty() || tokens.is_empty() {
		return Err(TokensError::InvalidEncoding);
	}
	let mut index = find_index(tokens, character);
	if index > 0 && i64::from(tokens[index - 1][0]) == character {
		index -= 1;
	}
	for token in &mut tokens[index..] {
		token[0] = (i64::from(token[0]) + length) as u32;
	}
	Ok(ContiguousTokensUpdate::Words(tokens.len() * 2))
}

/// Concatenates independent lines without mutating either source or coalescing metadata.
pub fn append_contiguous_tokens(
	first: &[u32],
	second: &[u32],
) -> Result<Option<Vec<u32>>, TokensError> {
	let (first_records, first_tail) = first.as_chunks::<2>();
	let (second_records, second_tail) = second.as_chunks::<2>();
	if !first_tail.is_empty() || !second_tail.is_empty() {
		return Err(TokensError::InvalidEncoding);
	}
	let Some(last) = first_records.last() else {
		return Ok(None);
	};
	let Some(capacity) = first
		.len()
		.checked_add(second.len())
		.filter(|&len| len <= 4 * 1024 * 1024)
	else {
		return Ok(None);
	};
	let mut result = Vec::new();
	if result.try_reserve_exact(capacity).is_err() {
		return Ok(None);
	}
	result.extend_from_slice(first);
	for &[end, metadata] in second_records {
		result.extend_from_slice(&[end.wrapping_add(last[0]), metadata]);
	}
	Ok(Some(result))
}

fn find_index(tokens: &[[u32; 2]], desired: i64) -> usize {
	let mut low = 0;
	let mut high = tokens.len() - 1;
	while low < high {
		let mid = low + (high - low) / 2;
		let end = i64::from(tokens[mid][0]);
		if end == desired {
			return mid + 1;
		}
		if end < desired {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	low
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn deletion_preserves_mutated_suffix_and_distinguishes_empty_sentinel() {
		let mut tokens = [3, 7, 6, 9, 9, 11];
		assert_eq!(
			delete_contiguous_tokens(&mut tokens, 2, 7).unwrap(),
			ContiguousTokensUpdate::Words(4)
		);
		assert_eq!(tokens, [2, 7, 4, 11, 9, 11]);
		assert_eq!(
			delete_contiguous_tokens(&mut tokens[..4], 0, 4).unwrap(),
			ContiguousTokensUpdate::EmptyLine
		);
		assert_eq!(tokens, [2, 7, 4, 11, 9, 11]);
	}

	#[test]
	fn insertion_and_append_keep_boundary_affinity_and_wrapping() {
		let mut tokens = [3, 7, 6, 9];
		assert_eq!(
			insert_contiguous_tokens(&mut tokens, 3, 2).unwrap(),
			ContiguousTokensUpdate::Words(4)
		);
		assert_eq!(tokens, [5, 7, 8, 9]);
		assert_eq!(
			append_contiguous_tokens(&[u32::MAX, 7], &[2, 9]).unwrap(),
			Some(vec![u32::MAX, 7, 1, 9])
		);
	}
}
