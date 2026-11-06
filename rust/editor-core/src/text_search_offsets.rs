/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! UTF-16 line-feed indexing and multiline search compensate LF text for CRLF model coordinates.

/// Borrowed scan capabilities preserve cached length, character reads, and ordered offset writes.
pub trait LineFeedScanHost {
	type Value;
	type Error;
	fn text_length(&self) -> Result<Self::Value, Self::Error>;
	fn below(&self, index: f64, length: &Self::Value) -> Result<bool, Self::Error>;
	fn char_code(&self, index: f64) -> Result<Self::Value, Self::Error>;
	fn is_line_feed(&self, value: &Self::Value) -> bool;
	fn write(&self, index: f64, offset: f64) -> Result<(), Self::Error>;
}

/// Builds the original ordered LF index through its owning array facade.
pub fn scan_search_line_feeds<H: LineFeedScanHost>(host: &H) -> Result<(), H::Error> {
	let length = host.text_length()?;
	let mut index = 0.0;
	let mut count = 0.0;
	while host.below(index, &length)? {
		if host.is_line_feed(&host.char_code(index)?) {
			host.write(count, index)?;
			count += 1.0;
		}
		index += 1.0;
	}
	Ok(())
}

/// Original array observations and relational coercions remain caught host capabilities.
pub trait LineFeedQueryHost {
	type Value;
	type Error;
	fn last_index(&self) -> Result<f64, Self::Error>;
	fn offset(&self, index: f64) -> Result<Self::Value, Self::Error>;
	fn at_most(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
	fn at_least(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
}

fn int32(value: f64) -> f64 {
	if !value.is_finite() || value == 0.0 {
		return 0.0;
	}
	let unsigned = value.trunc().rem_euclid(4294967296.0);
	if unsigned >= 2147483648.0 {
		unsigned - 4294967296.0
	} else {
		unsigned
	}
}

/// Counts only LFs strictly before the offset, retaining the original binary-search observations.
pub fn search_line_feeds_before<H: LineFeedQueryHost>(
	host: &H,
	target: &H::Value,
) -> Result<f64, H::Error> {
	let mut min = 0.0;
	let mut max = host.last_index()?;
	if max == -1.0 {
		return Ok(0.0);
	}
	if host.at_most(target, &host.offset(0.0)?)? {
		return Ok(0.0);
	}
	while min < max {
		let mid = min + int32((max - min) / 2.0);
		if host.at_least(&host.offset(mid)?, target)? {
			max = mid - 1.0;
		} else if host.at_least(&host.offset(mid + 1.0)?, target)? {
			min = mid;
			max = mid;
		} else {
			min = mid + 1.0;
		}
	}
	Ok(min + 1.0)
}

/// Multiline offsets retain original LF-count, match-length, position, and range-factory calls.
pub trait MultilineMatchHost {
	type Value;
	type Error;
	fn number(&self, value: f64) -> Self::Value;
	fn add(&self, first: &Self::Value, second: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn subtract(
		&self,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn has_counter(&self) -> bool;
	fn count_before(&self, index: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn match_length(&self) -> Result<Self::Value, Self::Error>;
	fn position(&self, offset: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn range(&self, start: &Self::Value, end: &Self::Value) -> Result<Self::Value, Self::Error>;
}

/// Resolves the same UTF-16 range over either LF or CRLF model text without copying it.
pub fn multiline_match_range<H: MultilineMatchHost>(
	host: &H,
	delta: &H::Value,
	index: &H::Value,
) -> Result<H::Value, H::Error> {
	let mut before = host.number(0.0);
	let start = if host.has_counter() {
		before = host.count_before(index)?;
		host.add(&host.add(delta, index)?, &before)?
	} else {
		host.add(delta, index)?
	};
	let end = if host.has_counter() {
		let end_index = host.add(index, &host.match_length()?)?;
		let after = host.count_before(&end_index)?;
		let in_match = host.subtract(&after, &before)?;
		host.add(&host.add(&start, &host.match_length()?)?, &in_match)?
	} else {
		host.add(&start, &host.match_length()?)?
	};
	let start_position = host.position(&start)?;
	let end_position = host.position(&end)?;
	host.range(&start_position, &end_position)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::RefCell;
	struct Host {
		text: Vec<u16>,
		offsets: RefCell<Vec<f64>>,
		observations: RefCell<Vec<(char, f64)>>,
		counter: bool,
	}
	impl LineFeedScanHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn text_length(&self) -> Result<f64, Self::Error> {
			Ok(self.text.len() as f64)
		}
		fn below(&self, index: f64, length: &f64) -> Result<bool, Self::Error> {
			Ok(index < *length)
		}
		fn char_code(&self, index: f64) -> Result<f64, Self::Error> {
			Ok(f64::from(self.text[index as usize]))
		}
		fn is_line_feed(&self, value: &f64) -> bool {
			*value == 10.0
		}
		fn write(&self, index: f64, offset: f64) -> Result<(), Self::Error> {
			assert_eq!(index as usize, self.offsets.borrow().len());
			self.offsets.borrow_mut().push(offset);
			Ok(())
		}
	}
	impl LineFeedQueryHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn last_index(&self) -> Result<f64, Self::Error> {
			Ok(self.offsets.borrow().len() as f64 - 1.0)
		}
		fn offset(&self, index: f64) -> Result<f64, Self::Error> {
			Ok(self.offsets.borrow()[index as usize])
		}
		fn at_most(&self, first: &f64, second: &f64) -> Result<bool, Self::Error> {
			Ok(first <= second)
		}
		fn at_least(&self, first: &f64, second: &f64) -> Result<bool, Self::Error> {
			Ok(first >= second)
		}
	}
	impl MultilineMatchHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn number(&self, value: f64) -> f64 {
			value
		}
		fn add(&self, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			Ok(first + second)
		}
		fn subtract(&self, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			Ok(first - second)
		}
		fn has_counter(&self) -> bool {
			self.counter
		}
		fn count_before(&self, index: &f64) -> Result<f64, Self::Error> {
			self.observations.borrow_mut().push(('c', *index));
			search_line_feeds_before(self, index)
		}
		fn match_length(&self) -> Result<f64, Self::Error> {
			self.observations.borrow_mut().push(('l', 3.0));
			Ok(3.0)
		}
		fn position(&self, offset: &f64) -> Result<f64, Self::Error> {
			self.observations.borrow_mut().push(('p', *offset));
			Ok(*offset)
		}
		fn range(&self, start: &f64, end: &f64) -> Result<f64, Self::Error> {
			self.observations
				.borrow_mut()
				.extend([('s', *start), ('e', *end)]);
			Ok(*end)
		}
	}
	fn host(counter: bool) -> Host {
		Host {
			text: vec![10, 0xD83D, 0xDE00, 10, 13, 10],
			offsets: RefCell::new(Vec::new()),
			observations: RefCell::new(Vec::new()),
			counter,
		}
	}
	#[test]
	fn lf_index_uses_utf16_and_excludes_an_lf_at_the_exact_target() {
		let host = host(true);
		scan_search_line_feeds(&host).unwrap();
		let counts: Vec<_> = [-1.0, 0.0, 1.0, 3.0, 4.0, 5.0, 6.0, f64::NAN]
			.iter()
			.map(|target| search_line_feeds_before(&host, target).unwrap())
			.collect();
		assert_eq!(
			(host.offsets.into_inner(), counts),
			(
				vec![0.0, 3.0, 5.0],
				vec![0.0, 0.0, 1.0, 1.0, 2.0, 2.0, 3.0, 3.0]
			)
		);
	}
	#[test]
	fn multiline_compensation_preserves_repeated_lengths_and_position_order() {
		for counter in [true, false] {
			let host = host(counter);
			scan_search_line_feeds(&host).unwrap();
			let range = multiline_match_range(&host, &10.0, &2.0);
			let expected = if counter {
				vec![
					('c', 2.0),
					('l', 3.0),
					('c', 5.0),
					('l', 3.0),
					('p', 13.0),
					('p', 17.0),
					('s', 13.0),
					('e', 17.0),
				]
			} else {
				vec![
					('l', 3.0),
					('p', 12.0),
					('p', 15.0),
					('s', 12.0),
					('e', 15.0),
				]
			};
			assert_eq!(
				(range, host.observations.into_inner()),
				(Ok(if counter { 17.0 } else { 15.0 }), expected)
			);
		}
	}
}
