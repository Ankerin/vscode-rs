/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket tokenization preserves line providers, ECMAScript matching, and live token cursor state.

/// Peekable token capabilities preserve original cached-token aliases and offset assignments.
pub trait PeekableBracketTokenizerHost {
	type Value;
	type Error;

	fn peeked(&self) -> Result<Self::Value, Self::Error>;
	fn truthy(&self, token: &Self::Value) -> Result<bool, Self::Error>;
	fn did_peek(&self) -> Result<bool, Self::Error>;
	fn set_did_peek(&self, value: bool) -> Result<(), Self::Error>;
	fn set_peeked(&self, token: &Self::Value) -> Result<(), Self::Error>;
	fn read(&self) -> Result<Self::Value, Self::Error>;
	fn advance_token(&self, token: &Self::Value) -> Result<(), Self::Error>;
	fn advance_length(&self, length: &Self::Value) -> Result<(), Self::Error>;
	fn update_position(&self) -> Result<(), Self::Error>;
}

/// Reads preserve the historical cached-token behavior, including retaining the peeked reference.
pub fn read_peekable_bracket_token<H: PeekableBracketTokenizerHost>(
	host: &H,
) -> Result<H::Value, H::Error> {
	let peeked = host.peeked()?;
	let token = if host.truthy(&peeked)? {
		host.set_did_peek(false)?;
		host.peeked()?
	} else {
		host.read()?
	};
	if host.truthy(&token)? {
		host.advance_token(&token)?;
	}
	Ok(token)
}

/// Peeks retain the original read/assignment/flag order and repeated cached field access.
pub fn peek_bracket_token<H: PeekableBracketTokenizerHost>(host: &H) -> Result<H::Value, H::Error> {
	if !host.did_peek()? {
		let token = host.read()?;
		host.set_peeked(&token)?;
		host.set_did_peek(true)?;
	}
	host.peeked()
}

/// Skips preserve the original invalidation before offset computation and reader positioning.
pub fn skip_bracket_tokens<H: PeekableBracketTokenizerHost>(
	host: &H,
	length: &H::Value,
) -> Result<(), H::Error> {
	host.set_did_peek(false)?;
	host.advance_length(length)?;
	host.update_position()
}

/// Line/token capabilities retain method lookup order and partially changed provider state.
pub trait BracketTokenizerHost {
	type Value;
	type Error;

