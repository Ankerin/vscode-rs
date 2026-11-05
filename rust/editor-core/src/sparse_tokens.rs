/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Sparse token edits preserve the existing mutable record views and inactive suffixes.

use crate::TokensError;

/// Absolute UTF-16 edit coordinates and the inserted text's existing line summary.
pub struct SparseTokenEdit {
	pub block_start: i64,
	pub start_line: i64,
	pub start_column: i64,
	pub end_line: i64,
	pub end_column: i64,
	pub eol_count: i64,
	pub first_line_length: i64,
	pub last_line_length: i64,
	pub first_char_code: i64,
}

/// Active records and the adjusted absolute block start (or removal's first-line delta).
#[derive(Debug, PartialEq, Eq)]
pub struct SparseTokensUpdate {
	pub count: usize,
	pub start_line: i64,
}

/// Selects the original duplicate-line span using live records and the existing binary-search bounds.
pub fn find_sparse_line_tokens(
	count: usize,
	desired: f64,
	line: impl Fn(usize) -> Option<u32>,
) -> Option<(usize, usize)> {
	let mut low = 0;
	let mut high = count as i64 - 1;
	while (low as i64) < high {
		let middle = low + (high as usize - low) / 2;
		let middle_line = f64::from(line(middle)?);
		if middle_line < desired {
			low = middle + 1;
		} else if middle_line > desired {
			high = middle as i64 - 1;
		} else {
			let mut first = middle;
			while first > low && line(first - 1).is_some_and(|value| f64::from(value) == desired) {
				first -= 1;
			}
			let mut last = middle;
			while (last as i64) < high
				&& line(last + 1).is_some_and(|value| f64::from(value) == desired)
			{
				last += 1;
			}
			return Some((first, last + 1));
		}
	}
	line(low)
		.filter(|&value| f64::from(value) == desired)
		.map(|_| (low, low + 1))
}

/// Removes touching tokens in place, preserving the original inactive record suffix.
pub fn remove_sparse_tokens(
	tokens: &mut [u32],
	start_line: i64,
	start_char: i64,
	end_line: i64,
	end_char: i64,
) -> Result<SparseTokensUpdate, TokensError> {
	let (tokens, tail) = tokens.as_chunks_mut::<4>();
	if !tail.is_empty() {
		return Err(TokensError::InvalidEncoding);
	}
	let mut count = 0;
	let mut deleted = false;
	let mut first_line = 0;
	for index in 0..tokens.len() {
		let [line, start, end, metadata] = tokens[index];
		if touches(line, start, end, start_line, start_char, end_line, end_char) {
			deleted = true;
			continue;
		}
		if count == 0 {
			first_line = line;
		}
		if deleted {
			tokens[count] = [line.wrapping_sub(first_line), start, end, metadata];
		} else if first_line != 0 {
			tokens[index][0] = line.wrapping_sub(first_line);
		}
		count += 1;
	}
	Ok(SparseTokensUpdate {
		count,
		start_line: i64::from(first_line),
	})
}

/// Splits around a touching range. Both independent results keep their original record order.
pub fn split_sparse_tokens(
	tokens: &[u32],
	start_line: i64,
	start_char: i64,
	end_line: i64,
	end_char: i64,
) -> Result<Option<Vec<u32>>, TokensError> {
	let (records, tail) = tokens.as_chunks::<4>();
	if !tail.is_empty() {
		return Err(TokensError::InvalidEncoding);
	}
	let Some(capacity) = tokens
		.len()
		.checked_add(2)
		.filter(|&len| len <= 4 * 1024 * 1024)
	else {
		return Ok(None);
	};
	let mut result = Vec::new();
	if result.try_reserve_exact(capacity).is_err() {
		return Ok(None);
	}
	result.extend_from_slice(&[0, 0]);
	let mut second = false;
	let mut first_line = 0;
	for &[line, start, end, metadata] in records {
		if i64::from(line) > start_line
			|| (i64::from(line) == start_line && i64::from(end) >= start_char)
		{
			if i64::from(line) < end_line
				|| (i64::from(line) == end_line && i64::from(start) <= end_char)
			{
				continue;
			}
			if !second {
				second = true;
				first_line = line;
			}
		}
		result.extend_from_slice(&[line.wrapping_sub(first_line), start, end, metadata]);
		if !second {
			result[0] += 4;
		}
	}
	result[1] = first_line;
	Ok(Some(result))
}

