/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket range traversal preserves colorized nesting, tail descent, and callback stop semantics.

/// Original query capabilities retain AST/map identities, ordered field reads, and callback results.
pub trait BracketCollectionHost {
	type Value: Clone;
	type Error;

	fn boolean(&self, value: bool) -> Self::Value;
	fn zero(&self) -> Self::Value;
	fn truthy(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn kind(&self, node: &Self::Value) -> Result<Option<u32>, Self::Error>;
	fn child_count(&self, node: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn index_before(&self, index: f64, count: &Self::Value) -> Result<bool, Self::Error>;
	fn child(&self, node: &Self::Value, index: f64) -> Result<Self::Value, Self::Error>;
	fn end(&self, start: &Self::Value, child: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn in_range(&self, start: &Self::Value, end: &Self::Value) -> Result<bool, Self::Error>;
	fn reaches_end(&self, end: &Self::Value) -> Result<bool, Self::Error>;
	fn is_bracket(&self, node: &Self::Value) -> Result<bool, Self::Error>;
	fn colorize(&self, node: &Self::Value) -> Result<bool, Self::Error>;
	fn has_levels(&self) -> Result<bool, Self::Error>;
	fn get_level(&self, node: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn is_undefined(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn increment(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn add_one(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn set_level(&self, node: &Self::Value, value: &Self::Value) -> Result<(), Self::Error>;
	fn restore_level(&self, node: &Self::Value, value: &Self::Value) -> Result<(), Self::Error>;
	fn has_closing(&self, node: &Self::Value) -> Result<bool, Self::Error>;
	fn collect(
		&self,
		node: &Self::Value,
		start: &Self::Value,
		end: &Self::Value,
		level: f64,
		equal_level: &Self::Value,
		incomplete: bool,
	) -> Result<Self::Value, Self::Error>;
	fn emit_unexpected(
		&self,
		start: &Self::Value,
		end: &Self::Value,
		level: f64,
	) -> Result<Self::Value, Self::Error>;
	fn emit_bracket(
		&self,
		start: &Self::Value,
		end: &Self::Value,
		level: f64,
		equal_level: &Self::Value,
		incomplete: bool,
	) -> Result<Self::Value, Self::Error>;
}

/// Collects the complete colorized bracket range, retaining original depth and tail-descent behavior.
pub fn collect_brackets<H: BracketCollectionHost>(
	host: &H,
	mut node: H::Value,
	mut start: H::Value,
	mut end: H::Value,
	mut level: f64,
	mut equal_level: H::Value,
	incomplete: bool,
) -> Result<H::Value, H::Error> {
	if level > 200.0 {
		return Ok(host.boolean(true));
	}
	'outer: loop {
		match host.kind(&node)? {
			Some(4) => {
				let count = host.child_count(&node)?;
				let mut index = 0.0;
				while host.index_before(index, &count)? {
					let child = host.child(&node, index)?;
					if host.truthy(&child)? {
						end = host.end(&start, &child)?;
						if host.in_range(&start, &end)? {
							if host.reaches_end(&end)? {
								node = child;
								continue 'outer;
							}
							let result =
								host.collect(&child, &start, &end, level, &host.zero(), false)?;
							if !host.truthy(&result)? {
								return Ok(host.boolean(false));
							}
						}
						start = end.clone();
					}
					index += 1.0;
				}
				return Ok(host.boolean(true));
			}
			Some(2) => {
				let colorize = host.colorize(&node)?;
				let mut previous = host.zero();
				if host.has_levels()? {
					let mut existing = host.get_level(&node)?;
					if host.is_undefined(&existing)? {
						existing = host.zero();
					}
					previous = existing;
					if colorize {
						let next = host.increment(&previous)?;
						host.set_level(&node, &next)?;
					}
				}
				let count = host.child_count(&node)?;
				let mut index = 0.0;
				while host.index_before(index, &count)? {
					let child = host.child(&node, index)?;
					if host.truthy(&child)? {
						end = host.end(&start, &child)?;
						if host.in_range(&start, &end)? {
							if host.reaches_end(&end)? && !host.is_bracket(&child)? {
								node = child;
								if colorize {
									level += 1.0;
									equal_level = host.add_one(&previous)?;
								} else {
									equal_level = previous;
								}
								continue 'outer;
							}
							if colorize || !host.is_bracket(&child)? || !host.has_closing(&node)? {
								let next_level = if colorize { level + 1.0 } else { level };
								let next_equal = if colorize {
									host.add_one(&previous)?
								} else {
									previous.clone()
								};
								let incomplete = !host.has_closing(&node)?;
								let result = host.collect(
									&child,
									&start,
									&end,
									next_level,
									&next_equal,
									incomplete,
								)?;
								if !host.truthy(&result)? {
									return Ok(host.boolean(false));
								}
							}
						}
						start = end.clone();
					}
					index += 1.0;
				}
				host.restore_level(&node, &previous)?;
				return Ok(host.boolean(true));
			}
			Some(3) => return host.emit_unexpected(&start, &end, level),
			Some(1) => return host.emit_bracket(&start, &end, level, &equal_level, incomplete),
			Some(0) => return Ok(host.boolean(true)),
			_ => {}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::{Cell, RefCell};
	type EmittedBracket = (f64, f64, f64, f64, bool);

	struct Host {
		level: Cell<f64>,
		stop_after: usize,
		output: RefCell<Vec<EmittedBracket>>,
	}

	impl BracketCollectionHost for Host {
		type Value = f64;
		type Error = ();
		fn boolean(&self, value: bool) -> f64 {
			f64::from(value)
		}
		fn zero(&self) -> f64 {
			0.0
		}
		fn truthy(&self, value: &f64) -> Result<bool, ()> {
			Ok(*value != 0.0)
		}
		fn kind(&self, node: &f64) -> Result<Option<u32>, ()> {
			Ok(Some(match *node as u32 {
				1 => 2,
				2 | 4 => 1,
				_ => 0,
			}))
		}
		fn child_count(&self, _: &f64) -> Result<f64, ()> {
			Ok(3.0)
		}
		fn index_before(&self, index: f64, count: &f64) -> Result<bool, ()> {
			Ok(index < *count)
		}
		fn child(&self, _: &f64, index: f64) -> Result<f64, ()> {
			Ok(index + 2.0)
		}
		fn end(&self, start: &f64, _: &f64) -> Result<f64, ()> {
			Ok(start + 1.0)
		}
		fn in_range(&self, _: &f64, _: &f64) -> Result<bool, ()> {
			Ok(true)
		}
		fn reaches_end(&self, _: &f64) -> Result<bool, ()> {
			Ok(false)
		}
		fn is_bracket(&self, node: &f64) -> Result<bool, ()> {
			Ok(*node == 2.0 || *node == 4.0)
		}
		fn colorize(&self, _: &f64) -> Result<bool, ()> {
			Ok(true)
		}
		fn has_levels(&self) -> Result<bool, ()> {
			Ok(true)
		}
		fn get_level(&self, _: &f64) -> Result<f64, ()> {
			Ok(self.level.get())
		}
		fn is_undefined(&self, value: &f64) -> Result<bool, ()> {
			Ok(value.is_nan())
		}
		fn increment(&self, value: &f64) -> Result<f64, ()> {
			Ok(value + 1.0)
		}
		fn add_one(&self, value: &f64) -> Result<f64, ()> {
			Ok(value + 1.0)
		}
		fn set_level(&self, _: &f64, value: &f64) -> Result<(), ()> {
			self.level.set(*value);
			Ok(())
		}
		fn restore_level(&self, node: &f64, value: &f64) -> Result<(), ()> {
			self.set_level(node, value)
		}
		fn has_closing(&self, _: &f64) -> Result<bool, ()> {
			Ok(true)
		}
		fn collect(
			&self,
			node: &f64,
			start: &f64,
			end: &f64,
			level: f64,
			equal_level: &f64,
			incomplete: bool,
		) -> Result<f64, ()> {
			collect_brackets(self, *node, *start, *end, level, *equal_level, incomplete)
		}
		fn emit_unexpected(&self, _: &f64, _: &f64, _: f64) -> Result<f64, ()> {
			unreachable!()
		}
		fn emit_bracket(
			&self,
			start: &f64,
			end: &f64,
			level: f64,
			equal_level: &f64,
			incomplete: bool,
		) -> Result<f64, ()> {
			self.output.borrow_mut().push((
				*start,
				*end,
				level - 1.0,
				equal_level - 1.0,
				incomplete,
			));
			Ok(f64::from(self.output.borrow().len() < self.stop_after))
		}
	}

	#[test]
	fn collection_preserves_nesting_map_restoration_and_early_stop_partial_state() {
		for stop_after in [1, 3] {
			let host = Host {
				level: Cell::new(f64::NAN),
				stop_after,
				output: RefCell::new(Vec::new()),
			};
			let result = collect_brackets(&host, 1.0, 0.0, 3.0, 0.0, 0.0, false).unwrap();
			let expected = if stop_after == 1 {
				(0.0, 1.0, vec![(0.0, 1.0, 0.0, 0.0, false)])
			} else {
				(
					1.0,
					0.0,
					vec![(0.0, 1.0, 0.0, 0.0, false), (2.0, 3.0, 0.0, 0.0, false)],
				)
			};
			assert_eq!(
				(result, host.level.get(), host.output.into_inner()),
				expected
			);
		}
	}
}
