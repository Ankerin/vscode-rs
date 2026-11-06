/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Stateful text search retains ECMAScript regex behavior, UTF-16 advancement, and word filtering.

/// Caught regex and property capabilities preserve original receivers and partial state changes.
pub trait TextSearchHost {
	type Value;
	type Error;

	fn number(&self, value: f64) -> Self::Value;
	fn null(&self) -> Self::Value;
	fn text_length(&self) -> Result<Self::Value, Self::Error>;
	fn previous_start(&self) -> Result<Self::Value, Self::Error>;
	fn previous_length(&self) -> Result<Self::Value, Self::Error>;
	fn add(&self, first: &Self::Value, second: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn equal(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
	fn exec(&self) -> Result<Self::Value, Self::Error>;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn match_start(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn match_length(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn next_code_point(&self, text_length: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn above_bmp(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn advance(&self, count: u32) -> Result<(), Self::Error>;
	fn set_previous_start(&self, value: &Self::Value) -> Result<(), Self::Error>;
	fn set_previous_length(&self, value: &Self::Value) -> Result<(), Self::Error>;
	fn has_words(&self) -> Result<bool, Self::Error>;
	fn valid_match(
		&self,
		text_length: &Self::Value,
		start: &Self::Value,
		length: &Self::Value,
	) -> Result<bool, Self::Error>;
	fn reset_regex(&self) -> Result<(), Self::Error>;
}

/// Resets the regex before committing the previous-match fields in their original order.
pub fn reset_text_search<H: TextSearchHost>(host: &H) -> Result<(), H::Error> {
	host.reset_regex()?;
	host.set_previous_start(&host.number(-1.0))?;
	host.set_previous_length(&host.number(0.0))
}

/// Finds the next accepted match and advances repeated empty matches by one UTF-16 code point.
pub fn next_text_search_match<H: TextSearchHost>(host: &H) -> Result<H::Value, H::Error> {
	let text_length = host.text_length()?;
	loop {
		let previous_start = host.previous_start()?;
		let previous_length = host.previous_length()?;
		let end = host.add(&previous_start, &previous_length)?;
		if host.equal(&end, &text_length)? {
			return Ok(host.null());
		}
		let matched = host.exec()?;
		if !host.truthy(&matched) {
			return Ok(host.null());
		}
		let start = host.match_start(&matched)?;
		let length = host.match_length(&matched)?;
		if host.equal(&start, &host.previous_start()?)?
			&& host.equal(&length, &host.previous_length()?)?
		{
			if host.equal(&length, &host.number(0.0))? {
				let point = host.next_code_point(&text_length)?;
				host.advance(if host.above_bmp(&point)? { 2 } else { 1 })?;
				continue;
			}
			return Ok(host.null());
		}
		host.set_previous_start(&start)?;
		host.set_previous_length(&length)?;
		if !host.has_words()? || host.valid_match(&text_length, &start, &length)? {
			return Ok(matched);
		}
	}
}

/// Borrowed UTF-16 and classifier capabilities retain dynamic observations and original failures.
pub trait WordBoundaryHost {
	type Value;
	type Error;

	fn number(&self, value: f64) -> Self::Value;
	fn add(&self, first: &Self::Value, second: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn subtract(
		&self,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn equal(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
	fn positive(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn char_code(&self, index: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn classify(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
}

fn left_is_word_boundary<H: WordBoundaryHost>(
	host: &H,
	start: &H::Value,
	length: &H::Value,
) -> Result<bool, H::Error> {
	if host.equal(start, &host.number(0.0))? {
		return Ok(true);
	}
	let before = host.char_code(&host.subtract(start, &host.number(1.0))?)?;
	if !host.equal(&host.classify(&before)?, &host.number(0.0))?
		|| host.equal(&before, &host.number(13.0))?
		|| host.equal(&before, &host.number(10.0))?
	{
		return Ok(true);
	}
	if host.positive(length)? {
		let first = host.char_code(start)?;
		if !host.equal(&host.classify(&first)?, &host.number(0.0))? {
			return Ok(true);
		}
	}
	Ok(false)
}

fn right_is_word_boundary<H: WordBoundaryHost>(
	host: &H,
	text_length: &H::Value,
	start: &H::Value,
	length: &H::Value,
) -> Result<bool, H::Error> {
	if host.equal(&host.add(start, length)?, text_length)? {
		return Ok(true);
	}
	let after = host.char_code(&host.add(start, length)?)?;
	if !host.equal(&host.classify(&after)?, &host.number(0.0))?
		|| host.equal(&after, &host.number(13.0))?
		|| host.equal(&after, &host.number(10.0))?
	{
		return Ok(true);
	}
	if host.positive(length)? {
		let end = host.add(start, length)?;
		let last = host.char_code(&host.subtract(&end, &host.number(1.0))?)?;
		if !host.equal(&host.classify(&last)?, &host.number(0.0))? {
			return Ok(true);
		}
	}
	Ok(false)
}

/// Checks both word edges in order, including line breaks and separators inside a match.
pub fn is_valid_word_match<H: WordBoundaryHost>(
	host: &H,
	text_length: &H::Value,
	start: &H::Value,
	length: &H::Value,
) -> Result<bool, H::Error> {
	Ok(left_is_word_boundary(host, start, length)?
		&& right_is_word_boundary(host, text_length, start, length)?)
}

/// Live line-search capabilities preserve aliased result arrays and original regex/factory calls.
pub trait LineMatchHost {
	type Value;
	type Error;

	fn number(&self, value: f64) -> Self::Value;
	fn add(&self, first: &Self::Value, second: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn negate(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn increment(&self, value: &Self::Value) -> Result<(Self::Value, Self::Value), Self::Error>;
	fn equal(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
	fn at_least(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn word_separators(&self) -> Result<Self::Value, Self::Error>;
	fn capture_matches(&self) -> bool;
	fn simple_search(&self) -> Result<Self::Value, Self::Error>;
	fn search_length(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn text_length(&self) -> Result<Self::Value, Self::Error>;
	fn index_of(
		&self,
		search: &Self::Value,
		index: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn valid_match(
		&self,
		words: &Self::Value,
		text_length: &Self::Value,
		start: &Self::Value,
		length: &Self::Value,
	) -> Result<bool, Self::Error>;
	fn write_literal(
		&self,
		index: &Self::Value,
		start: &Self::Value,
		end: &Self::Value,
	) -> Result<(), Self::Error>;
	fn create_searcher(&self) -> Result<Self::Value, Self::Error>;
	fn reset(&self, searcher: &Self::Value) -> Result<(), Self::Error>;
	fn next(&self, searcher: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn match_start(&self, matched: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn match_length(&self, matched: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn write_regex(
		&self,
		index: &Self::Value,
		start: &Self::Value,
		end: &Self::Value,
		matched: &Self::Value,
	) -> Result<(), Self::Error>;
}

/// Collects one line's matches, enforcing limits only after each accepted result as before.
pub fn collect_line_matches<H: LineMatchHost>(
	host: &H,
	mut count: H::Value,
	delta: &H::Value,
	limit: &H::Value,
) -> Result<H::Value, H::Error> {
	let words = host.word_separators()?;
	if !host.capture_matches() && host.truthy(&host.simple_search()?) {
		let search = host.simple_search()?;
		let length = host.search_length(&search)?;
		let text_length = host.text_length()?;
		let mut last = host.negate(&length)?;
		loop {
			last = host.index_of(&search, &host.add(&last, &length)?)?;
			if host.equal(&last, &host.number(-1.0))? {
				return Ok(count);
			}
			if !host.truthy(&words) || host.valid_match(&words, &text_length, &last, &length)? {
				let (index, next) = host.increment(&count)?;
				count = next;
				let start = host.add(&host.add(&last, &host.number(1.0))?, delta)?;
				let end = host.add(
					&host.add(&host.add(&last, &host.number(1.0))?, &length)?,
					delta,
				)?;
				host.write_literal(&index, &start, &end)?;
				if host.at_least(&count, limit)? {
					return Ok(count);
				}
			}
		}
	}
	let searcher = host.create_searcher()?;
	host.reset(&searcher)?;
	loop {
		let matched = host.next(&searcher)?;
		if !host.truthy(&matched) {
			return Ok(count);
		}
		let (index, next) = host.increment(&count)?;
		count = next;
		let start = host.add(
			&host.add(&host.match_start(&matched)?, &host.number(1.0))?,
			delta,
		)?;
		let end_base = host.add(&host.match_start(&matched)?, &host.number(1.0))?;
		let end = host.add(&host.add(&end_base, &host.match_length(&matched)?)?, delta)?;
		host.write_regex(&index, &start, &end, &matched)?;
		if host.at_least(&count, limit)? {
			return Ok(count);
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::{Cell, RefCell};
	use std::collections::VecDeque;

	struct Words<'a> {
		text: &'a [u16],
		reads: RefCell<Vec<(char, f64)>>,
		fail: bool,
	}
	impl WordBoundaryHost for Words<'_> {
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
		fn equal(&self, first: &f64, second: &f64) -> Result<bool, Self::Error> {
			Ok(first == second)
		}
		fn positive(&self, value: &f64) -> Result<bool, Self::Error> {
			Ok(*value > 0.0)
		}
		fn char_code(&self, index: &f64) -> Result<f64, Self::Error> {
			self.reads.borrow_mut().push(('c', *index));
			Ok(if *index >= 0.0 {
				self.text
					.get(*index as usize)
					.map_or(f64::NAN, |value| f64::from(*value))
			} else {
				f64::NAN
			})
		}
		fn classify(&self, value: &f64) -> Result<f64, Self::Error> {
			self.reads.borrow_mut().push(('w', *value));
			if self.fail {
				return Err("classification");
			}
			Ok(if *value == 32.0 || *value == 45.0 {
				2.0
			} else {
				0.0
			})
		}
	}

	#[test]
	fn word_edges_preserve_line_breaks_internal_separators_and_utf16_coordinates() {
		let cases: &[(&[u16], f64, f64, bool)] = &[
			(&[], 0.0, 0.0, true),
			(&[120], 0.0, 1.0, true),
			(&[120, 120, 120], 1.0, 1.0, false),
			(&[32, 120, 45], 1.0, 1.0, true),
			(&[13, 120, 10], 1.0, 1.0, true),
			(&[120, 45, 120], 1.0, 1.0, true),
			(&[120, 120], 1.0, 0.0, false),
			(&[32, 32], 1.0, 0.0, true),
			(&[32, 0xD83D, 0xDE00, 32], 1.0, 2.0, true),
			(&[0xD83D, 0xDE00], 1.0, 1.0, false),
		];
		for (text, start, length, expected) in cases {
			let host = Words {
				text,
				reads: RefCell::new(Vec::new()),
				fail: false,
			};
			assert_eq!(
				is_valid_word_match(&host, &(text.len() as f64), start, length),
				Ok(*expected)
			);
		}
	}

	#[test]
	fn word_edge_short_circuit_and_classifier_failure_preserve_observation_order() {
		let host = Words {
			text: &[120, 120, 120],
			reads: RefCell::new(Vec::new()),
			fail: false,
		};
		let accepted = is_valid_word_match(&host, &3.0, &1.0, &1.0);
		assert_eq!(
			(accepted, host.reads.into_inner()),
			(
				Ok(false),
				vec![('c', 0.0), ('w', 120.0), ('c', 1.0), ('w', 120.0)]
			)
		);
		let host = Words {
			text: &[13, 120, 10],
			reads: RefCell::new(Vec::new()),
			fail: true,
		};
		let failed = is_valid_word_match(&host, &3.0, &1.0, &1.0);
		assert_eq!(
			(failed, host.reads.into_inner()),
			(Err("classification"), vec![('c', 0.0), ('w', 13.0)])
		);
	}

	#[derive(Debug, PartialEq)]
	enum Value {
		Number(f64),
		Match(f64, f64),
		Null,
	}
	fn numeric(value: &Value) -> f64 {
		if let Value::Number(value) = value {
			*value
		} else {
			unreachable!()
		}
	}
	struct Host {
		matches: RefCell<VecDeque<(f64, f64)>>,
		previous: Cell<(f64, f64)>,
		regex_index: Cell<f64>,
		advances: RefCell<Vec<u32>>,
		writes: RefCell<Vec<char>>,
		words: bool,
		fail_length: bool,
	}
	impl TextSearchHost for Host {
		type Value = Value;
		type Error = &'static str;
		fn number(&self, value: f64) -> Value {
			Value::Number(value)
		}
		fn null(&self) -> Value {
			Value::Null
		}
		fn text_length(&self) -> Result<Value, Self::Error> {
			Ok(Value::Number(5.0))
		}
		fn previous_start(&self) -> Result<Value, Self::Error> {
			Ok(Value::Number(self.previous.get().0))
		}
		fn previous_length(&self) -> Result<Value, Self::Error> {
			Ok(Value::Number(self.previous.get().1))
		}
		fn add(&self, first: &Value, second: &Value) -> Result<Value, Self::Error> {
			Ok(Value::Number(numeric(first) + numeric(second)))
		}
		fn equal(&self, first: &Value, second: &Value) -> Result<bool, Self::Error> {
			Ok(numeric(first) == numeric(second))
		}
		fn exec(&self) -> Result<Value, Self::Error> {
			self.writes.borrow_mut().push('e');
			Ok(
				if let Some((start, length)) = self.matches.borrow_mut().pop_front() {
					self.regex_index.set(start + length);
					Value::Match(start, length)
				} else {
					Value::Null
				},
			)
		}
		fn truthy(&self, value: &Value) -> bool {
			!matches!(value, Value::Null)
		}
		fn match_start(&self, value: &Value) -> Result<Value, Self::Error> {
			if let Value::Match(start, _) = value {
				Ok(Value::Number(*start))
			} else {
				unreachable!()
			}
		}
		fn match_length(&self, value: &Value) -> Result<Value, Self::Error> {
			if let Value::Match(_, length) = value {
				Ok(Value::Number(*length))
			} else {
				unreachable!()
			}
		}
		fn next_code_point(&self, _: &Value) -> Result<Value, Self::Error> {
			Ok(Value::Number(if self.regex_index.get() == 0.0 {
				0x1F600 as f64
			} else {
				120.0
			}))
		}
		fn above_bmp(&self, value: &Value) -> Result<bool, Self::Error> {
			Ok(numeric(value) > 65535.0)
		}
		fn advance(&self, count: u32) -> Result<(), Self::Error> {
			self.regex_index
				.set(self.regex_index.get() + f64::from(count));
			self.advances.borrow_mut().push(count);
			Ok(())
		}
		fn set_previous_start(&self, value: &Value) -> Result<(), Self::Error> {
			self.writes.borrow_mut().push('s');
			self.previous.set((numeric(value), self.previous.get().1));
			Ok(())
		}
		fn set_previous_length(&self, value: &Value) -> Result<(), Self::Error> {
			self.writes.borrow_mut().push('l');
			if self.fail_length {
				return Err("length");
			}
			self.previous.set((self.previous.get().0, numeric(value)));
			Ok(())
		}
		fn has_words(&self) -> Result<bool, Self::Error> {
			Ok(self.words)
		}
		fn valid_match(&self, _: &Value, start: &Value, _: &Value) -> Result<bool, Self::Error> {
			Ok(numeric(start) != 0.0)
		}
		fn reset_regex(&self) -> Result<(), Self::Error> {
			self.writes.borrow_mut().push('r');
			self.regex_index.set(9.0);
			Ok(())
		}
	}
	fn host(matches: &[(f64, f64)]) -> Host {
		Host {
			matches: RefCell::new(matches.iter().copied().collect()),
			previous: Cell::new((-1.0, 0.0)),
			regex_index: Cell::new(0.0),
			advances: RefCell::new(Vec::new()),
			writes: RefCell::new(Vec::new()),
			words: false,
			fail_length: false,
		}
	}

	struct LineCollection {
		host: Host,
		literal: bool,
		captures: bool,
		writes: RefCell<Vec<(f64, f64, f64)>>,
		fail_write: bool,
	}
	impl LineMatchHost for LineCollection {
		type Value = Value;
		type Error = &'static str;
		fn number(&self, value: f64) -> Value {
			Value::Number(value)
		}
		fn add(&self, first: &Value, second: &Value) -> Result<Value, Self::Error> {
			self.host.add(first, second)
		}
		fn negate(&self, value: &Value) -> Result<Value, Self::Error> {
			Ok(Value::Number(-numeric(value)))
		}
		fn increment(&self, value: &Value) -> Result<(Value, Value), Self::Error> {
			Ok((
				Value::Number(numeric(value)),
				Value::Number(numeric(value) + 1.0),
			))
		}
		fn equal(&self, first: &Value, second: &Value) -> Result<bool, Self::Error> {
			self.host.equal(first, second)
		}
		fn at_least(&self, first: &Value, second: &Value) -> Result<bool, Self::Error> {
			Ok(numeric(first) >= numeric(second))
		}
		fn truthy(&self, value: &Value) -> bool {
			self.host.truthy(value)
		}
		fn word_separators(&self) -> Result<Value, Self::Error> {
			Ok(if self.host.words {
				Value::Number(1.0)
			} else {
				Value::Null
			})
		}
		fn capture_matches(&self) -> bool {
			self.captures
		}
		fn simple_search(&self) -> Result<Value, Self::Error> {
			Ok(if self.literal {
				Value::Number(1.0)
			} else {
				Value::Null
			})
		}
		fn search_length(&self, _: &Value) -> Result<Value, Self::Error> {
			Ok(Value::Number(1.0))
		}
		fn text_length(&self) -> Result<Value, Self::Error> {
			self.host.text_length()
		}
		fn index_of(&self, _: &Value, _: &Value) -> Result<Value, Self::Error> {
			Ok(Value::Number(
				self.host
					.matches
					.borrow_mut()
					.pop_front()
					.map_or(-1.0, |entry| entry.0),
			))
		}
		fn valid_match(
			&self,
			_: &Value,
			text_length: &Value,
			start: &Value,
			length: &Value,
		) -> Result<bool, Self::Error> {
			self.host.valid_match(text_length, start, length)
		}
		fn write_literal(
			&self,
			index: &Value,
			start: &Value,
			end: &Value,
		) -> Result<(), Self::Error> {
			self.writes
				.borrow_mut()
				.push((numeric(index), numeric(start), numeric(end)));
			if self.fail_write {
				Err("write")
			} else {
				Ok(())
			}
		}
		fn create_searcher(&self) -> Result<Value, Self::Error> {
			Ok(Value::Null)
		}
		fn reset(&self, _: &Value) -> Result<(), Self::Error> {
			self.host.reset_regex()
		}
		fn next(&self, _: &Value) -> Result<Value, Self::Error> {
			self.host.exec()
		}
		fn match_start(&self, value: &Value) -> Result<Value, Self::Error> {
			self.host.match_start(value)
		}
		fn match_length(&self, value: &Value) -> Result<Value, Self::Error> {
			self.host.match_length(value)
		}
		fn write_regex(
			&self,
			index: &Value,
			start: &Value,
			end: &Value,
			_: &Value,
		) -> Result<(), Self::Error> {
			self.write_literal(index, start, end)
		}
	}
	fn collection(literal: bool, captures: bool, words: bool, fail_write: bool) -> LineCollection {
		LineCollection {
			host: Host {
				words,
				..host(&[(0.0, 1.0), (2.0, 1.0), (4.0, 1.0)])
			},
			literal,
			captures,
			writes: RefCell::new(Vec::new()),
			fail_write,
		}
	}

	#[test]
	fn line_collection_retains_word_filtering_counts_coordinates_and_post_acceptance_limits() {
		let literal = collection(true, false, true, false);
		let count = collect_line_matches(
			&literal,
			Value::Number(2.0),
			&Value::Number(1.0),
			&Value::Number(4.0),
		);
		assert_eq!(
			(
				count,
				literal.writes.into_inner(),
				literal.host.matches.borrow().len()
			),
			(
				Ok(Value::Number(4.0)),
				vec![(2.0, 4.0, 5.0), (3.0, 6.0, 7.0)],
				0
			)
		);
		let regex = collection(true, true, false, false);
		let count = collect_line_matches(
			&regex,
			Value::Number(0.0),
			&Value::Number(0.0),
			&Value::Number(0.0),
		);
		assert_eq!(
			(
				count,
				regex.writes.into_inner(),
				regex.host.matches.borrow().len(),
				regex.host.writes.into_inner()
			),
			(
				Ok(Value::Number(1.0)),
				vec![(0.0, 1.0, 2.0)],
				2,
				vec!['r', 'e']
			)
		);
	}

	#[test]
	fn line_collection_stops_on_result_failure_without_reading_more_matches() {
		for literal in [false, true] {
			let host = collection(literal, false, false, true);
			let count = collect_line_matches(
				&host,
				Value::Number(0.0),
				&Value::Number(0.0),
				&Value::Number(10.0),
			);
			assert_eq!(
				(
					count,
					host.writes.into_inner(),
					host.host.matches.borrow().len()
				),
				(Err("write"), vec![(0.0, 1.0, 2.0)], 2)
			);
		}
	}

	#[test]
	fn repeated_empty_matches_advance_by_utf16_code_point_and_nonempty_duplicates_stop() {
		let host = host(&[(0.0, 0.0), (0.0, 0.0), (2.0, 0.0), (2.0, 0.0), (3.0, 1.0)]);
		let results: Vec<_> = (0..4)
			.map(|_| next_text_search_match(&host).unwrap())
			.collect();
		assert_eq!(
			(results, host.advances.into_inner(), host.previous.get()),
			(
				vec![
					Value::Match(0.0, 0.0),
					Value::Match(2.0, 0.0),
					Value::Match(3.0, 1.0),
					Value::Null
				],
				vec![2, 1],
				(3.0, 1.0)
			)
		);
		let duplicate = super::tests::host(&[(0.0, 1.0), (0.0, 1.0)]);
		assert_eq!(
			(
				next_text_search_match(&duplicate),
				next_text_search_match(&duplicate),
				duplicate.advances.into_inner()
			),
			(Ok(Value::Match(0.0, 1.0)), Ok(Value::Null), vec![])
		);
	}

	#[test]
	fn word_rejection_commits_state_and_reset_failures_preserve_ordered_partial_writes() {
		let filtered = Host {
			words: true,
			..host(&[(0.0, 1.0), (2.0, 1.0)])
		};
		let failing = Host {
			fail_length: true,
			..host(&[(2.0, 1.0)])
		};
		assert_eq!(
			(
				next_text_search_match(&filtered),
				next_text_search_match(&failing),
				failing.previous.get()
			),
			(Ok(Value::Match(2.0, 1.0)), Err("length"), (2.0, 0.0))
		);
		assert_eq!(
			(
				reset_text_search(&failing),
				failing.previous.get(),
				failing.regex_index.get(),
				failing.writes.into_inner()
			),
			(
				Err("length"),
				(-1.0, 0.0),
				9.0,
				vec!['e', 's', 'l', 'r', 's', 'l']
			)
		);
		let ended = host(&[(5.0, 0.0)]);
		ended.previous.set((5.0, 0.0));
		assert_eq!(
			(
				next_text_search_match(&ended),
				ended.matches.borrow().len(),
				ended.writes.into_inner()
			),
			(Ok(Value::Null), 1, vec![])
		);
	}
}
