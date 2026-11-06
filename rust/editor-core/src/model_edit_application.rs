/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Model edit application controls decorations, versions, and original raw/content events.

/// Borrowed buffer/result/event capabilities retain original live properties and method receivers.
pub trait ModelEditApplicationHost {
	type Value: Clone;
	type Error;
	fn undefined(&self) -> Self::Value;
	fn number(&self, value: f64) -> Self::Value;
	fn same(&self, first: &Self::Value, second: &Self::Value) -> bool;
	fn null(&self, value: &Self::Value) -> bool;
	fn line_count(&self) -> Result<Self::Value, Self::Error>;
	fn buffer_method(&self) -> Result<Self::Value, Self::Error>;
	fn trim(&self) -> Result<Self::Value, Self::Error>;
	fn buffer_apply(
		&self,
		method: &Self::Value,
		operations: &Self::Value,
		trim: &Self::Value,
		undo: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn changes(&self, result: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn trim_lines(&self, result: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn store_trim(&self, lines: &Self::Value) -> Result<(), Self::Error>;
	fn length(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn less(&self, index: f64, length: &Self::Value) -> Result<bool, Self::Error>;
	fn change(&self, changes: &Self::Value, index: f64) -> Result<Self::Value, Self::Error>;
	fn replace_method(&self) -> Result<Self::Value, Self::Error>;
	fn change_field(&self, change: &Self::Value, index: u32) -> Result<Self::Value, Self::Error>;
	fn replace(&self, method: &Self::Value, values: &[Self::Value; 4]) -> Result<(), Self::Error>;
	fn raw_changes(&self) -> Result<Self::Value, Self::Error>;
	fn increase_version(&self) -> Result<(), Self::Error>;
	fn eol_count(&self, change: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn decorations_fire(&self) -> Result<(), Self::Error>;
	fn range_line(&self, change: &Self::Value, index: u32) -> Result<Self::Value, Self::Error>;
	fn subtract(
		&self,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn add(&self, first: &Self::Value, second: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn minimum(
		&self,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn at_least_zero(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn decrement(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn below(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
	fn raw_change(
		&self,
		changes: &Self::Value,
		kind: u32,
		first: &Self::Value,
		second: &Self::Value,
		third: &Self::Value,
	) -> Result<(), Self::Error>;
	fn emit_method(&self) -> Result<Self::Value, Self::Error>;
	fn raw_method(&self) -> Result<Self::Value, Self::Error>;
	fn version(&self) -> Result<Self::Value, Self::Error>;
	fn flag(&self, index: u32) -> Result<Self::Value, Self::Error>;
	fn raw_event(
		&self,
		method: &Self::Value,
		changes: &Self::Value,
		version: &Self::Value,
		undo: &Self::Value,
		redo: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn buffer_eol(&self) -> Result<Self::Value, Self::Error>;
	fn content_event(&self, values: &[Self::Value; 7]) -> Result<Self::Value, Self::Error>;
	fn emit(
		&self,
		method: &Self::Value,
		raw: &Self::Value,
		content: &Self::Value,
		selection: &Self::Value,
	) -> Result<(), Self::Error>;
	fn reverse(&self, result: &Self::Value) -> Result<Self::Value, Self::Error>;
}

/// Applies a validated batch and preserves first-pass decoration updates and descending raw events.
pub fn apply_model_edits<H: ModelEditApplicationHost>(
	host: &H,
	operations: &H::Value,
	undo: &H::Value,
	reason: H::Value,
	selection: &H::Value,
) -> Result<H::Value, H::Error> {
	let old_lines = host.line_count()?;
	let method = host.buffer_method()?;
	let result = host.buffer_apply(&method, operations, &host.trim()?, undo)?;
	let new_lines = host.line_count()?;
	let changes = host.changes(&result)?;
	host.store_trim(&host.trim_lines(&result)?)?;
	if !host.same(&host.length(&changes)?, &host.number(0.0)) {
		let length = host.length(&changes)?;
		let mut index = 0.0;
		while host.less(index, &length)? {
			let change = host.change(&changes, index)?;
			let method = host.replace_method()?;
			let offset = host.change_field(&change, 0)?;
			let deleted = host.change_field(&change, 1)?;
			let inserted = host.length(&host.change_field(&change, 2)?)?;
			let markers = host.change_field(&change, 3)?;
			host.replace(&method, &[offset, deleted, inserted, markers])?;
			index += 1.0;
		}
		let raw = host.raw_changes()?;
		host.increase_version()?;
		let mut line_count = old_lines;
		let length = host.length(&changes)?;
		let mut index = 0.0;
		while host.less(index, &length)? {
			let change = host.change(&changes, index)?;
			let inserted = host.eol_count(&change)?;
			host.decorations_fire()?;
			let start = host.range_line(&change, 0)?;
			let end = host.range_line(&change, 1)?;
			let deleted = host.subtract(&end, &start)?;
			let edited = host.minimum(&deleted, &inserted)?;
			let delta = host.subtract(&inserted, &deleted)?;
			let current_start = host.add(
				&host.subtract(&host.subtract(&new_lines, &line_count)?, &delta)?,
				&start,
			)?;
			// The loop decrement retains JavaScript ToNumeric for overridden Math.min results.
			let mut relative = edited.clone();
			while host.at_least_zero(&relative)? {
				let line = host.add(&start, &relative)?;
				let current_line = host.add(&current_start, &relative)?;
				host.raw_change(&raw, 0, &line, &current_line, &host.undefined())?;
				relative = host.decrement(&relative)?;
			}
			if host.below(&edited, &deleted)? {
				let splice = host.add(&start, &edited)?;
				let count = host.subtract(&inserted, &deleted)?;
				let last = host.add(
					&host.subtract(&host.subtract(&new_lines, &line_count)?, &count)?,
					&splice,
				)?;
				host.raw_change(&raw, 1, &host.add(&splice, &host.number(1.0))?, &end, &last)?;
			}
			if host.below(&edited, &inserted)? {
				let splice = host.add(&start, &edited)?;
				let count = host.subtract(&inserted, &edited)?;
				let from = host.add(
					&host.add(
						&host.subtract(&host.subtract(&new_lines, &line_count)?, &count)?,
						&splice,
					)?,
					&host.number(1.0),
				)?;
				host.raw_change(
					&raw,
					2,
					&host.add(&splice, &host.number(1.0))?,
					&from,
					&count,
				)?;
			}
			line_count = host.add(&line_count, &delta)?;
			index += 1.0;
		}
		let method = host.emit_method()?;
		let factory = host.raw_method()?;
		let version = host.version()?;
		let is_undoing = host.flag(0)?;
		let is_redoing = host.flag(1)?;
		let raw = host.raw_event(&factory, &raw, &version, &is_undoing, &is_redoing)?;
		let eol = host.buffer_eol()?;
		let version = host.version()?;
		let is_undoing = host.flag(0)?;
		let is_redoing = host.flag(1)?;
		let length = host.length(&changes)?;
		let content = host.content_event(&[
			changes, eol, version, is_undoing, is_redoing, reason, length,
		])?;
		host.emit(&method, &raw, &content, selection)?;
	}
	if host.null(&host.reverse(&result)?) {
		Ok(host.undefined())
	} else {
		host.reverse(&result)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::{Cell, RefCell};

	struct Change {
		start: f64,
		end: f64,
		inserted: f64,
	}
	struct Host {
		changes: Vec<Change>,
		old_lines: f64,
		new_lines: f64,
		line_reads: Cell<u32>,
		reverse_null: bool,
		failure: Option<&'static str>,
		calls: RefCell<Vec<&'static str>>,
		raw: RefCell<Vec<[f64; 4]>>,
	}
	impl Host {
		fn new(changes: Vec<Change>, old_lines: f64, new_lines: f64) -> Self {
			Self {
				changes,
				old_lines,
				new_lines,
				line_reads: Cell::new(0),
				reverse_null: false,
				failure: None,
				calls: RefCell::new(Vec::new()),
				raw: RefCell::new(Vec::new()),
			}
		}
		fn call(&self, name: &'static str, args: &[f64]) -> Result<f64, &'static str> {
			self.calls.borrow_mut().push(name);
			if self.failure == Some(name) {
				return Err(name);
			}
			Ok(match name {
				"line_count" => {
					let read = self.line_reads.get();
					self.line_reads.set(read + 1);
					if read == 0 {
						self.old_lines
					} else {
						self.new_lines
					}
				}
				"changes" => -3.0,
				"length" => {
					if args[0] == -3.0 {
						self.changes.len() as f64
					} else {
						self.changes[(args[0] - 1000.0) as usize].inserted + 1.0
					}
				}
				"change" => args[1],
				"change_field" => match args[1] as u32 {
					2 => 1000.0 + args[0],
					_ => 0.0,
				},
				"eol_count" => self.changes[args[0] as usize].inserted,
				"range_line" => {
					let change = &self.changes[args[0] as usize];
					if args[1] == 0.0 {
						change.start
					} else {
						change.end
					}
				}
				"raw_change" => {
					self.raw
						.borrow_mut()
						.push([args[1], args[2], args[3], args[4]]);
					0.0
				}
				"reverse" => {
					if self.reverse_null {
						0.0
					} else {
						200.0
					}
				}
				_ => 1.0,
			})
		}
	}
	impl ModelEditApplicationHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn undefined(&self) -> f64 {
			-99.0
		}
		fn number(&self, value: f64) -> f64 {
			value
		}
		fn same(&self, first: &f64, second: &f64) -> bool {
			first == second
		}
		fn null(&self, value: &f64) -> bool {
			*value == 0.0
		}
		fn line_count(&self) -> Result<f64, Self::Error> {
			self.call("line_count", &[])
		}
		fn buffer_method(&self) -> Result<f64, Self::Error> {
			self.call("buffer_method", &[])
		}
		fn trim(&self) -> Result<f64, Self::Error> {
			self.call("trim", &[])
		}
		fn buffer_apply(
			&self,
			method: &f64,
			operations: &f64,
			trim: &f64,
			undo: &f64,
		) -> Result<f64, Self::Error> {
			self.call("buffer_apply", &[*method, *operations, *trim, *undo])
		}
		fn changes(&self, result: &f64) -> Result<f64, Self::Error> {
			self.call("changes", &[*result])
		}
		fn trim_lines(&self, result: &f64) -> Result<f64, Self::Error> {
			self.call("trim_lines", &[*result])
		}
		fn store_trim(&self, lines: &f64) -> Result<(), Self::Error> {
			self.call("store_trim", &[*lines]).map(|_| ())
		}
		fn length(&self, value: &f64) -> Result<f64, Self::Error> {
			self.call("length", &[*value])
		}
		fn less(&self, index: f64, length: &f64) -> Result<bool, Self::Error> {
			self.call("less", &[index, *length])?;
			Ok(index < *length)
		}
		fn change(&self, changes: &f64, index: f64) -> Result<f64, Self::Error> {
			self.call("change", &[*changes, index])
		}
		fn replace_method(&self) -> Result<f64, Self::Error> {
			self.call("replace_method", &[])
		}
		fn change_field(&self, change: &f64, index: u32) -> Result<f64, Self::Error> {
			self.call("change_field", &[*change, f64::from(index)])
		}
		fn replace(&self, method: &f64, values: &[f64; 4]) -> Result<(), Self::Error> {
			self.call(
				"replace",
				&[*method, values[0], values[1], values[2], values[3]],
			)
			.map(|_| ())
		}
		fn raw_changes(&self) -> Result<f64, Self::Error> {
			self.call("raw_changes", &[])
		}
		fn increase_version(&self) -> Result<(), Self::Error> {
			self.call("increase_version", &[]).map(|_| ())
		}
		fn eol_count(&self, change: &f64) -> Result<f64, Self::Error> {
			self.call("eol_count", &[*change])
		}
		fn decorations_fire(&self) -> Result<(), Self::Error> {
			self.call("decorations_fire", &[]).map(|_| ())
		}
		fn range_line(&self, change: &f64, index: u32) -> Result<f64, Self::Error> {
			self.call("range_line", &[*change, f64::from(index)])
		}
		fn subtract(&self, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			self.call("subtract", &[*first, *second])?;
			Ok(*first - *second)
		}
		fn add(&self, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			self.call("add", &[*first, *second])?;
			Ok(*first + *second)
		}
		fn minimum(&self, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			self.call("minimum", &[*first, *second])?;
			Ok(first.min(*second))
		}
		fn at_least_zero(&self, value: &f64) -> Result<bool, Self::Error> {
			self.call("at_least_zero", &[*value])?;
			Ok(*value >= 0.0)
		}
		fn decrement(&self, value: &f64) -> Result<f64, Self::Error> {
			self.call("decrement", &[*value])?;
			Ok(*value - 1.0)
		}
		fn below(&self, first: &f64, second: &f64) -> Result<bool, Self::Error> {
			self.call("below", &[*first, *second])?;
			Ok(*first < *second)
		}
		fn raw_change(
			&self,
			changes: &f64,
			kind: u32,
			first: &f64,
			second: &f64,
			third: &f64,
		) -> Result<(), Self::Error> {
			self.call(
				"raw_change",
				&[*changes, f64::from(kind), *first, *second, *third],
			)
			.map(|_| ())
		}
		fn emit_method(&self) -> Result<f64, Self::Error> {
			self.call("emit_method", &[])
		}
		fn raw_method(&self) -> Result<f64, Self::Error> {
			self.call("raw_method", &[])
		}
		fn version(&self) -> Result<f64, Self::Error> {
			self.call("version", &[])
		}
		fn flag(&self, index: u32) -> Result<f64, Self::Error> {
			self.call("flag", &[f64::from(index)])
		}
		fn raw_event(
			&self,
			method: &f64,
			changes: &f64,
			version: &f64,
			undo: &f64,
			redo: &f64,
		) -> Result<f64, Self::Error> {
			self.call("raw_event", &[*method, *changes, *version, *undo, *redo])
		}
		fn buffer_eol(&self) -> Result<f64, Self::Error> {
			self.call("buffer_eol", &[])
		}
		fn content_event(&self, values: &[f64; 7]) -> Result<f64, Self::Error> {
			self.call("content_event", values)
		}
		fn emit(
			&self,
			method: &f64,
			raw: &f64,
			content: &f64,
			selection: &f64,
		) -> Result<(), Self::Error> {
			self.call("emit", &[*method, *raw, *content, *selection])
				.map(|_| ())
		}
		fn reverse(&self, result: &f64) -> Result<f64, Self::Error> {
			self.call("reverse", &[*result])
		}
	}
	#[test]
	fn multiline_batches_preserve_descending_raw_events_and_running_line_counts() {
		let host = Host::new(
			vec![
				Change {
					start: 3.0,
					end: 4.0,
					inserted: 0.0,
				},
				Change {
					start: 1.0,
					end: 1.0,
					inserted: 2.0,
				},
			],
			4.0,
			5.0,
		);
		assert_eq!(apply_model_edits(&host, &0.0, &0.0, 8.0, &0.0), Ok(200.0));
		assert_eq!(
			*host.raw.borrow(),
			[
				[0.0, 3.0, 5.0, -99.0],
				[1.0, 4.0, 4.0, 5.0],
				[0.0, 1.0, 1.0, -99.0],
				[2.0, 2.0, 2.0, 2.0]
			]
		);
		let calls = host.calls.borrow();
		let first_event = calls.iter().position(|call| *call == "raw_change").unwrap();
		assert_eq!(
			calls[..first_event]
				.iter()
				.filter(|call| **call == "replace")
				.count(),
			2
		);
		assert_eq!(calls.iter().filter(|call| **call == "minimum").count(), 2);
	}
	#[test]
	fn changed_lines_descend_before_remaining_deletion() {
		let host = Host::new(
			vec![Change {
				start: 1.0,
				end: 3.0,
				inserted: 1.0,
			}],
			4.0,
			3.0,
		);
		apply_model_edits(&host, &0.0, &0.0, 8.0, &0.0).unwrap();
		assert_eq!(
			*host.raw.borrow(),
			[
				[0.0, 2.0, 2.0, -99.0],
				[0.0, 1.0, 1.0, -99.0],
				[1.0, 3.0, 3.0, 2.0]
			]
		);
	}
	#[test]
	fn empty_batches_skip_version_events_and_preserve_reverse_double_reads() {
		for reverse_null in [false, true] {
			let mut host = Host::new(vec![], 4.0, 4.0);
			host.reverse_null = reverse_null;
			assert_eq!(
				apply_model_edits(&host, &0.0, &0.0, 8.0, &0.0),
				Ok(if reverse_null { -99.0 } else { 200.0 })
			);
			let calls = host.calls.borrow();
			assert!(!calls.contains(&"increase_version"));
			assert_eq!(
				calls.iter().filter(|call| **call == "reverse").count(),
				if reverse_null { 1 } else { 2 }
			);
		}
	}
	#[test]
	fn application_failures_preserve_trim_assignment_and_partial_version_progress() {
		for failure in ["replace", "eol_count", "emit"] {
			let mut host = Host::new(
				vec![Change {
					start: 1.0,
					end: 1.0,
					inserted: 1.0,
				}],
				2.0,
				3.0,
			);
			host.failure = Some(failure);
			assert_eq!(
				apply_model_edits(&host, &0.0, &0.0, 8.0, &0.0),
				Err(failure)
			);
			let calls = host.calls.borrow();
			assert!(calls.contains(&"store_trim"));
			assert_eq!(calls.contains(&"increase_version"), failure != "replace");
			assert!(!calls.contains(&"reverse"));
		}
	}
}
