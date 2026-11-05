/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Token sequence construction and slicing preserve the original floating-point length arithmetic.

const MAX_TOKENS: usize = 262_144;
const MAX_TEXT: f64 = (4 * 1024 * 1024) as f64;

/// Returns lengths/metadata or substring endpoints/metadata for every original line token.
pub fn line_token_array(tokens: &[u32], text_length: usize, text: bool) -> Option<Vec<f64>> {
	let (records, tail) = tokens.as_chunks::<2>();
	if !tail.is_empty() || records.len() > MAX_TOKENS {
		return None;
	}
	let mut result = Vec::new();
	result
		.try_reserve_exact(records.len() * if text { 3 } else { 2 })
		.ok()?;
	let mut start = 0;
	for &[end, metadata] in records {
		if text {
			let first = (start as usize).min(text_length);
			let last = (end as usize).min(text_length);
			result.extend_from_slice(&[
				first.min(last) as f64,
				first.max(last) as f64,
				f64::from(metadata),
			]);
		} else {
			result.extend_from_slice(&[f64::from(end) - f64::from(start), f64::from(metadata)]);
		}
		start = end;
	}
	Some(result)
}

/// Produces source indices, before/after clipping, and final lengths without merging zero-width tokens.
pub fn slice_token_array(lengths: &[f64], start: f64, end: f64) -> Option<Vec<f64>> {
	if lengths.len() > MAX_TOKENS {
		return None;
	}
	let mut result = Vec::new();
	result.try_reserve_exact(lengths.len() * 4).ok()?;
	let mut offset = 0.0;
	for (index, &length) in lengths.iter().enumerate() {
		let token_end = offset + length;
		if token_end > start {
			if offset >= end {
				break;
			}
			let before = positive(start - offset);
			let after = positive(token_end - end);
			result.extend_from_slice(&[index as f64, before, after, length - before - after]);
		}
		offset += length;
	}
	Some(result)
}

/// Creates the same encoded boundaries and unsigned metadata for a sequence of complete text fragments.
pub fn create_line_token_array(parameters: &[[f64; 2]]) -> Option<Vec<u32>> {
	if parameters.len() > MAX_TOKENS {
		return None;
	}
	let mut result = Vec::new();
	result.try_reserve_exact(parameters.len() * 2).ok()?;
	let mut offset = 0.0;
	for &[length, metadata] in parameters {
		if !length.is_finite() || length < 0.0 || length.fract() != 0.0 {
			return None;
		}
		offset += length;
		if offset > MAX_TEXT {
			return None;
		}
		let metadata = if metadata.is_finite() {
			metadata.trunc().rem_euclid(4_294_967_296.0) as u32
		} else {
			0
		};
		result.extend_from_slice(&[offset as u32, metadata]);
	}
	Some(result)
}

fn positive(value: f64) -> f64 {
	if value.is_nan() || value > 0.0 {
		value
	} else {
		0.0
	}
}