	fn number(&self, value: &Self::Value) -> Option<f64>;
	fn value(&self, number: f64) -> Self::Value;
	fn null(&self) -> Self::Value;
	fn add(&self, first: &Self::Value, second: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn subtract(
		&self,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn greater(&self, first: &Self::Value, second: f64) -> Result<bool, Self::Error>;
	fn truthy(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn peeked(&self) -> Result<Self::Value, Self::Error>;
	fn set_peeked(&self, token: &Self::Value) -> Result<(), Self::Error>;
	fn consume(&self, token: &Self::Value) -> Result<(), Self::Error>;
	fn at_end(&self) -> Result<bool, Self::Error>;
	fn line_missing(&self) -> Result<bool, Self::Error>;
	fn load_tokens(&self) -> Result<(), Self::Error>;
	fn load_line(&self) -> Result<(), Self::Error>;
	fn select_index(&self) -> Result<(), Self::Error>;
	fn line_index(&self) -> Result<Self::Value, Self::Error>;
	fn column(&self) -> Result<Self::Value, Self::Error>;
	fn tokens(&self) -> Result<Self::Value, Self::Error>;
	fn count(&self, tokens: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn has_token(&self, count: &Self::Value) -> Result<bool, Self::Error>;
	fn metadata(&self, tokens: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn identical(
		&self,
		tokens: &Self::Value,
		count: &Self::Value,
		metadata: &Self::Value,
	) -> Result<bool, Self::Error>;
	fn increment_index(&self) -> Result<(), Self::Error>;
	fn is_other(&self, metadata: &Self::Value) -> Result<bool, Self::Error>;
	fn contains_brackets(&self, metadata: &Self::Value) -> Result<bool, Self::Error>;
	fn end_offset(&self, tokens: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn before_end(&self, end: &Self::Value) -> Result<bool, Self::Error>;
	fn language(&self, tokens: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn text(&self, end: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn brackets(&self, language: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn regexp(&self, brackets: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn reset_regexp(&self, regexp: &Self::Value) -> Result<(), Self::Error>;
	fn exec(&self, regexp: &Self::Value, text: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn matched_token(
		&self,
		brackets: &Self::Value,
		matched: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn consume_match(&self, matched: &Self::Value) -> Result<(), Self::Error>;
	fn changed(&self, line: &Self::Value, column: &Self::Value) -> Result<bool, Self::Error>;
	fn set_column(&self, column: &Self::Value) -> Result<(), Self::Error>;
	fn last_line(&self) -> Result<bool, Self::Error>;
	fn increment_line(&self) -> Result<(), Self::Error>;
	fn zero_index(&self) -> Result<(), Self::Error>;
	fn finish_text(
		&self,
		line: &Self::Value,
		column: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn same_line(&self, line: &Self::Value) -> Result<bool, Self::Error>;
	fn set_line(&self, line: &Self::Value) -> Result<(), Self::Error>;
	fn clear_line(&self) -> Result<(), Self::Error>;
}

/// Positions preserve same-line token lookup and cross-line cache invalidation.
pub fn set_bracket_token_position<H: BracketTokenizerHost>(
	host: &H,
	line: &H::Value,
	column: &H::Value,
) -> Result<(), H::Error> {
	if host.same_line(line)? {
		host.set_column(column)?;
		if !host.line_missing()? {
			host.select_index()?;
		}
	} else {
		host.set_line(line)?;
		host.set_column(column)?;
		host.clear_line()?;
	}
	host.set_peeked(&host.null())
}

/// Reads complete bracket/text tokens with the original metadata joining and text-length heuristics.
pub fn read_bracket_token<H: BracketTokenizerHost>(host: &H) -> Result<H::Value, H::Error> {
	let peeked = host.peeked()?;
	if host.truthy(&peeked)? {
		let token = host.peeked()?;
		host.set_peeked(&host.null())?;
		host.consume(&token)?;
		return Ok(token);
	}
	if host.at_end()? {
		return Ok(host.null());
	}
	if host.line_missing()? {
		host.load_tokens()?;
		host.load_line()?;
		host.select_index()?;
	}
	let start_line = host.line_index()?;
	let start_column = host.column()?;
	let mut heuristic = host.value(0.0);
	loop {
		let tokens = host.tokens()?;
		let count = host.count(&tokens)?;
		if host.has_token(&count)? {
			let metadata = host.metadata(&tokens)?;
			while host.identical(&tokens, &count, &metadata)? {
				host.increment_index()?;
			}
			let other = host.is_other(&metadata)?;
			let brackets = host.contains_brackets(&metadata)?;
			let end = host.end_offset(&tokens)?;
			let mut peeked = host.null();
			if brackets && other && host.before_end(&end)? {
				let language = host.language(&tokens)?;
				let text = host.text(&end)?;
				let brackets = host.brackets(&language)?;
				let regexp = host.regexp(&brackets)?;
				if host.truthy(&regexp)? {
					host.reset_regexp(&regexp)?;
					let matched = host.exec(&regexp, &text)?;
					if host.truthy(&matched)? {
						peeked = host.matched_token(&brackets, &matched)?;
						if host.truthy(&peeked)? {
							host.consume_match(&matched)?;
						}
					}
				}
			}
			let column = host.column()?;
			let remaining = subtract(host, &end, &column)?;
			heuristic = add(host, &heuristic, &remaining)?;
			if host.truthy(&peeked)? {
				if host.changed(&start_line, &start_column)? {
					host.set_peeked(&peeked)?;
					break;
				}
				host.consume(&peeked)?;
				return Ok(peeked);
			}
			host.increment_index()?;
			host.set_column(&end)?;
		} else {
			if host.last_line()? {
				break;
			}
			host.increment_line()?;
			host.load_tokens()?;
			host.zero_index()?;
			host.load_line()?;
			host.set_column(&host.value(0.0))?;
			heuristic = add(host, &heuristic, &host.value(33.0))?;
			if greater(host, &heuristic, 1000.0)? {
				break;
			}
		}
		if greater(host, &heuristic, 1500.0)? {
			break;
		}
	}
	host.finish_text(&start_line, &start_column)
}

fn add<H: BracketTokenizerHost>(
	host: &H,
	first: &H::Value,
	second: &H::Value,
) -> Result<H::Value, H::Error> {
	if let (Some(first), Some(second)) = (host.number(first), host.number(second)) {
		Ok(host.value(first + second))
	} else {
		host.add(first, second)
	}
}

fn subtract<H: BracketTokenizerHost>(
	host: &H,
	first: &H::Value,
	second: &H::Value,
) -> Result<H::Value, H::Error> {
	if let (Some(first), Some(second)) = (host.number(first), host.number(second)) {
		Ok(host.value(first - second))
	} else {
		host.subtract(first, second)
	}
}

fn greater<H: BracketTokenizerHost>(
	host: &H,
	first: &H::Value,
	second: f64,
) -> Result<bool, H::Error> {
	if let Some(first) = host.number(first) {
		Ok(first > second)
	} else {
		host.greater(first, second)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::bracket_lengths::bracket_length;
	use std::cell::Cell;

	#[derive(Default)]
	struct Peekable {
		peeked: Cell<f64>,
		did_peek: Cell<bool>,
		reads: Cell<f64>,
		offset: Cell<f64>,
		positions: Cell<usize>,
	}

	impl PeekableBracketTokenizerHost for Peekable {
		type Value = f64;
		type Error = ();
		fn peeked(&self) -> Result<f64, ()> {
			Ok(self.peeked.get())
		}
		fn truthy(&self, token: &f64) -> Result<bool, ()> {
			Ok(*token != 0.0)
		}
		fn did_peek(&self) -> Result<bool, ()> {
			Ok(self.did_peek.get())
		}
		fn set_did_peek(&self, value: bool) -> Result<(), ()> {
			self.did_peek.set(value);
			Ok(())
		}
		fn set_peeked(&self, token: &f64) -> Result<(), ()> {
			self.peeked.set(*token);
			Ok(())
		}
		fn read(&self) -> Result<f64, ()> {
			self.reads.set(self.reads.get() + 1.0);
			Ok(self.reads.get())
		}
		fn advance_token(&self, _: &f64) -> Result<(), ()> {
			self.offset.set(self.offset.get() + 1.0);
			Ok(())
		}
		fn advance_length(&self, length: &f64) -> Result<(), ()> {
			self.offset.set(self.offset.get() + length);
			Ok(())
		}
		fn update_position(&self) -> Result<(), ()> {
			self.positions.set(self.positions.get() + 1);
			Ok(())
		}
	}

	#[test]
	fn peekable_reads_retain_cached_aliases_and_skip_invalidates_before_positioning() {
		let host = Peekable::default();
		assert_eq!(peek_bracket_token(&host), Ok(1.0));
		assert_eq!(read_peekable_bracket_token(&host), Ok(1.0));
		assert_eq!(read_peekable_bracket_token(&host), Ok(1.0));
		assert_eq!(peek_bracket_token(&host), Ok(2.0));
		skip_bracket_tokens(&host, &3.0).unwrap();
		assert_eq!(
			(
				host.peeked.get(),
				host.did_peek.get(),
				host.reads.get(),
				host.offset.get(),
				host.positions.get()
			),
			(2.0, false, 2.0, 5.0, 1)
		);
	}

	#[derive(Default)]
	struct Lines {
		line: Cell<f64>,
		column: Cell<f64>,
		index: Cell<f64>,
		loaded: Cell<bool>,
		loads: Cell<usize>,
	}

	impl BracketTokenizerHost for Lines {
		type Value = f64;
		type Error = ();
		fn number(&self, value: &f64) -> Option<f64> {
			Some(*value)
		}
		fn value(&self, number: f64) -> f64 {
			number
		}
		fn null(&self) -> f64 {
			f64::NAN
		}
		fn add(&self, _: &f64, _: &f64) -> Result<f64, ()> {
			unreachable!()
		}
		fn subtract(&self, _: &f64, _: &f64) -> Result<f64, ()> {
			unreachable!()
		}
		fn greater(&self, _: &f64, _: f64) -> Result<bool, ()> {
			unreachable!()
		}
		fn truthy(&self, value: &f64) -> Result<bool, ()> {
			Ok(!value.is_nan())
		}
		fn peeked(&self) -> Result<f64, ()> {
			Ok(f64::NAN)
		}
		fn set_peeked(&self, _: &f64) -> Result<(), ()> {
			unreachable!()
		}
		fn consume(&self, _: &f64) -> Result<(), ()> {
			unreachable!()
		}
		fn at_end(&self) -> Result<bool, ()> {
			Ok(self.line.get() > 34.0 || (self.line.get() == 34.0 && self.column.get() >= 1.0))
		}
		fn line_missing(&self) -> Result<bool, ()> {
			Ok(!self.loaded.get())
		}
		fn load_tokens(&self) -> Result<(), ()> {
			self.loads.set(self.loads.get() + 1);
			Ok(())
		}
		fn load_line(&self) -> Result<(), ()> {
			self.loaded.set(true);
			Ok(())
		}
		fn select_index(&self) -> Result<(), ()> {
			self.index.set(0.0);
			Ok(())
		}
		fn line_index(&self) -> Result<f64, ()> {
			Ok(self.line.get())
		}
		fn column(&self) -> Result<f64, ()> {
			Ok(self.column.get())
		}
		fn tokens(&self) -> Result<f64, ()> {
			Ok(self.line.get())
		}
		fn count(&self, _: &f64) -> Result<f64, ()> {
			Ok(1.0)
		}
		fn has_token(&self, count: &f64) -> Result<bool, ()> {
			Ok(self.index.get() < *count)
		}
		fn metadata(&self, _: &f64) -> Result<f64, ()> {
			Ok(0.0)
		}
		fn identical(&self, _: &f64, _: &f64, _: &f64) -> Result<bool, ()> {
			Ok(false)
		}
		fn increment_index(&self) -> Result<(), ()> {
			self.index.set(self.index.get() + 1.0);
			Ok(())
		}
		fn is_other(&self, _: &f64) -> Result<bool, ()> {
			Ok(true)
		}
		fn contains_brackets(&self, _: &f64) -> Result<bool, ()> {
			Ok(false)
		}
		fn end_offset(&self, _: &f64) -> Result<f64, ()> {
			Ok(1.0)
		}
		fn before_end(&self, _: &f64) -> Result<bool, ()> {
			unreachable!()
		}
		fn language(&self, _: &f64) -> Result<f64, ()> {
			unreachable!()
		}
		fn text(&self, _: &f64) -> Result<f64, ()> {
			unreachable!()
		}
		fn brackets(&self, _: &f64) -> Result<f64, ()> {
			unreachable!()
		}
		fn regexp(&self, _: &f64) -> Result<f64, ()> {
			unreachable!()
		}
		fn reset_regexp(&self, _: &f64) -> Result<(), ()> {
			unreachable!()
		}
		fn exec(&self, _: &f64, _: &f64) -> Result<f64, ()> {
			unreachable!()
		}
		fn matched_token(&self, _: &f64, _: &f64) -> Result<f64, ()> {
			unreachable!()
		}
		fn consume_match(&self, _: &f64) -> Result<(), ()> {
			unreachable!()
		}
		fn changed(&self, _: &f64, _: &f64) -> Result<bool, ()> {
			unreachable!()
		}
		fn set_column(&self, column: &f64) -> Result<(), ()> {
			self.column.set(*column);
			Ok(())
		}
		fn last_line(&self) -> Result<bool, ()> {
			Ok(self.line.get() == 34.0)
		}
		fn increment_line(&self) -> Result<(), ()> {
			self.line.set(self.line.get() + 1.0);
			Ok(())
		}
		fn zero_index(&self) -> Result<(), ()> {
			self.index.set(0.0);
			Ok(())
		}
		fn finish_text(&self, line: &f64, column: &f64) -> Result<f64, ()> {
			Ok(bracket_length(3, *line, *column, self.line.get(), self.column.get()).unwrap())
		}
		fn same_line(&self, _: &f64) -> Result<bool, ()> {
			unreachable!()
		}
		fn set_line(&self, _: &f64) -> Result<(), ()> {
			unreachable!()
		}
		fn clear_line(&self) -> Result<(), ()> {
			unreachable!()
		}
	}

	#[test]
	fn line_scanning_keeps_text_heuristic_limits_and_continues_from_the_saved_cursor() {
		let host = Lines::default();
		assert_eq!(read_bracket_token(&host), Ok(30.0 * 67_108_864.0));
		assert_eq!(read_bracket_token(&host), Ok(4.0 * 67_108_864.0 + 1.0));
		assert!(read_bracket_token(&host).unwrap().is_nan());
		assert_eq!(
			(
				host.line.get(),
				host.column.get(),
				host.index.get(),
				host.loads.get()
			),
			(34.0, 1.0, 1.0, 35)
		);
	}
}
