/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Semantic token overlays over the existing contiguous token metadata encoding.

use std::{error::Error, fmt};

const MAX_TOKEN_WORDS: usize = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
/// Rejects malformed metadata records before reading their fields.
pub enum TokensError {
	InvalidEncoding,
}

impl fmt::Display for TokensError {
	fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
		formatter.write_str("The encoded tokens do not match the editor contract")
	}
}

impl Error for TokensError {}

/// Combines syntax and semantic token presentation, preserving clamping and emitted boundaries.
/// Source views are read-only and all temporary/result allocation belongs to the call.
pub fn merge_semantic_tokens(
	contiguous: &[u32],
	sparse: &[u32],
	text_length: u32,
) -> Result<Option<Vec<u32>>, TokensError> {
	let (contiguous, contiguous_tail) = contiguous.as_chunks::<2>();
	let (sparse, sparse_tail) = sparse.as_chunks::<4>();
	if !contiguous_tail.is_empty() || !sparse_tail.is_empty() {
		return Err(TokensError::InvalidEncoding);
	}
	if contiguous.is_empty()
		|| contiguous.last().map(|token| token[0]) != Some(text_length)
		|| contiguous
			.windows(2)
			.any(|tokens| tokens[0][0] > tokens[1][0])
	{
		return Ok(None);
	}
	let Some(capacity) = contiguous
		.len()
		.checked_add(sparse.len().saturating_mul(2))
		.and_then(|length| length.checked_mul(2))
		.filter(|&length| length <= MAX_TOKEN_WORDS)
	else {
		return Ok(None);
	};
	let mut result = Vec::new();
	if result.try_reserve_exact(capacity).is_err() {
		return Ok(None);
	}
	let mut last_end = 0;
	let mut index = 0;
	for token in sparse {
		let start = token[1].min(text_length);
		let end = token[2].min(text_length);
		let metadata = token[3];
		let semantic_mask = semantic_mask(metadata);
		let syntax_mask = !semantic_mask;
		while index < contiguous.len() && contiguous[index][0] <= start {
			emit(
				&mut result,
				&mut last_end,
				contiguous[index][0],
				contiguous[index][1],
			);
			index += 1;
		}
		if index < contiguous.len()
			&& (if index == 0 {
				0
			} else {
				contiguous[index - 1][0]
			}) < start
		{
			emit(&mut result, &mut last_end, start, contiguous[index][1]);
		}
		while index < contiguous.len() && contiguous[index][0] < end {
			emit(
				&mut result,
				&mut last_end,
				contiguous[index][0],
				(contiguous[index][1] & syntax_mask) | (metadata & semantic_mask),
			);
			index += 1;
		}
		if index < contiguous.len() {
			emit(
				&mut result,
				&mut last_end,
				end,
				(contiguous[index][1] & syntax_mask) | (metadata & semantic_mask),
			);
			if contiguous[index][0] == end {
				index += 1;
			}
		} else {
			let previous = index.saturating_sub(1).min(contiguous.len() - 1);
			emit(
				&mut result,
				&mut last_end,
				end,
				(contiguous[previous][1] & syntax_mask) | (metadata & semantic_mask),
			);
		}
	}
	for token in &contiguous[index..] {
		emit(&mut result, &mut last_end, token[0], token[1]);
	}
	Ok(Some(result))
}

fn semantic_mask(metadata: u32) -> u32 {
	let mut mask = 0;
	for (flag, field) in [
		(1, 0x800),
		(2, 0x1000),
		(4, 0x2000),
		(8, 0x4000),
		(16, 0xFF_8000),
		(32, 0xFF00_0000),
	] {
		if metadata & flag != 0 {
			mask |= field;
		}
	}
	mask
}

fn emit(result: &mut Vec<u32>, last_end: &mut u32, end: u32, metadata: u32) {
	if end > *last_end {
		*last_end = end;
		result.extend_from_slice(&[end, metadata]);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn overlays_preserve_language_bits_and_clamp_invalid_semantic_ranges() {
		let syntax = [3, 0x0200_8007, 8, 0x0200_8009];
		let semantic = [0, 1, 5, 0x0028_0010, 0, 6, 100, 0x0000_0801];
		assert_eq!(
			merge_semantic_tokens(&syntax, &semantic, 8).unwrap(),
			Some(vec![
				1,
				0x0200_8007,
				3,
				0x0228_0007,
				5,
				0x0228_0009,
				6,
				0x0200_8009,
				8,
				0x0200_8809
			])
		);
		assert_eq!(syntax, [3, 0x0200_8007, 8, 0x0200_8009]);
	}

	#[test]
	fn malformed_shapes_and_contiguous_endpoints_are_rejected() {
		for (syntax, semantic, length) in [
			(&[1][..], &[][..], 1),
			(&[1, 0][..], &[0][..], 1),
			(&[3, 0, 1, 0][..], &[][..], 1),
			(&[3, 0][..], &[][..], 4),
		] {
			let expected = if syntax.len() % 2 != 0 || semantic.len() % 4 != 0 {
				Err(TokensError::InvalidEncoding)
			} else {
				Ok(None)
			};
			assert_eq!(merge_semantic_tokens(syntax, semantic, length), expected);
		}
	}
}
