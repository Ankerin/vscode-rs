/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Line token transforms retain UTF-16 substring behavior, duplicate boundaries, and metadata.

use crate::TokensError;

const MAX_WORDS: usize = 4 * 1024 * 1024;
const MAX_TEXT: usize = 4 * 1024 * 1024;

/// Borrowed inserted text with the original absolute UTF-16 offset and encoded metadata.
pub struct LineTokenInsertion<'a> {
	pub offset: i64,
	pub text: &'a [u16],
	pub metadata: u32,
}

/// Independent line contents and token boundaries produced by ordered insertions.
pub struct InsertedLineTokens {
	pub text: Vec<u16>,
	pub tokens: Vec<u32>,
}

/// Uses the original binary boundary preference without requiring a copied source index.
pub fn find_line_token_index(count: usize, desired: f64, end: impl Fn(usize) -> u32) -> usize {
	if count <= 1 {
		return 0;
	}
	let mut low = 0;
	let mut high = count - 1;
	while low < high {
		let middle = low + (high - low) / 2;
		let offset = f64::from(end(middle));
		if offset == desired {
			return middle + 1;
		}
		if offset < desired {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	low
}

/// Captures the same first token and fixed slice count over the current externally mutable ends.
pub fn line_token_slice(
	count: usize,
	start: f64,
	end: f64,
	end_offset: impl Fn(usize) -> u32,
) -> (usize, usize) {
	let first = find_line_token_index(count, start, &end_offset);
	let mut length = 0;
	for index in first..count {
		let start = if index == 0 { 0 } else { end_offset(index - 1) };
		if f64::from(start) >= end {
			break;
		}
		length += 1;
	}
	(first, length)
}

/// Converts source starts into ends in place, preserving metadata and typed assignment wrapping.
pub fn convert_line_token_offsets(tokens: &mut [u32], length: i64) -> Result<(), TokensError> {
	let (records, tail) = tokens.as_chunks_mut::<2>();
	if !tail.is_empty() {
		return Err(TokensError::InvalidEncoding);
	}
	for index in 0..records.len().saturating_sub(1) {
		records[index][0] = records[index + 1][0];
	}
	if let Some(last) = records.last_mut() {
		last[0] = length as u32;
	}
	Ok(())
}

/// Compares the original word slice, including equal missing words beyond both source ends.
pub fn line_tokens_equal(first: &[u32], second: &[u32], from: usize, count: usize) -> bool {
	(from..from.saturating_add(count)).all(|index| first.get(index) == second.get(index))
}

/// Extracts intersecting lengths and metadata without merging adjacent tokens.
pub fn line_tokens_in_range(
	tokens: &[u32],
	start: i64,
	end: i64,
) -> Result<Option<Vec<f64>>, TokensError> {
	let (records, tail) = tokens.as_chunks::<2>();
	if !tail.is_empty() {
		return Err(TokensError::InvalidEncoding);
	}
	if tokens.len() > MAX_WORDS || records.windows(2).any(|pair| pair[0][0] > pair[1][0]) {
		return Ok(None);
	}
	let first = find_line_token_index(records.len(), start as f64, |index| records[index][0]);
	let last = find_line_token_index(records.len(), end as f64, |index| records[index][0]);
	let mut result = Vec::new();
	if result.try_reserve_exact(tokens.len()).is_err() {
		return Ok(None);
	}
	for index in first..=last {
		let Some(&[token_end, metadata]) = records.get(index) else {
			break;
		};
		let token_start = if index == 0 { 0 } else { records[index - 1][0] };
		let length = (i64::from(token_end).min(end) - i64::from(token_start).max(start)).max(0);
		if length > 0 {
			result.extend_from_slice(&[length as f64, f64::from(metadata)]);
		}
	}
	Ok(Some(result))
}

/// Composes every source/inserted span with ECMAScript substring clamping and input-order ties.
pub fn insert_line_tokens(
	tokens: &[u32],
	text: &[u16],
	insertions: &[LineTokenInsertion<'_>],
) -> Result<Option<InsertedLineTokens>, TokensError> {
	let (records, tail) = tokens.as_chunks::<2>();
	if !tail.is_empty() {
		return Err(TokensError::InvalidEncoding);
	}
	let Some(capacity) = records
		.len()
		.checked_add(insertions.len().saturating_mul(2))
		.and_then(|count| count.checked_mul(2))
		.filter(|&count| count <= MAX_WORDS)
	else {
		return Ok(None);
	};
	if text.len() > MAX_TEXT {
		return Ok(None);
	}
	let mut result = InsertedLineTokens {
		text: Vec::new(),
		tokens: Vec::new(),
	};
	if result.tokens.try_reserve_exact(capacity).is_err() {
		return Ok(None);
	}
	let mut original = 0;
	let mut inserted = 0;
	let mut original_end = 0;
	loop {
		let source = records.get(original);
		let insertion = insertions.get(inserted);
		if let Some(&[end, metadata]) = source
			&& insertion.is_none_or(|insertion| i64::from(end) <= insertion.offset)
		{
			if !append_text(
				&mut result.text,
				substring(text, original_end, i64::from(end)),
			) {
				return Ok(None);
			}
			result
				.tokens
				.extend_from_slice(&[result.text.len() as u32, metadata]);
			original += 1;
			original_end = i64::from(end);
		} else if let Some(insertion) = insertion {
			if insertion.offset > original_end {
				if !append_text(
					&mut result.text,
					substring(text, original_end, insertion.offset),
				) {
					return Ok(None);
				}
				result.tokens.extend_from_slice(&[
					result.text.len() as u32,
					source.map_or(0, |token| token[1]),
				]);
				original_end = insertion.offset;
			}
			if !append_text(&mut result.text, insertion.text) {
				return Ok(None);
			}
			result
				.tokens
				.extend_from_slice(&[result.text.len() as u32, insertion.metadata]);
			inserted += 1;
		} else {
			break;
		}
	}
	Ok(Some(result))
}

fn substring(text: &[u16], start: i64, end: i64) -> &[u16] {
	let start = start.clamp(0, text.len() as i64) as usize;
	let end = end.clamp(0, text.len() as i64) as usize;
	&text[start.min(end)..start.max(end)]
}

fn append_text(result: &mut Vec<u16>, text: &[u16]) -> bool {
	if result.len().saturating_add(text.len()) > MAX_TEXT || result.try_reserve(text.len()).is_err()
	{
		return false;
	}
	result.extend_from_slice(text);
	true
}
