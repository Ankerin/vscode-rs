/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Public search dispatch and multiline navigation preserve original virtual/provider ordering.

/// Selects the original public search operation without changing its result shape.
pub enum SearchDispatchOperation {
	All,
	Next,
	Previous,
}

/// Search requests, regex flags, searcher factories, and virtual collectors stay live and caught.
pub trait SearchDispatchHost {
	type Value;
	type Error;
	fn null(&self) -> Self::Value;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn empty_result(&self) -> Result<Self::Value, Self::Error>;
	fn parse(&self) -> Result<Self::Value, Self::Error>;
	fn multiline(&self, data: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn create_searcher(&self, data: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn all_multiline(&self, data: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn all_lines(&self, data: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn next_multiline(&self, searcher: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn next_lines(&self, searcher: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn previous_multiline(&self, searcher: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn previous_lines(&self, searcher: &Self::Value) -> Result<Self::Value, Self::Error>;
}

/// Preserves parsing and the different flag/factory order for collection versus navigation.
pub fn dispatch_text_search<H: SearchDispatchHost>(
	host: &H,
	operation: SearchDispatchOperation,
) -> Result<H::Value, H::Error> {
	let data = host.parse()?;
	if !host.truthy(&data) {
		return if matches!(operation, SearchDispatchOperation::All) {
			host.empty_result()
		} else {
			Ok(host.null())
		};
	}
	if matches!(operation, SearchDispatchOperation::All) {
		return if host.truthy(&host.multiline(&data)?) {
			host.all_multiline(&data)
		} else {
			host.all_lines(&data)
		};
	}
	let searcher = host.create_searcher(&data)?;
	let multiline = host.truthy(&host.multiline(&data)?);
	match operation {
		SearchDispatchOperation::Next => {
			if multiline {
				host.next_multiline(&searcher)
			} else {
				host.next_lines(&searcher)
			}
		}
		SearchDispatchOperation::Previous => {
			if multiline {
				host.previous_multiline(&searcher)
			} else {
				host.previous_lines(&searcher)
			}
		}
		SearchDispatchOperation::All => unreachable!(),
	}
}

/// Original multiline contexts, matches, model positions, and virtual retries remain caught.
pub trait MultilineNavigationHost {
	type Value;
	type Error;
	fn null(&self) -> Self::Value;
	fn number(&self, value: f64) -> Self::Value;
	fn equal(&self, first: &Self::Value, second: &Self::Value) -> bool;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn prepare_forward(&self) -> Result<Self::Value, Self::Error>;
	fn reset_forward(&self) -> Result<(), Self::Error>;
	fn next_forward(&self, context: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn forward_match(
		&self,
		context: &Self::Value,
		matched: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn start_line(&self) -> Result<Self::Value, Self::Error>;
	fn start_column(&self) -> Result<Self::Value, Self::Error>;
	fn retry_forward(&self) -> Result<Self::Value, Self::Error>;
	fn previous_matches(&self) -> Result<Self::Value, Self::Error>;
	fn length(&self, matches: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn positive(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn last_match(&self, matches: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn line_count(&self) -> Result<Self::Value, Self::Error>;
	fn max_column(&self, count: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn retry_previous(&self, count: &Self::Value) -> Result<Self::Value, Self::Error>;
}

/// Searches the current suffix and retries from the top only when the original coordinates allow.
pub fn next_multiline_search_match<H: MultilineNavigationHost>(
	host: &H,
) -> Result<H::Value, H::Error> {
	let context = host.prepare_forward()?;
	host.reset_forward()?;
	let matched = host.next_forward(&context)?;
	if host.truthy(&matched) {
		return host.forward_match(&context, &matched);
	}
	if !host.equal(&host.start_line()?, &host.number(1.0))
		|| !host.equal(&host.start_column()?, &host.number(1.0))
	{
		return host.retry_forward();
	}
	Ok(host.null())
}

/// Selects the previous range's last result or retries against the complete model once.
pub fn previous_multiline_search_match<H: MultilineNavigationHost>(
	host: &H,
) -> Result<H::Value, H::Error> {
	let matches = host.previous_matches()?;
	if host.positive(&host.length(&matches)?)? {
		return host.last_match(&matches);
	}
	let count = host.line_count()?;
	if !host.equal(&host.start_line()?, &count) {
		return host.retry_previous(&count);
	}
	let column = host.start_column()?;
	let max = host.max_column(&count)?;
	if !host.equal(&column, &max) {
		return host.retry_previous(&count);
	}
	Ok(host.null())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::RefCell;
	struct Host {
		valid: bool,
		multiline: bool,
		hit: bool,
		start: f64,
		column: f64,
		fail: bool,
		calls: RefCell<Vec<char>>,
	}
	impl Host {
		fn event(&self, event: char, value: f64) -> Result<f64, &'static str> {
			self.calls.borrow_mut().push(event);
			Ok(value)
		}
	}
	impl SearchDispatchHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn null(&self) -> f64 {
			-1.0
		}
		fn truthy(&self, value: &f64) -> bool {
			*value >= 0.0
		}
		fn empty_result(&self) -> Result<f64, Self::Error> {
			self.event('e', 0.0)
		}
		fn parse(&self) -> Result<f64, Self::Error> {
			self.event('p', if self.valid { 1.0 } else { -1.0 })
		}
		fn multiline(&self, _: &f64) -> Result<f64, Self::Error> {
			self.event('m', if self.multiline { 1.0 } else { -1.0 })
		}
		fn create_searcher(&self, _: &f64) -> Result<f64, Self::Error> {
			self.event('s', 2.0)
		}
		fn all_multiline(&self, _: &f64) -> Result<f64, Self::Error> {
			self.event('A', 42.0)
		}
		fn all_lines(&self, _: &f64) -> Result<f64, Self::Error> {
			self.event('a', 42.0)
		}
		fn next_multiline(&self, _: &f64) -> Result<f64, Self::Error> {
			self.event('N', 42.0)
		}
		fn next_lines(&self, _: &f64) -> Result<f64, Self::Error> {
			self.event('n', 42.0)
		}
		fn previous_multiline(&self, _: &f64) -> Result<f64, Self::Error> {
			self.event('B', 42.0)
		}
		fn previous_lines(&self, _: &f64) -> Result<f64, Self::Error> {
			self.event('b', 42.0)
		}
	}
	impl MultilineNavigationHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn null(&self) -> f64 {
			-1.0
		}
		fn number(&self, value: f64) -> f64 {
			value
		}
		fn equal(&self, first: &f64, second: &f64) -> bool {
			first == second
		}
		fn truthy(&self, value: &f64) -> bool {
			*value >= 0.0
		}
		fn prepare_forward(&self) -> Result<f64, Self::Error> {
			self.event('p', 10.0)?;
			if self.fail { Err("prepare") } else { Ok(10.0) }
		}
		fn reset_forward(&self) -> Result<(), Self::Error> {
			self.event('r', 0.0)?;
			Ok(())
		}
		fn next_forward(&self, _: &f64) -> Result<f64, Self::Error> {
			self.event('x', if self.hit { 11.0 } else { -1.0 })
		}
		fn forward_match(&self, _: &f64, _: &f64) -> Result<f64, Self::Error> {
			self.event('f', 42.0)
		}
		fn start_line(&self) -> Result<f64, Self::Error> {
			self.event('g', self.start)
		}
		fn start_column(&self) -> Result<f64, Self::Error> {
			self.event('c', self.column)
		}
		fn retry_forward(&self) -> Result<f64, Self::Error> {
			self.event('F', 99.0)
		}
		fn previous_matches(&self) -> Result<f64, Self::Error> {
			self.event('v', 22.0)
		}
		fn length(&self, _: &f64) -> Result<f64, Self::Error> {
			self.event('L', if self.hit { 2.0 } else { 0.0 })
		}
		fn positive(&self, value: &f64) -> Result<bool, Self::Error> {
			Ok(*value > 0.0)
		}
		fn last_match(&self, _: &f64) -> Result<f64, Self::Error> {
			self.event('h', 42.0)
		}
		fn line_count(&self) -> Result<f64, Self::Error> {
			self.event('C', 3.0)
		}
		fn max_column(&self, _: &f64) -> Result<f64, Self::Error> {
			self.event('M', 2.0)
		}
		fn retry_previous(&self, _: &f64) -> Result<f64, Self::Error> {
			self.event('B', 99.0)
		}
	}
	fn host() -> Host {
		Host {
			valid: true,
			multiline: true,
			hit: false,
			start: 1.0,
			column: 1.0,
			fail: false,
			calls: RefCell::new(Vec::new()),
		}
	}
	#[test]
	fn public_dispatch_preserves_collection_and_navigation_factory_order() {
		for (operation, calls) in [
			(SearchDispatchOperation::All, vec!['p', 'm', 'A']),
			(SearchDispatchOperation::Next, vec!['p', 's', 'm', 'N']),
			(SearchDispatchOperation::Previous, vec!['p', 's', 'm', 'B']),
		] {
			let host = host();
			assert_eq!(
				(
					dispatch_text_search(&host, operation),
					host.calls.into_inner()
				),
				(Ok(42.0), calls)
			);
		}
	}
	#[test]
	fn invalid_requests_retain_array_versus_null_shapes_without_more_provider_calls() {
		for (operation, result, calls) in [
			(SearchDispatchOperation::All, 0.0, vec!['p', 'e']),
			(SearchDispatchOperation::Next, -1.0, vec!['p']),
			(SearchDispatchOperation::Previous, -1.0, vec!['p']),
		] {
			let host = Host {
				valid: false,
				..host()
			};
			assert_eq!(
				(
					dispatch_text_search(&host, operation),
					host.calls.into_inner()
				),
				(Ok(result), calls)
			);
		}
	}
	#[test]
	fn forward_multiline_navigation_preserves_acceptance_wrap_and_provider_failure_order() {
		for (hit, start, fail, result, calls) in [
			(true, 1.0, false, Ok(42.0), vec!['p', 'r', 'x', 'f']),
			(false, 1.0, false, Ok(-1.0), vec!['p', 'r', 'x', 'g', 'c']),
			(false, 2.0, false, Ok(99.0), vec!['p', 'r', 'x', 'g', 'F']),
			(false, 1.0, true, Err("prepare"), vec!['p']),
		] {
			let host = Host {
				hit,
				start,
				fail,
				..host()
			};
			assert_eq!(
				(next_multiline_search_match(&host), host.calls.into_inner()),
				(result, calls)
			);
		}
	}
	#[test]
	fn previous_multiline_navigation_preserves_last_selection_and_short_circuit_coordinates() {
		for (hit, start, column, result, calls) in [
			(true, 1.0, 1.0, 42.0, vec!['v', 'L', 'h']),
			(false, 2.0, 1.0, 99.0, vec!['v', 'L', 'C', 'g', 'B']),
			(false, 3.0, 2.0, -1.0, vec!['v', 'L', 'C', 'g', 'c', 'M']),
		] {
			let host = Host {
				hit,
				start,
				column,
				..host()
			};
			assert_eq!(
				(
					previous_multiline_search_match(&host),
					host.calls.into_inner()
				),
				(Ok(result), calls)
			);
		}
	}
}
