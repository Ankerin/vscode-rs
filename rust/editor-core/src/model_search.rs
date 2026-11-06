/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Public model search retains scope aliases, original array operations, and virtual providers.

/// Scoped compatibility values are borrowed without copying ranges, text, or matches.
pub trait ModelSearchHost {
	type Value;
	type Error;
	fn null(&self) -> Self::Value;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn is_null(&self, value: &Self::Value) -> bool;
	fn is_boolean(&self, value: &Self::Value) -> bool;
	fn is_array(&self, value: &Self::Value) -> bool;
	fn number(&self, value: f64) -> Self::Value;
	fn numeric(&self, value: &Self::Value) -> Option<f64>;
	fn assert_alive(&self) -> Result<(), Self::Error>;
	fn singleton(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn every_range(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn validate_ranges(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn full_range(&self) -> Result<Self::Value, Self::Error>;
	fn sort(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn unique(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn is_regex(&self) -> Result<Self::Value, Self::Error>;
	fn no_newline(&self) -> Result<bool, Self::Error>;
	fn parse(&self) -> Result<Self::Value, Self::Error>;
	fn empty(&self) -> Result<Self::Value, Self::Error>;
	fn map_matches(
		&self,
		ranges: &Self::Value,
		data: &Self::Value,
		literal: bool,
	) -> Result<Self::Value, Self::Error>;
	fn flatten(&self, matches: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn validate_start(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn coordinate(&self, value: &Self::Value, index: u32) -> Result<Self::Value, Self::Error>;
	fn subtract(
		&self,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn intersects(
		&self,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn plus(&self, first: &Self::Value, second: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn push(&self, array: &Self::Value, value: &Self::Value) -> Result<(), Self::Error>;
	fn line_count(&self) -> Result<Self::Value, Self::Error>;
	fn max_column(&self, line: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn max_start_column(&self, start: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn range(&self, values: &[Self::Value; 4]) -> Result<Self::Value, Self::Error>;
	fn line_matches(
		&self,
		range: &Self::Value,
		data: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn navigate(&self, start: &Self::Value, previous: bool) -> Result<Self::Value, Self::Error>;
	fn has_matches(&self, matches: &Self::Value) -> Result<bool, Self::Error>;
	fn first_match(&self, matches: &Self::Value) -> Result<Self::Value, Self::Error>;
}

fn difference<H: ModelSearchHost>(
	host: &H,
	first: &H::Value,
	second: &H::Value,
) -> Result<H::Value, H::Error> {
	if let (Some(first), Some(second)) = (host.numeric(first), host.numeric(second)) {
		Ok(host.number(first - second))
	} else {
		host.subtract(first, second)
	}
}

/// Stable array sorting retains line-first short circuits and exceptional numeric coercion.
pub fn compare_model_search_ranges<H: ModelSearchHost>(
	host: &H,
	first: &H::Value,
	second: &H::Value,
) -> Result<H::Value, H::Error> {
	let first_line = host.coordinate(first, 0)?;
	let second_line = host.coordinate(second, 0)?;
	let lines = difference(host, &first_line, &second_line)?;
	if host.truthy(&lines) {
		return Ok(lines);
	}
	let first_column = host.coordinate(first, 1)?;
	let second_column = host.coordinate(second, 1)?;
	difference(host, &first_column, &second_column)
}

/// The original reduce callback merges intersections and emits disjoint predecessor identities.
pub fn merge_model_search_ranges<H: ModelSearchHost>(
	host: &H,
	unique: &H::Value,
	previous: &H::Value,
	current: H::Value,
) -> Result<H::Value, H::Error> {
	if host.truthy(&host.intersects(previous, &current)?) {
		host.plus(previous, &current)
	} else {
		host.push(unique, previous)?;
		Ok(current)
	}
}

fn literal<H: ModelSearchHost>(host: &H) -> Result<bool, H::Error> {
	Ok(!host.truthy(&host.is_regex()?) && host.no_newline()?)
}

/// Validates, sorts, merges, maps, then flattens scopes in the original observable order.
pub fn find_model_matches<H: ModelSearchHost>(
	host: &H,
	scope: H::Value,
) -> Result<H::Value, H::Error> {
	host.assert_alive()?;
	let mut ranges = host.null();
	if !host.is_null(&scope) && !host.is_boolean(&scope) {
		let scopes = if host.is_array(&scope) {
			scope
		} else {
			host.singleton(&scope)?
		};
		if host.truthy(&host.every_range(&scopes)?) {
			ranges = host.validate_ranges(&scopes)?;
		}
	}
	if host.is_null(&ranges) {
		ranges = host.singleton(&host.full_range()?)?;
	}
	let ranges = host.sort(&ranges)?;
	let unique = host.unique(&ranges)?;
	let literal = literal(host)?;
	let data = if literal {
		let data = host.parse()?;
		if !host.truthy(&data) {
			return host.empty();
		}
		data
	} else {
		host.null()
	};
	let matches = host.map_matches(&unique, &data, literal)?;
	host.flatten(&matches)
}

/// Retains literal wraparound and the historical additional forward search invocation.
pub fn navigate_model_match<H: ModelSearchHost>(
	host: &H,
	raw_start: &H::Value,
	previous: bool,
) -> Result<H::Value, H::Error> {
	host.assert_alive()?;
	let start = host.validate_start(raw_start)?;
	if previous || !literal(host)? {
		return host.navigate(&start, previous);
	}
	let data = host.parse()?;
	if !host.truthy(&data) {
		return Ok(host.null());
	}
	let count = host.line_count()?;
	let line = host.coordinate(&start, 2)?;
	let column = host.coordinate(&start, 3)?;
	let end = host.max_column(&count)?;
	let range = host.range(&[line, column, count, end])?;
	let matches = host.line_matches(&range, &data)?;
	host.navigate(&start, false)?;
	if host.has_matches(&matches)? {
		return host.first_match(&matches);
	}
	let line = host.coordinate(&start, 2)?;
	let end = host.max_start_column(&start)?;
	let range = host.range(&[host.number(1.0), host.number(1.0), line, end])?;
	let matches = host.line_matches(&range, &data)?;
	if host.has_matches(&matches)? {
		host.first_match(&matches)
	} else {
		Ok(host.null())
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::{Cell, RefCell};

	#[derive(Default)]
	struct Host {
		trace: RefCell<Vec<&'static str>>,
		reads: Cell<u32>,
		regex: bool,
		parsed: bool,
		intersect: bool,
		found: bool,
		failure: bool,
	}
	impl Host {
		fn record(&self, value: &'static str) {
			self.trace.borrow_mut().push(value);
		}
	}
	impl ModelSearchHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn null(&self) -> f64 {
			-1.0
		}
		fn truthy(&self, value: &f64) -> bool {
			*value != 0.0 && !value.is_nan()
		}
		fn is_null(&self, value: &f64) -> bool {
			*value == -1.0
		}
		fn is_boolean(&self, value: &f64) -> bool {
			*value == -3.0
		}
		fn is_array(&self, value: &f64) -> bool {
			*value == 20.0
		}
		fn number(&self, value: f64) -> f64 {
			value
		}
		fn numeric(&self, value: &f64) -> Option<f64> {
			Some(*value)
		}
		fn assert_alive(&self) -> Result<(), Self::Error> {
			self.record("alive");
			Ok(())
		}
		fn singleton(&self, value: &f64) -> Result<f64, Self::Error> {
			self.record("singleton");
			Ok(*value + 100.0)
		}
		fn every_range(&self, _value: &f64) -> Result<f64, Self::Error> {
			self.record("every");
			Ok(1.0)
		}
		fn validate_ranges(&self, value: &f64) -> Result<f64, Self::Error> {
			self.record("validate");
			Ok(*value)
		}
		fn full_range(&self) -> Result<f64, Self::Error> {
			self.record("full");
			Ok(10.0)
		}
		fn sort(&self, value: &f64) -> Result<f64, Self::Error> {
			self.record("sort");
			Ok(*value)
		}
		fn unique(&self, value: &f64) -> Result<f64, Self::Error> {
			self.record("unique");
			Ok(*value)
		}
		fn is_regex(&self) -> Result<f64, Self::Error> {
			self.record("regex");
			Ok(if self.regex { 1.0 } else { 0.0 })
		}
		fn no_newline(&self) -> Result<bool, Self::Error> {
			self.record("newline");
			Ok(true)
		}
		fn parse(&self) -> Result<f64, Self::Error> {
			self.record("parse");
			Ok(if self.parsed { 30.0 } else { 0.0 })
		}
		fn empty(&self) -> Result<f64, Self::Error> {
			self.record("empty");
			Ok(-2.0)
		}
		fn map_matches(
			&self,
			_ranges: &f64,
			_data: &f64,
			_literal: bool,
		) -> Result<f64, Self::Error> {
			self.record("map");
			Ok(24.0)
		}
		fn flatten(&self, _matches: &f64) -> Result<f64, Self::Error> {
			self.record("flatten");
			Ok(25.0)
		}
		fn validate_start(&self, value: &f64) -> Result<f64, Self::Error> {
			self.record("start");
			Ok(*value)
		}
		fn coordinate(&self, value: &f64, index: u32) -> Result<f64, Self::Error> {
			self.record("coordinate");
			Ok(match index {
				0 => value.floor(),
				1 => (value.fract() * 10.0).round(),
				2 => 2.0,
				_ => 3.0,
			})
		}
		fn subtract(&self, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			Ok(first - second)
		}
		fn intersects(&self, _first: &f64, _second: &f64) -> Result<f64, Self::Error> {
			self.record("intersects");
			Ok(if self.intersect { 1.0 } else { 0.0 })
		}
		fn plus(&self, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			self.record("plus");
			Ok(first + second)
		}
		fn push(&self, _array: &f64, _value: &f64) -> Result<(), Self::Error> {
			self.record("push");
			Ok(())
		}
		fn line_count(&self) -> Result<f64, Self::Error> {
			self.record("count");
			Ok(5.0)
		}
		fn max_column(&self, _line: &f64) -> Result<f64, Self::Error> {
			self.record("max");
			Ok(6.0)
		}
		fn max_start_column(&self, _start: &f64) -> Result<f64, Self::Error> {
			self.record("max-start");
			Ok(4.0)
		}
		fn line_matches(&self, _range: &f64, _data: &f64) -> Result<f64, Self::Error> {
			self.record("line-matches");
			let count = self.reads.get();
			self.reads.set(count + 1);
			Ok(if count == 0 && !self.found { 0.0 } else { 1.0 })
		}
		fn navigate(&self, _start: &f64, previous: bool) -> Result<f64, Self::Error> {
			self.record(if previous { "previous" } else { "next" });
			if self.failure {
				Err("original navigation failure")
			} else {
				Ok(99.0)
			}
		}
		fn has_matches(&self, matches: &f64) -> Result<bool, Self::Error> {
			self.record("has");
			Ok(*matches > 0.0)
		}
		fn first_match(&self, _matches: &f64) -> Result<f64, Self::Error> {
			self.record("first");
			Ok(98.0)
		}
		fn range(&self, values: &[f64; 4]) -> Result<f64, Self::Error> {
			self.record("range");
			if self.reads.get() == 0 {
				assert_eq!(*values, [2.0, 3.0, 5.0, 6.0]);
			} else {
				assert_eq!(*values, [1.0, 1.0, 2.0, 4.0]);
			}
			Ok(50.0)
		}
	}

	#[test]
	fn range_callbacks_preserve_comparison_short_circuits_and_disjoint_identity() {
		let host = Host::default();
		assert_eq!(compare_model_search_ranges(&host, &2.3, &4.1), Ok(-2.0));
		assert_eq!(*host.trace.borrow(), ["coordinate", "coordinate"]);
		host.trace.borrow_mut().clear();
		assert_eq!(compare_model_search_ranges(&host, &2.3, &2.1), Ok(2.0));
		assert_eq!(merge_model_search_ranges(&host, &20.0, &2.3, 4.1), Ok(4.1));
		assert_eq!(
			*host.trace.borrow(),
			[
				"coordinate",
				"coordinate",
				"coordinate",
				"coordinate",
				"intersects",
				"push"
			]
		);
		let host = Host {
			intersect: true,
			..Host::default()
		};
		assert_eq!(merge_model_search_ranges(&host, &20.0, &2.0, 4.0), Ok(6.0));
		assert_eq!(*host.trace.borrow(), ["intersects", "plus"]);
	}

	#[test]
	fn scope_processing_precedes_request_rejection_and_maps_before_flattening() {
		let host = Host::default();
		assert_eq!(find_model_matches(&host, 20.0), Ok(-2.0));
		assert_eq!(
			*host.trace.borrow(),
			[
				"alive", "every", "validate", "sort", "unique", "regex", "newline", "parse",
				"empty"
			]
		);
		let host = Host {
			parsed: true,
			..Host::default()
		};
		assert_eq!(find_model_matches(&host, -1.0), Ok(25.0));
		assert_eq!(
			*host.trace.borrow(),
			[
				"alive",
				"full",
				"singleton",
				"sort",
				"unique",
				"regex",
				"newline",
				"parse",
				"map",
				"flatten"
			]
		);
	}

	#[test]
	fn navigation_preserves_discarded_call_failures_and_wraparound() {
		let host = Host {
			parsed: true,
			failure: true,
			found: true,
			..Host::default()
		};
		assert_eq!(
			navigate_model_match(&host, &40.0, false),
			Err("original navigation failure")
		);
		assert_eq!(host.trace.borrow().last(), Some(&"next"));
		assert!(!host.trace.borrow().contains(&"has"));
		let host = Host {
			parsed: true,
			..Host::default()
		};
		assert_eq!(navigate_model_match(&host, &40.0, false), Ok(98.0));
		assert_eq!(
			*host.trace.borrow(),
			[
				"alive",
				"start",
				"regex",
				"newline",
				"parse",
				"count",
				"coordinate",
				"coordinate",
				"max",
				"range",
				"line-matches",
				"next",
				"has",
				"coordinate",
				"max-start",
				"range",
				"line-matches",
				"has",
				"first"
			]
		);
		let host = Host::default();
		assert_eq!(navigate_model_match(&host, &40.0, true), Ok(99.0));
		assert_eq!(*host.trace.borrow(), ["alive", "start", "previous"]);
	}
}
