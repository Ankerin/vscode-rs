/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket pair range queries preserve callback order, optional indentation, and iterable completion.

/// Original query capabilities retain node/map identities and the host's ECMAScript iterable protocol.
pub trait BracketPairCollectionHost {
	type Value: Clone;
	type Error;

	fn boolean(&self, value: bool) -> Self::Value;
	fn number(&self, value: f64) -> Self::Value;
	fn truthy(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn is_pair(&self, node: &Self::Value) -> Result<bool, Self::Error>;
	fn has_levels(&self) -> Result<bool, Self::Error>;
	fn get_level(&self, node: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn is_undefined(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn increment(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn set_level(&self, node: &Self::Value, value: &Self::Value) -> Result<(), Self::Error>;
	fn restore_level(&self, node: &Self::Value, value: &Self::Value) -> Result<(), Self::Error>;
	fn opening_end(
		&self,
		node: &Self::Value,
		start: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn include_indentation(&self) -> Result<bool, Self::Error>;
	fn indentation(
		&self,
		node: &Self::Value,
		start: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn emit_pair(
		&self,
		node: &Self::Value,
		offsets: [&Self::Value; 3],
		level: f64,
		equal: &Self::Value,
		indentation: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn has_child(&self, node: &Self::Value) -> Result<bool, Self::Error>;
	fn child(&self, node: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn end(&self, start: &Self::Value, child: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn in_pair_range(&self, start: &Self::Value, end: &Self::Value) -> Result<bool, Self::Error>;
	fn in_list_range(&self, start: &Self::Value, end: &Self::Value) -> Result<bool, Self::Error>;
	fn collect(
		&self,
		node: &Self::Value,
		start: &Self::Value,
		end: &Self::Value,
		level: f64,
	) -> Result<Self::Value, Self::Error>;
	fn iterator(&self, node: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn next(&self, iterator: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn done(&self, step: &Self::Value) -> Result<bool, Self::Error>;
	fn step_value(&self, step: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn close(&self, iterator: &Self::Value) -> Result<(), Self::Error>;
}

/// Collects all overlapping pairs and preserves early-stop and thrown-completion map state.
pub fn collect_bracket_pairs<H: BracketPairCollectionHost>(
	host: &H,
	node: &H::Value,
	start: &H::Value,
	end: &H::Value,
	level: f64,
) -> Result<H::Value, H::Error> {
	if level > 200.0 {
		return Ok(host.boolean(true));
	}
	let mut result = host.boolean(true);
	if host.is_pair(node)? {
		let mut previous = host.number(0.0);
		if host.has_levels()? {
			let existing = host.get_level(node)?;
			previous = if host.is_undefined(&existing)? {
				host.number(0.0)
			} else {
				existing
			};
			let next = host.increment(&previous)?;
			host.set_level(node, &next)?;
		}
		let opening = host.opening_end(node, start)?;
		let minimum = if host.include_indentation()? {
			host.indentation(node, start)?
		} else {
			host.number(-1.0)
		};
		result = host.emit_pair(node, [start, end, &opening], level, &previous, &minimum)?;
		if host.truthy(&result)? && host.has_child(node)? {
			let child = host.child(node)?;
			let child_end = host.end(&opening, &child)?;
			if host.in_pair_range(&opening, &child_end)? {
				result = host.collect(&child, &opening, &child_end, level + 1.0)?;
				if !host.truthy(&result)? {
					return Ok(host.boolean(false));
				}
			}
		}
		host.restore_level(node, &previous)?;
	} else {
		let mut current = start.clone();
		let iterator = host.iterator(node)?;
		loop {
			// A failed iterator step retains the original thrown completion without another close.
			let step = host.next(&iterator)?;
			if host.done(&step)? {
				break;
			}
			let child = host.step_value(&step)?;
			let visited = (|| {
				let offset = current.clone();
				current = host.end(&current, &child)?;
				if host.in_list_range(&offset, &current)? {
					result = host.collect(&child, &offset, &current, level)?;
					if !host.truthy(&result)? {
						return Ok(false);
					}
				}
				Ok(true)
			})();
			match visited {
				Ok(true) => {}
				Ok(false) => {
					host.close(&iterator)?;
					return Ok(host.boolean(false));
				}
				Err(error) => {
					let _ = host.close(&iterator);
					return Err(error);
				}
			}
		}
	}
	Ok(result)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::{Cell, RefCell};

	struct Host {
		levels: RefCell<[f64; 3]>,
		output: RefCell<Vec<(f64, f64, f64)>>,
		stop: f64,
		step_error: bool,
		body_error: bool,
		close_error: bool,
		closes: Cell<usize>,
	}

	impl BracketPairCollectionHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn boolean(&self, value: bool) -> f64 {
			f64::from(value)
		}
		fn number(&self, value: f64) -> f64 {
			value
		}
		fn truthy(&self, value: &f64) -> Result<bool, Self::Error> {
			Ok(*value != 0.0)
		}
		fn is_pair(&self, node: &f64) -> Result<bool, Self::Error> {
			Ok(*node > 0.0)
		}
		fn has_levels(&self) -> Result<bool, Self::Error> {
			Ok(true)
		}
		fn get_level(&self, node: &f64) -> Result<f64, Self::Error> {
			Ok(self.levels.borrow()[*node as usize])
		}
		fn is_undefined(&self, value: &f64) -> Result<bool, Self::Error> {
			Ok(value.is_nan())
		}
		fn increment(&self, value: &f64) -> Result<f64, Self::Error> {
			Ok(value + 1.0)
		}
		fn set_level(&self, node: &f64, value: &f64) -> Result<(), Self::Error> {
			self.levels.borrow_mut()[*node as usize] = *value;
			Ok(())
		}
		fn restore_level(&self, node: &f64, value: &f64) -> Result<(), Self::Error> {
			self.set_level(node, value)
		}
		fn opening_end(&self, _: &f64, start: &f64) -> Result<f64, Self::Error> {
			Ok(start + 1.0)
		}
		fn include_indentation(&self) -> Result<bool, Self::Error> {
			Ok(true)
		}
		fn indentation(&self, _: &f64, _: &f64) -> Result<f64, Self::Error> {
			Ok(4.0)
		}
		fn emit_pair(
			&self,
			node: &f64,
			_: [&f64; 3],
			level: f64,
			_: &f64,
			indentation: &f64,
		) -> Result<f64, Self::Error> {
			self.output.borrow_mut().push((*node, level, *indentation));
			Ok(f64::from(*node != self.stop))
		}
		fn has_child(&self, node: &f64) -> Result<bool, Self::Error> {
			Ok(*node == 1.0)
		}
		fn child(&self, _: &f64) -> Result<f64, Self::Error> {
			Ok(2.0)
		}
		fn end(&self, start: &f64, _: &f64) -> Result<f64, Self::Error> {
			if self.body_error {
				Err("body")
			} else {
				Ok(start + 3.0)
			}
		}
		fn in_pair_range(&self, _: &f64, _: &f64) -> Result<bool, Self::Error> {
			Ok(true)
		}
		fn in_list_range(&self, _: &f64, _: &f64) -> Result<bool, Self::Error> {
			Ok(true)
		}
		fn collect(
			&self,
			node: &f64,
			start: &f64,
			end: &f64,
			level: f64,
		) -> Result<f64, Self::Error> {
			collect_bracket_pairs(self, node, start, end, level)
		}
		fn iterator(&self, _: &f64) -> Result<f64, Self::Error> {
			Ok(0.0)
		}
		fn next(&self, _: &f64) -> Result<f64, Self::Error> {
			if self.step_error {
				Err("step")
			} else {
				Ok(1.0)
			}
		}
		fn done(&self, _: &f64) -> Result<bool, Self::Error> {
			Ok(false)
		}
		fn step_value(&self, _: &f64) -> Result<f64, Self::Error> {
			Ok(1.0)
		}
		fn close(&self, _: &f64) -> Result<(), Self::Error> {
			self.closes.set(self.closes.get() + 1);
			if self.close_error {
				Err("close")
			} else {
				Ok(())
			}
		}
	}

	fn host(stop: f64) -> Host {
		Host {
			levels: RefCell::new([0.0; 3]),
			output: RefCell::new(Vec::new()),
			stop,
			step_error: false,
			body_error: false,
			close_error: false,
			closes: Cell::new(0),
		}
	}

	#[test]
	fn callback_stop_restores_current_pair_but_not_a_stopped_parent() {
		for (stop, expected) in [
			(1.0, ([0.0, 0.0, 0.0], vec![(1.0, 0.0, 4.0)])),
			(
				2.0,
				([0.0, 1.0, 0.0], vec![(1.0, 0.0, 4.0), (2.0, 1.0, 4.0)]),
			),
		] {
			let host = host(stop);
			let result = collect_bracket_pairs(&host, &1.0, &0.0, &5.0, 0.0).unwrap();
			assert_eq!(
				(result, host.levels.into_inner(), host.output.into_inner()),
				(0.0, expected.0, expected.1)
			);
		}
	}

	#[test]
	fn iterable_completion_preserves_original_errors_and_close_rules() {
		for (step_error, body_error, close_error, expected) in [
			(false, false, false, (Ok(0.0), 1)),
			(false, false, true, (Err("close"), 1)),
			(false, true, true, (Err("body"), 1)),
			(true, false, true, (Err("step"), 0)),
		] {
			let host = Host {
				step_error,
				body_error,
				close_error,
				..host(1.0)
			};
			let result = collect_bracket_pairs(&host, &0.0, &0.0, &5.0, 0.0);
			assert_eq!((result, host.closes.get()), expected);
		}
	}

	#[test]
	fn depth_guard_does_not_touch_nodes_or_iterators() {
		let host = Host {
			step_error: true,
			body_error: true,
			..host(1.0)
		};
		assert_eq!(
			collect_bracket_pairs(&host, &0.0, &0.0, &5.0, 201.0),
			Ok(1.0)
		);
	}
}
