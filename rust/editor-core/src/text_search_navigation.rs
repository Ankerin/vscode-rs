/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! First/last line matches and wrapped model search retain existing providers and virtual methods.

/// Original searchers, model lines, virtual methods, and factories stay live and caught.
pub trait SearchNavigationHost {
	type Value;
	type Error;
	fn number(&self, value: f64) -> Self::Value;
	fn null(&self) -> Self::Value;
	fn add(&self, first: &Self::Value, second: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn subtract(
		&self,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn remainder(
		&self,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn at_most(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn line_count(&self) -> Result<Self::Value, Self::Error>;
	fn start_line(&self) -> Result<Self::Value, Self::Error>;
	fn line(&self, number: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn first_at_start(
		&self,
		text: &Self::Value,
		line: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn first(&self, text: &Self::Value, line: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn prefix_at_start(&self, text: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn last(&self, text: &Self::Value, line: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn reset_from_column(&self) -> Result<(), Self::Error>;
	fn reset_start(&self) -> Result<(), Self::Error>;
	fn next(&self) -> Result<Self::Value, Self::Error>;
	fn match_start(&self, matched: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn match_length(&self, matched: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn make_match(
		&self,
		start: &Self::Value,
		end: &Self::Value,
		matched: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
}

fn make_match<H: SearchNavigationHost>(host: &H, matched: &H::Value) -> Result<H::Value, H::Error> {
	let start = host.add(&host.match_start(matched)?, &host.number(1.0))?;
	let end_base = host.add(&host.match_start(matched)?, &host.number(1.0))?;
	let end = host.add(&end_base, &host.match_length(matched)?)?;
	host.make_match(&start, &end, matched)
}

/// Resolves the first line match after the original column-relative reset.
pub fn first_search_match_in_line<H: SearchNavigationHost>(host: &H) -> Result<H::Value, H::Error> {
	host.reset_from_column()?;
	let matched = host.next()?;
	if host.truthy(&matched) {
		make_match(host, &matched)
	} else {
		Ok(host.null())
	}
}

/// Retains the last accepted match and exact factory observations for every preceding match.
pub fn last_search_match_in_line<H: SearchNavigationHost>(host: &H) -> Result<H::Value, H::Error> {
	let mut best = host.null();
	host.reset_start()?;
	loop {
		let matched = host.next()?;
		if !host.truthy(&matched) {
			return Ok(best);
		}
		best = make_match(host, &matched)?;
	}
}

/// Visits the starting line and then wraps forward through each model line once.
pub fn next_search_match_line_by_line<H: SearchNavigationHost>(
	host: &H,
) -> Result<H::Value, H::Error> {
	let count = host.line_count()?;
	let start = host.start_line()?;
	let text = host.line(&start)?;
	let matched = host.first_at_start(&text, &start)?;
	if host.truthy(&matched) {
		return Ok(matched);
	}
	let mut index = 1.0;
	while host.at_most(&host.number(index), &count)? {
		let line_index = host.remainder(
			&host.subtract(&host.add(&start, &host.number(index))?, &host.number(1.0))?,
			&count,
		)?;
		let line = host.add(&line_index, &host.number(1.0))?;
		let text = host.line(&line)?;
		let matched = host.first(&text, &host.add(&line_index, &host.number(1.0))?)?;
		if host.truthy(&matched) {
			return Ok(matched);
		}
		index += 1.0;
	}
	Ok(host.null())
}

/// Visits the starting prefix and then wraps backward through each complete line once.
pub fn previous_search_match_line_by_line<H: SearchNavigationHost>(
	host: &H,
) -> Result<H::Value, H::Error> {
	let count = host.line_count()?;
	let start = host.start_line()?;
	let text = host.line(&start)?;
	let prefix = host.prefix_at_start(&text)?;
	let matched = host.last(&prefix, &start)?;
	if host.truthy(&matched) {
		return Ok(matched);
	}
	let mut index = 1.0;
	while host.at_most(&host.number(index), &count)? {
		let before = host.subtract(&host.add(&count, &start)?, &host.number(index))?;
		let line_index = host.remainder(&host.subtract(&before, &host.number(1.0))?, &count)?;
		let text = host.line(&host.add(&line_index, &host.number(1.0))?)?;
		let matched = host.last(&text, &host.add(&line_index, &host.number(1.0))?)?;
		if host.truthy(&matched) {
			return Ok(matched);
		}
		index += 1.0;
	}
	Ok(host.null())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::RefCell;
	use std::collections::VecDeque;
	struct Host {
		start: f64,
		target: f64,
		lines: RefCell<Vec<f64>>,
		matches: RefCell<VecDeque<f64>>,
		factories: RefCell<Vec<(f64, f64)>>,
		fail_line: bool,
	}
	impl SearchNavigationHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn number(&self, value: f64) -> f64 {
			value
		}
		fn null(&self) -> f64 {
			f64::NAN
		}
		fn add(&self, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			Ok(first + second)
		}
		fn subtract(&self, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			Ok(first - second)
		}
		fn remainder(&self, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			Ok(first % second)
		}
		fn at_most(&self, first: &f64, second: &f64) -> Result<bool, Self::Error> {
			Ok(first <= second)
		}
		fn truthy(&self, value: &f64) -> bool {
			!value.is_nan()
		}
		fn line_count(&self) -> Result<f64, Self::Error> {
			Ok(3.0)
		}
		fn start_line(&self) -> Result<f64, Self::Error> {
			Ok(self.start)
		}
		fn line(&self, number: &f64) -> Result<f64, Self::Error> {
			self.lines.borrow_mut().push(*number);
			if self.fail_line {
				Err("line")
			} else {
				Ok(*number)
			}
		}
		fn first_at_start(&self, _: &f64, _: &f64) -> Result<f64, Self::Error> {
			Ok(f64::NAN)
		}
		fn first(&self, _: &f64, line: &f64) -> Result<f64, Self::Error> {
			Ok(if *line == self.target {
				*line
			} else {
				f64::NAN
			})
		}
		fn prefix_at_start(&self, _: &f64) -> Result<f64, Self::Error> {
			Ok(0.0)
		}
		fn last(&self, text: &f64, line: &f64) -> Result<f64, Self::Error> {
			if *text == 0.0 {
				Ok(f64::NAN)
			} else {
				self.first(text, line)
			}
		}
		fn reset_from_column(&self) -> Result<(), Self::Error> {
			Ok(())
		}
		fn reset_start(&self) -> Result<(), Self::Error> {
			Ok(())
		}
		fn next(&self) -> Result<f64, Self::Error> {
			Ok(self.matches.borrow_mut().pop_front().unwrap_or(f64::NAN))
		}
		fn match_start(&self, matched: &f64) -> Result<f64, Self::Error> {
			Ok(matched - 1.0)
		}
		fn match_length(&self, _: &f64) -> Result<f64, Self::Error> {
			Ok(2.0)
		}
		fn make_match(&self, start: &f64, end: &f64, _: &f64) -> Result<f64, Self::Error> {
			self.factories.borrow_mut().push((*start, *end));
			Ok(*end)
		}
	}
	fn host(start: f64) -> Host {
		Host {
			start,
			target: 2.0,
			lines: RefCell::new(Vec::new()),
			matches: RefCell::new(VecDeque::from([1.0, 4.0])),
			factories: RefCell::new(Vec::new()),
			fail_line: false,
		}
	}
	#[test]
	fn next_and_previous_queries_preserve_wrapped_line_order_and_provider_failures() {
		let next = host(3.0);
		let previous = host(1.0);
		let failed = Host {
			fail_line: true,
			..host(2.0)
		};
		assert_eq!(
			(
				next_search_match_line_by_line(&next),
				previous_search_match_line_by_line(&previous),
				next_search_match_line_by_line(&failed),
				next.lines.into_inner(),
				previous.lines.into_inner(),
				failed.lines.into_inner()
			),
			(
				Ok(2.0),
				Ok(2.0),
				Err("line"),
				vec![3.0, 1.0, 2.0],
				vec![1.0, 3.0, 2.0],
				vec![2.0]
			)
		);
	}
	#[test]
	fn first_and_last_queries_keep_factory_order_and_match_coordinates() {
		let first = host(1.0);
		let last = host(1.0);
		assert_eq!(
			(
				first_search_match_in_line(&first),
				last_search_match_in_line(&last),
				first.factories.into_inner(),
				last.factories.into_inner()
			),
			(
				Ok(3.0),
				Ok(6.0),
				vec![(1.0, 3.0)],
				vec![(1.0, 3.0), (4.0, 6.0)]
			)
		);
	}
}
