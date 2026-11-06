/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Initial bracket token streams retain existing cached tokens and ECMAScript match semantics.

/// Ordered host capabilities preserve array aliases, regex callbacks, and inline factory evaluation.
pub trait FastBracketTokenizerHost {
	type Value;
	type Error;

	fn zero(&self) -> Self::Value;
	fn add(&self, first: &Self::Value, second: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn subtract(
		&self,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn equal(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
	fn cache(&self) -> Result<Self::Value, Self::Error>;
	fn populate(&self, cache: &Self::Value, line: f64, column: f64) -> Result<(), Self::Error>;
	fn has_regexp(&self) -> Result<bool, Self::Error>;
	fn reset_regexp(&self) -> Result<(), Self::Error>;
	fn next_match(&self) -> Result<Self::Value, Self::Error>;
	fn match_is_null(&self, matched: &Self::Value) -> Result<bool, Self::Error>;
	fn match_index(&self, matched: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn match_value(&self, matched: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn line_break(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn after_break(&self, index: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn short_cache(&self, cache: &Self::Value, column: &Self::Value) -> Result<bool, Self::Error>;
	fn cached_token(
		&self,
		cache: &Self::Value,
		column: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn text_token(&self, line: f64, column: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn push_token(&self, token: &Self::Value) -> Result<(), Self::Error>;
	fn push_bracket(&self, value: &Self::Value) -> Result<(), Self::Error>;
	fn value_length(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn text_length(&self) -> Result<Self::Value, Self::Error>;
	fn length(&self, line: f64, column: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn push_text(&self, length: &Self::Value) -> Result<(), Self::Error>;
}

/// Builds the complete stream while retaining small-token identities and original newline offsets.
pub fn build_fast_bracket_tokens<H: FastBracketTokenizerHost>(
	host: &H,
) -> Result<H::Value, H::Error> {
	let small_zero = host.cache()?;
	for column in 0..60 {
		host.populate(&small_zero, 0.0, f64::from(column))?;
	}
	let small_one = host.cache()?;
	for column in 0..60 {
		host.populate(&small_one, 1.0, f64::from(column))?;
	}
	let mut current_line = 0.0;
	let mut last_break = host.zero();
	let mut last_end = host.zero();
	let mut last_line = 0.0;
	if host.has_regexp()? {
		host.reset_regexp()?;
		loop {
			let matched = host.next_match()?;
			if host.match_is_null(&matched)? {
				break;
			}
			let index = host.match_index(&matched)?;
			let value = host.match_value(&matched)?;
			if host.line_break(&value)? {
				current_line += 1.0;
				last_break = host.after_break(&index)?;
			} else {
				if !host.equal(&last_end, &index)? {
					let line = current_line - last_line;
					let column = if last_line == current_line {
						host.subtract(&index, &last_end)?
					} else {
						host.subtract(&index, &last_break)?
					};
					let cache = if last_line == current_line {
						Some(&small_zero)
					} else if line == 1.0 {
						Some(&small_one)
					} else {
						None
					};
					let token = if let Some(cache) = cache {
						if host.short_cache(cache, &column)? {
							host.cached_token(cache, &column)?
						} else {
							host.text_token(line, &column)?
						}
					} else {
						host.text_token(line, &column)?
					};
					host.push_token(&token)?;
				}
				host.push_bracket(&value)?;
				let length = host.value_length(&value)?;
				last_end = host.add(&index, &length)?;
				last_line = current_line;
			}
		}
	}
	let offset = host.text_length()?;
	if !host.equal(&last_end, &offset)? {
		let line = current_line - last_line;
		let column = if last_line == current_line {
			host.subtract(&offset, &last_end)?
		} else {
			host.subtract(&offset, &last_break)?
		};
		let length = host.length(line, &column)?;
		host.push_text(&length)?;
	}
	let column = host.subtract(&offset, &last_break)?;
	host.length(current_line, &column)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::bracket_lengths::bracket_length;
	use std::cell::{Cell, RefCell};

	struct Host {
		matches: Vec<(f64, bool)>,
		index: Cell<usize>,
		caches: Cell<f64>,
		populated: Cell<usize>,
		pushed: RefCell<Vec<f64>>,
	}

	impl FastBracketTokenizerHost for Host {
		type Value = f64;
		type Error = ();
		fn zero(&self) -> f64 {
			0.0
		}
		fn add(&self, first: &f64, second: &f64) -> Result<f64, ()> {
			Ok(first + second)
		}
		fn subtract(&self, first: &f64, second: &f64) -> Result<f64, ()> {
			Ok(first - second)
		}
		fn equal(&self, first: &f64, second: &f64) -> Result<bool, ()> {
			Ok(first == second)
		}
		fn cache(&self) -> Result<f64, ()> {
			let cache = self.caches.get();
			self.caches.set(cache + 1.0);
			Ok(cache)
		}
		fn populate(&self, _: &f64, _: f64, _: f64) -> Result<(), ()> {
			self.populated.set(self.populated.get() + 1);
			Ok(())
		}
		fn has_regexp(&self) -> Result<bool, ()> {
			Ok(true)
		}
		fn reset_regexp(&self) -> Result<(), ()> {
			Ok(())
		}
		fn next_match(&self) -> Result<f64, ()> {
			let index = self.index.get();
			self.index.set(index + 1);
			Ok(if index < self.matches.len() {
				index as f64
			} else {
				-1.0
			})
		}
		fn match_is_null(&self, matched: &f64) -> Result<bool, ()> {
			Ok(*matched == -1.0)
		}
		fn match_index(&self, matched: &f64) -> Result<f64, ()> {
			Ok(self.matches[*matched as usize].0)
		}
		fn match_value(&self, matched: &f64) -> Result<f64, ()> {
			Ok(f64::from(self.matches[*matched as usize].1))
		}
		fn line_break(&self, value: &f64) -> Result<bool, ()> {
			Ok(*value == 1.0)
		}
		fn after_break(&self, index: &f64) -> Result<f64, ()> {
			Ok(index + 1.0)
		}
		fn short_cache(&self, _: &f64, column: &f64) -> Result<bool, ()> {
			Ok(*column < 60.0)
		}
		fn cached_token(&self, cache: &f64, column: &f64) -> Result<f64, ()> {
			self.length(*cache, column)
		}
		fn text_token(&self, line: f64, column: &f64) -> Result<f64, ()> {
			self.length(line, column)
		}
		fn push_token(&self, token: &f64) -> Result<(), ()> {
			self.pushed.borrow_mut().push(*token);
			Ok(())
		}
		fn push_bracket(&self, _: &f64) -> Result<(), ()> {
			self.pushed.borrow_mut().push(-1.0);
			Ok(())
		}
		fn value_length(&self, _: &f64) -> Result<f64, ()> {
			Ok(1.0)
		}
		fn text_length(&self) -> Result<f64, ()> {
			Ok(11.0)
		}
		fn length(&self, line: f64, column: &f64) -> Result<f64, ()> {
			Ok(bracket_length(0, line, *column, 0.0, 0.0).unwrap())
		}
		fn push_text(&self, length: &f64) -> Result<(), ()> {
			self.push_token(length)
		}
	}

	#[test]
	fn construction_preserves_newline_spans_small_caches_brackets_and_final_text() {
		let host = Host {
			matches: vec![
				(2.0, false),
				(3.0, true),
				(5.0, false),
				(6.0, true),
				(8.0, true),
				(9.0, false),
			],
			index: Cell::new(0),
			caches: Cell::new(0.0),
			populated: Cell::new(0),
			pushed: RefCell::new(Vec::new()),
		};
		let length = build_fast_bracket_tokens(&host).unwrap();
		assert_eq!(
			(length, host.populated.get(), host.pushed.into_inner()),
			(
				3.0 * 67_108_864.0 + 2.0,
				120,
				vec![
					2.0,
					-1.0,
					67_108_864.0 + 1.0,
					-1.0,
					2.0 * 67_108_864.0,
					-1.0,
					1.0
				]
			)
		);
	}
}
