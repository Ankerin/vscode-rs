/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Model-range search preserves original line slicing, virtual collectors, and aliased results.

/// Caught collection capabilities retain range/provider observations and original factory calls.
pub trait SearchCollectionHost {
	type Value;
	type Error;
	fn number(&self, value: f64) -> Self::Value;
	fn add(&self, first: &Self::Value, second: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn increment(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn equal(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
	fn below(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
	fn at_least(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn create_result(&self) -> Result<Self::Value, Self::Error>;
	fn start_line(&self) -> Result<Self::Value, Self::Error>;
	fn end_line(&self) -> Result<Self::Value, Self::Error>;
	fn single_line(
		&self,
		result: &Self::Value,
		count: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn first_line(
		&self,
		result: &Self::Value,
		count: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn middle_line(
		&self,
		line: &Self::Value,
		result: &Self::Value,
		count: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn last_line(
		&self,
		result: &Self::Value,
		count: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn prepare_multiline(&self) -> Result<Self::Value, Self::Error>;
	fn reset_multiline(&self) -> Result<(), Self::Error>;
	fn next_multiline(&self, context: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn write_multiline(
		&self,
		context: &Self::Value,
		result: &Self::Value,
		index: f64,
		matched: &Self::Value,
	) -> Result<(), Self::Error>;
}

/// Collects the single-line case or first/middle/last lines with the existing limit semantics.
pub fn collect_search_line_ranges<H: SearchCollectionHost>(
	host: &H,
	limit: &H::Value,
) -> Result<H::Value, H::Error> {
	let result = host.create_result()?;
	let mut count = host.number(0.0);
	if host.equal(&host.start_line()?, &host.end_line()?)? {
		host.single_line(&result, &count)?;
		return Ok(result);
	}
	count = host.first_line(&result, &count)?;
	let mut line = host.add(&host.start_line()?, &host.number(1.0))?;
	while host.below(&line, &host.end_line()?)? && host.below(&count, limit)? {
		count = host.middle_line(&line, &result, &count)?;
		line = host.increment(&line)?;
	}
	if host.below(&count, limit)? {
		host.last_line(&result, &count)?;
	}
	Ok(result)
}

/// Collects over LF-normalized text and checks the result limit after each original factory write.
pub fn collect_search_multiline_range<H: SearchCollectionHost>(
	host: &H,
	limit: &H::Value,
) -> Result<H::Value, H::Error> {
	let context = host.prepare_multiline()?;
	let result = host.create_result()?;
	let mut count = 0.0;
	host.reset_multiline()?;
	loop {
		let matched = host.next_multiline(&context)?;
		if !host.truthy(&matched) {
			return Ok(result);
		}
		let index = count;
		count += 1.0;
		host.write_multiline(&context, &result, index, &matched)?;
		if host.at_least(&host.number(count), limit)? {
			return Ok(result);
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::RefCell;
	use std::collections::VecDeque;
	struct Host {
		single: bool,
		calls: RefCell<Vec<char>>,
		matches: RefCell<VecDeque<f64>>,
		writes: RefCell<Vec<f64>>,
		fail_write: bool,
	}
	impl SearchCollectionHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn number(&self, value: f64) -> f64 {
			value
		}
		fn add(&self, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			Ok(first + second)
		}
		fn increment(&self, value: &f64) -> Result<f64, Self::Error> {
			Ok(value + 1.0)
		}
		fn equal(&self, first: &f64, second: &f64) -> Result<bool, Self::Error> {
			Ok(first == second)
		}
		fn below(&self, first: &f64, second: &f64) -> Result<bool, Self::Error> {
			Ok(first < second)
		}
		fn at_least(&self, first: &f64, second: &f64) -> Result<bool, Self::Error> {
			Ok(first >= second)
		}
		fn truthy(&self, value: &f64) -> bool {
			!value.is_nan()
		}
		fn create_result(&self) -> Result<f64, Self::Error> {
			self.calls.borrow_mut().push('r');
			Ok(0.0)
		}
		fn start_line(&self) -> Result<f64, Self::Error> {
			Ok(1.0)
		}
		fn end_line(&self) -> Result<f64, Self::Error> {
			Ok(if self.single { 1.0 } else { 3.0 })
		}
		fn single_line(&self, _: &f64, count: &f64) -> Result<f64, Self::Error> {
			self.calls.borrow_mut().push('s');
			Ok(count + 1.0)
		}
		fn first_line(&self, _: &f64, count: &f64) -> Result<f64, Self::Error> {
			self.calls.borrow_mut().push('f');
			Ok(count + 1.0)
		}
		fn middle_line(&self, _: &f64, _: &f64, count: &f64) -> Result<f64, Self::Error> {
			self.calls.borrow_mut().push('m');
			Ok(count + 1.0)
		}
		fn last_line(&self, _: &f64, count: &f64) -> Result<f64, Self::Error> {
			self.calls.borrow_mut().push('l');
			Ok(count + 1.0)
		}
		fn prepare_multiline(&self) -> Result<f64, Self::Error> {
			self.calls.borrow_mut().push('p');
			Ok(1.0)
		}
		fn reset_multiline(&self) -> Result<(), Self::Error> {
			self.calls.borrow_mut().push('z');
			Ok(())
		}
		fn next_multiline(&self, _: &f64) -> Result<f64, Self::Error> {
			Ok(self.matches.borrow_mut().pop_front().unwrap_or(f64::NAN))
		}
		fn write_multiline(
			&self,
			_: &f64,
			_: &f64,
			index: f64,
			_: &f64,
		) -> Result<(), Self::Error> {
			self.writes.borrow_mut().push(index);
			if self.fail_write {
				Err("write")
			} else {
				Ok(())
			}
		}
	}
	fn host(single: bool, fail_write: bool) -> Host {
		Host {
			single,
			calls: RefCell::new(Vec::new()),
			matches: RefCell::new(VecDeque::from([1.0, 2.0])),
			writes: RefCell::new(Vec::new()),
			fail_write,
		}
	}
	#[test]
	fn range_collection_preserves_first_line_acceptance_and_middle_last_limit_order() {
		for (single, limit, calls) in [
			(true, 0.0, vec!['r', 's']),
			(false, 0.0, vec!['r', 'f']),
			(false, 2.0, vec!['r', 'f', 'm']),
			(false, 3.0, vec!['r', 'f', 'm', 'l']),
		] {
			let host = host(single, false);
			assert_eq!(
				(
					collect_search_line_ranges(&host, &limit),
					host.calls.into_inner()
				),
				(Ok(0.0), calls)
			);
		}
	}
	#[test]
	fn multiline_collection_retains_prepare_reset_write_order_and_stops_after_errors() {
		for fail in [false, true] {
			let host = host(false, fail);
			assert_eq!(
				(
					collect_search_multiline_range(&host, &0.0),
					host.calls.into_inner(),
					host.writes.into_inner(),
					host.matches.borrow().len()
				),
				(
					if fail { Err("write") } else { Ok(0.0) },
					vec!['p', 'r', 'z'],
					vec![0.0],
					1
				)
			);
		}
	}
}