/// Applies complete delete/insert adjustment in one scope, including block-coordinate rebasing.
pub fn edit_sparse_tokens(
	tokens: &mut [u32],
	edit: &SparseTokenEdit,
) -> Result<SparseTokensUpdate, TokensError> {
	if [
		edit.block_start,
		edit.start_line,
		edit.start_column,
		edit.end_line,
		edit.end_column,
		edit.eol_count,
		edit.first_line_length,
		edit.last_line_length,
		edit.first_char_code,
	]
	.iter()
	.any(|value| value.unsigned_abs() > 1 << 40)
		|| edit.start_line < 1
		|| edit.start_column < 1
		|| edit.end_line < edit.start_line
		|| edit.end_column < 1
		|| (edit.start_line == edit.end_line && edit.end_column < edit.start_column)
		|| edit.eol_count < 0
		|| edit.first_line_length < 0
		|| edit.last_line_length < 0
	{
		return Err(TokensError::InvalidEncoding);
	}
	let (tokens, tail) = tokens.as_chunks_mut::<4>();
	if !tail.is_empty() {
		return Err(TokensError::InvalidEncoding);
	}
	let mut count = tokens.len();
	let mut block_start = edit.block_start;
	if edit.start_line != edit.end_line || edit.start_column != edit.end_column {
		let first = edit.start_line - block_start;
		let last = edit.end_line - block_start;
		let max_line = max_line(tokens, count);
		if last < 0 {
			block_start -= last - first;
		} else if first < max_line + 1 {
			if first < 0 && last > max_line {
				block_start = 0;
				count = 0;
			} else if first < 0 {
				block_start += first;
				count = delete(
					tokens,
					edit.start_column - 1,
					0,
					0,
					last,
					edit.end_column - 1,
				);
			} else {
				count = delete(
					tokens,
					0,
					first,
					edit.start_column - 1,
					last,
					edit.end_column - 1,
				);
			}
		}
	}
	if edit.eol_count != 0 || edit.first_line_length != 0 {
		let line = edit.start_line - block_start;
		if line < 0 {
			block_start += edit.eol_count;
		} else if line < max_line(tokens, count) + 1 {
			insert(&mut tokens[..count], line, edit.start_column - 1, edit);
		}
	}
	Ok(SparseTokensUpdate {
		count,
		start_line: block_start,
	})
}

fn touches(
	line: u32,
	start: u32,
	end: u32,
	start_line: i64,
	start_char: i64,
	end_line: i64,
	end_char: i64,
) -> bool {
	(i64::from(line) > start_line
		|| (i64::from(line) == start_line && i64::from(end) >= start_char))
		&& (i64::from(line) < end_line
			|| (i64::from(line) == end_line && i64::from(start) <= end_char))
}

fn max_line(tokens: &[[u32; 4]], count: usize) -> i64 {
	if count == 0 {
		-1
	} else {
		i64::from(tokens[count - 1][0])
	}
}

