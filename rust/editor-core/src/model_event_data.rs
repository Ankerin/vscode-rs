/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Model event merging retains ordered flags, array aliases, virtual methods, and factory identities.

/// Existing event properties, array concat methods, and event factories remain borrowed and caught.
pub trait ModelEventDataHost {
	type Value;
	type Error;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn get(&self, event: &Self::Value, index: u32) -> Result<Self::Value, Self::Error>;
	fn empty(&self) -> Result<Self::Value, Self::Error>;
	fn concat_method(&self, array: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn concat(&self, method: &Self::Value, input: &Self::Value)
	-> Result<Self::Value, Self::Error>;
	fn raw(&self, values: &[Self::Value; 4]) -> Result<Self::Value, Self::Error>;
	fn content(&self, values: &[Self::Value; 9]) -> Result<Self::Value, Self::Error>;
	fn merge_method(&self, raw: bool) -> Result<Self::Value, Self::Error>;
	fn internal_field(&self, event: &Self::Value, raw: bool) -> Result<Self::Value, Self::Error>;
	fn merge(
		&self,
		method: &Self::Value,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn internal(
		&self,
		raw: &Self::Value,
		content: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn length(&self, array: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn less(&self, index: f64, length: &Self::Value) -> Result<bool, Self::Error>;
	fn change_type(&self, event: &Self::Value, index: f64) -> Result<Self::Value, Self::Error>;
	fn same(&self, first: &Self::Value, second: &Self::Value) -> bool;
}

fn flag<H: ModelEventDataHost>(
	host: &H,
	first: &H::Value,
	second: &H::Value,
	index: u32,
	and: bool,
) -> Result<H::Value, H::Error> {
	let value = host.get(first, index)?;
	if host.truthy(&value) == and {
		host.get(second, index)
	} else {
		Ok(value)
	}
}

fn changes<H: ModelEventDataHost>(
	host: &H,
	first: &H::Value,
	second: &H::Value,
) -> Result<H::Value, H::Error> {
	let array = host.empty()?;
	let method = host.concat_method(&array)?;
	let array = host.concat(&method, &host.get(first, 0)?)?;
	let method = host.concat_method(&array)?;
	host.concat(&method, &host.get(second, 0)?)
}

/// Merges raw changes and flags using the original version and constructor semantics.
pub fn merge_raw_model_events<H: ModelEventDataHost>(
	host: &H,
	first: &H::Value,
	second: &H::Value,
) -> Result<H::Value, H::Error> {
	let changes = changes(host, first, second)?;
	let version = host.get(second, 1)?;
	let undo = flag(host, first, second, 2, false)?;
	let redo = flag(host, first, second, 3, false)?;
	host.raw(&[changes, version, undo, redo])
}

/// Retains merged content object property order and two independent reason concat calls.
pub fn merge_model_content_data<H: ModelEventDataHost>(
	host: &H,
	first: &H::Value,
	second: &H::Value,
) -> Result<H::Value, H::Error> {
	let changes = changes(host, first, second)?;
	let eol = host.get(second, 4)?;
	let version = host.get(second, 1)?;
	let undo = flag(host, first, second, 2, false)?;
	let redo = flag(host, first, second, 3, false)?;
	let flush = flag(host, first, second, 5, false)?;
	let eol_change = flag(host, first, second, 6, true)?;
	let method = host.concat_method(&host.get(first, 7)?)?;
	let reasons = host.concat(&method, &host.get(second, 7)?)?;
	let method = host.concat_method(&host.get(first, 8)?)?;
	let lengths = host.concat(&method, &host.get(second, 8)?)?;
	host.content(&[
		changes, eol, eol_change, version, undo, redo, flush, reasons, lengths,
	])
}

/// Captures each virtual static merge method before reading its original event arguments.
pub fn merge_internal_model_events<H: ModelEventDataHost>(
	host: &H,
	first: &H::Value,
	second: &H::Value,
) -> Result<H::Value, H::Error> {
	let method = host.merge_method(true)?;
	let a = host.internal_field(first, true)?;
	let b = host.internal_field(second, true)?;
	let raw = host.merge(&method, &a, &b)?;
	let method = host.merge_method(false)?;
	let a = host.internal_field(first, false)?;
	let b = host.internal_field(second, false)?;
	let content = host.merge(&method, &a, &b)?;
	host.internal(&raw, &content)
}

/// Scans original live changes while retaining a single initial length observation.
pub fn contains_raw_model_event<H: ModelEventDataHost>(
	host: &H,
	event: &H::Value,
	change_type: &H::Value,
) -> Result<bool, H::Error> {
	let length = host.length(&host.get(event, 0)?)?;
	let mut index = 0.0;
	while host.less(index, &length)? {
		if host.same(&host.change_type(event, index)?, change_type) {
			return Ok(true);
		}
		index += 1.0;
	}
	Ok(false)
}

#[cfg(test)]
mod line_end_tests {
	use super::*;
	use std::cell::RefCell;

	struct Host {
		start: f64,
		count: f64,
		failure: Option<&'static str>,
		trace: RefCell<Vec<&'static str>>,
	}
	impl Host {
		fn read(&self, name: &'static str, value: f64) -> Result<f64, &'static str> {
			self.trace.borrow_mut().push(name);
			if self.failure == Some(name) {
				Err(name)
			} else {
				Ok(value)
			}
		}
	}
	impl InsertedModelLineEndHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn start(&self) -> Result<f64, Self::Error> {
			self.read("start", self.start)
		}
		fn count(&self) -> Result<f64, Self::Error> {
			self.read("count", self.count)
		}
		fn add(&self, start: &f64, count: &f64) -> Result<f64, Self::Error> {
			self.read("add", start + count)
		}
		fn minus_one(&self, value: &f64) -> Result<f64, Self::Error> {
			self.read("minusOne", value - 1.0)
		}
	}
	#[test]
	fn endpoints_retain_float_arithmetic_and_field_before_operator_order() {
		for (start, count) in [(1.0, 3.0), (-2.5, 7.25), (f64::INFINITY, 0.0), (-0.0, -0.0)] {
			let host = Host {
				start,
				count,
				failure: None,
				trace: RefCell::new(Vec::new()),
			};
			assert_eq!(inserted_model_line_end(&host), Ok(start + count - 1.0));
			assert_eq!(*host.trace.borrow(), ["start", "count", "add", "minusOne"]);
		}
	}
	#[test]
	fn endpoint_failures_skip_later_fields_and_operators() {
		for (index, failure) in ["start", "count", "add", "minusOne"]
			.into_iter()
			.enumerate()
		{
			let host = Host {
				start: 1.0,
				count: 3.0,
				failure: Some(failure),
				trace: RefCell::new(Vec::new()),
			};
			assert_eq!(inserted_model_line_end(&host), Err(failure));
			assert_eq!(
				*host.trace.borrow(),
				["start", "count", "add", "minusOne"][..=index]
			);
		}
	}
}

/// Original getters and arithmetic preserve exceptional JavaScript value behavior.
pub trait InsertedModelLineEndHost {
	type Value;
	type Error;
	fn start(&self) -> Result<Self::Value, Self::Error>;
	fn count(&self) -> Result<Self::Value, Self::Error>;
	fn add(&self, start: &Self::Value, count: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn minus_one(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
}

/// Reads both insertion fields before arithmetic, retaining getter/coercion order.
pub fn inserted_model_line_end<H: InsertedModelLineEndHost>(
	host: &H,
) -> Result<H::Value, H::Error> {
	let start = host.start()?;
	let count = host.count()?;
	host.minus_one(&host.add(&start, &count)?)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::RefCell;
	#[derive(Default)]
	struct Host {
		reads: RefCell<Vec<(f64, u32)>>,
		result: RefCell<Vec<f64>>,
		actions: RefCell<Vec<&'static str>>,
	}
	impl ModelEventDataHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn truthy(&self, value: &f64) -> bool {
			*value != 0.0 && !value.is_nan()
		}
		fn get(&self, event: &f64, index: u32) -> Result<f64, Self::Error> {
			self.reads.borrow_mut().push((*event, index));
			Ok(match index {
				2 => {
					if *event == 1.0 {
						1.0
					} else {
						88.0
					}
				}
				3 => {
					if *event == 1.0 {
						0.0
					} else {
						9.0
					}
				}
				5 => {
					if *event == 1.0 {
						0.0
					} else {
						7.0
					}
				}
				6 => {
					if *event == 1.0 {
						0.0
					} else {
						1.0
					}
				}
				_ => event * 100.0 + f64::from(index),
			})
		}
		fn empty(&self) -> Result<f64, Self::Error> {
			Ok(0.0)
		}
		fn concat_method(&self, array: &f64) -> Result<f64, Self::Error> {
			Ok(*array)
		}
		fn concat(&self, method: &f64, input: &f64) -> Result<f64, Self::Error> {
			Ok(method + input)
		}
		fn raw(&self, values: &[f64; 4]) -> Result<f64, Self::Error> {
			self.result.borrow_mut().extend(values);
			Ok(900.0)
		}
		fn content(&self, values: &[f64; 9]) -> Result<f64, Self::Error> {
			self.result.borrow_mut().extend(values);
			Ok(900.0)
		}
		fn merge_method(&self, raw: bool) -> Result<f64, Self::Error> {
			self.actions
				.borrow_mut()
				.push(if raw { "raw-method" } else { "content-method" });
			Ok(if raw { 1.0 } else { 2.0 })
		}
		fn internal_field(&self, event: &f64, raw: bool) -> Result<f64, Self::Error> {
			self.actions
				.borrow_mut()
				.push(if raw { "raw-field" } else { "content-field" });
			Ok(event * 10.0 + if raw { 1.0 } else { 2.0 })
		}
		fn merge(&self, method: &f64, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			self.actions.borrow_mut().push("merge");
			Ok(method + first + second)
		}
		fn internal(&self, raw: &f64, content: &f64) -> Result<f64, Self::Error> {
			Ok(raw + content)
		}
		fn length(&self, _array: &f64) -> Result<f64, Self::Error> {
			Ok(3.0)
		}
		fn less(&self, index: f64, length: &f64) -> Result<bool, Self::Error> {
			Ok(index < *length)
		}
		fn change_type(&self, _event: &f64, index: f64) -> Result<f64, Self::Error> {
			self.actions.borrow_mut().push("type");
			Ok(index + 1.0)
		}
		fn same(&self, first: &f64, second: &f64) -> bool {
			first == second
		}
	}
	#[test]
	fn merging_preserves_flag_short_circuits_and_content_field_order() {
		let host = Host::default();
		merge_raw_model_events(&host, &1.0, &2.0).unwrap();
		assert_eq!(*host.result.borrow(), [300.0, 201.0, 1.0, 9.0]);
		assert!(!host.reads.borrow().contains(&(2.0, 2)));
		let host = Host::default();
		merge_model_content_data(&host, &1.0, &2.0).unwrap();
		assert_eq!(
			*host.result.borrow(),
			[300.0, 204.0, 0.0, 201.0, 1.0, 9.0, 7.0, 314.0, 316.0]
		);
		assert!(!host.reads.borrow().contains(&(2.0, 6)));
	}
	#[test]
	fn internal_merge_captures_methods_before_fields_and_contains_stops_at_first_type() {
		let host = Host::default();
		assert_eq!(merge_internal_model_events(&host, &1.0, &2.0), Ok(69.0));
		assert_eq!(
			*host.actions.borrow(),
			[
				"raw-method",
				"raw-field",
				"raw-field",
				"merge",
				"content-method",
				"content-field",
				"content-field",
				"merge"
			]
		);
		let host = Host::default();
		assert_eq!(contains_raw_model_event(&host, &1.0, &2.0), Ok(true));
		assert_eq!(*host.reads.borrow(), [(1.0, 0)]);
		assert_eq!(*host.actions.borrow(), ["type", "type"]);
	}
}