fn delete(
	tokens: &mut [[u32; 4]],
	horizontal_shift: i64,
	start_line: i64,
	start_char: i64,
	end_line: i64,
	end_char: i64,
) -> usize {
	let mut count = 0;
	let mut deleted = false;
	let deleted_lines = end_line - start_line;
	for index in 0..tokens.len() {
		let [line, start, end, metadata] = tokens[index];
		let (mut line, mut start, mut end) = (i64::from(line), i64::from(start), i64::from(end));
		if line < start_line || (line == start_line && end <= start_char) {
			count += 1;
			continue;
		} else if line == start_line && start < start_char {
			if line == end_line && end > end_char {
				end -= end_char - start_char;
			} else {
				end = start_char;
			}
		} else if line == start_line && start == start_char {
			if line == end_line && end > end_char {
				end -= end_char - start_char;
			} else {
				deleted = true;
				continue;
			}
		} else if line < end_line || (line == end_line && start < end_char) {
			if line == end_line && end > end_char {
				line = start_line;
				start = start_char;
				end = start + end - end_char;
			} else {
				deleted = true;
				continue;
			}
		} else if line > end_line {
			if deleted_lines == 0 && !deleted {
				return tokens.len();
			}
			line -= deleted_lines;
		} else {
			if horizontal_shift != 0 && line == 0 {
				start += horizontal_shift;
				end += horizontal_shift;
			}
			line -= deleted_lines;
			start -= end_char - start_char;
			end -= end_char - start_char;
		}
		// Typed-array assignment deliberately retains modulo-2^32 semantics.
		tokens[count] = [line as u32, start as u32, end as u32, metadata];
		count += 1;
	}
	count
}

fn insert(tokens: &mut [[u32; 4]], delta_line: i64, character: i64, edit: &SparseTokenEdit) {
	let word = edit.eol_count == 0
		&& edit.first_line_length == 1
		&& matches!(edit.first_char_code, 48..=57 | 65..=90 | 97..=122);
	for token in tokens {
		let [line, start, end, _] = *token;
		let (mut line, mut start, mut end) = (i64::from(line), i64::from(start), i64::from(end));
		if line < delta_line || (line == delta_line && end < character) {
			continue;
		} else if line == delta_line && end == character {
			if word {
				end += 1;
			} else {
				continue;
			}
		} else if line == delta_line && start < character && character < end {
			if edit.eol_count == 0 {
				end += edit.first_line_length;
			} else {
				end = character;
			}
		} else {
			if line == delta_line && start == character && word {
				continue;
			}
			if line == delta_line {
				line += edit.eol_count;
				if edit.eol_count == 0 {
					start += edit.first_line_length;
					end += edit.first_line_length;
				} else {
					let length = end - start;
					start = edit.last_line_length + start - character;
					end = start + length;
				}
			} else {
				line += edit.eol_count;
			}
		}
		token[0] = line as u32;
		token[1] = start as u32;
		token[2] = end as u32;
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn selection_keeps_duplicate_bounds_unsorted_records_and_zero_active_count_reads() {
		let lines = [0, 0, 2, 2, 2, 4];
		let read = |index| lines.get(index).copied();
		assert_eq!(
			[
				find_sparse_line_tokens(6, 2.0, read),
				find_sparse_line_tokens(6, 3.0, read),
				find_sparse_line_tokens(6, 4.0, read),
				find_sparse_line_tokens(0, 0.0, read),
				find_sparse_line_tokens(0, 0.0, |_| None)
			],
			[Some((2, 5)), None, Some((5, 6)), Some((0, 1)), None]
		);
		let lines = [4, 0, 2, 2, 1, 4];
		assert_eq!(
			find_sparse_line_tokens(lines.len(), 2.0, |index| lines.get(index).copied()),
			Some((2, 4))
		);
	}

	#[test]
	fn removal_preserves_inactive_suffix_and_rebases_survivors() {
		let mut tokens = [2, 1, 4, 7, 3, 0, 5, 9, 6, 1, 8, 11];
		assert_eq!(
			remove_sparse_tokens(&mut tokens, 2, 1, 3, 5).unwrap(),
			SparseTokensUpdate {
				count: 1,
				start_line: 6
			}
		);
		assert_eq!(tokens, [0, 1, 8, 11, 3, 0, 5, 9, 6, 1, 8, 11]);
	}

	#[test]
	fn malformed_mutation_is_atomic() {
		let mut tokens = [0, 1, 2];
		assert_eq!(
			remove_sparse_tokens(&mut tokens, 0, 0, 1, 0),
			Err(TokensError::InvalidEncoding)
		);
		assert_eq!(tokens, [0, 1, 2]);
	}
}
