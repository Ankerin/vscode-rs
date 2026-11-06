/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Nearest and unmatched bracket searches preserve ordered AST and iterable observations.

/// Original AST, array, and iterator capabilities retain identities and thrown completion.
pub trait BracketSearchHost {
	type Value: Clone;
	type Error;

	fn null(&self) -> Self::Value;
	fn truthy(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn container(&self, node: &Self::Value) -> Result<bool, Self::Error>;
	fn unexpected(&self, node: &Self::Value) -> Result<bool, Self::Error>;
	fn bracket(&self, node: &Self::Value) -> Result<bool, Self::Error>;
	fn found(
		&self,
		node: &Self::Value,
		start: &Self::Value,
		end: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn iterator(&self, node: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn next(&self, iterator: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn done(&self, step: &Self::Value) -> Result<bool, Self::Error>;
	fn step_value(&self, step: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn close(&self, iterator: &Self::Value) -> Result<(), Self::Error>;
	fn end(&self, start: &Self::Value, node: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn before_position(&self, offset: &Self::Value) -> Result<bool, Self::Error>;
	fn position_before(&self, offset: &Self::Value) -> Result<bool, Self::Error>;
	fn find(
		&self,
		node: &Self::Value,
		start: &Self::Value,
		end: &Self::Value,
		before: bool,
	) -> Result<Self::Value, Self::Error>;
	fn lengths(&self) -> Result<Self::Value, Self::Error>;
	fn push_length(
		&self,
		lengths: &Self::Value,
		start: &Self::Value,
		end: &Self::Value,
	) -> Result<(), Self::Error>;
	fn last_index(&self, lengths: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn valid_index(&self, index: &Self::Value) -> Result<bool, Self::Error>;
	fn length_entry(
		&self,
		lengths: &Self::Value,
		index: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn entry_start(&self, entry: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn entry_end(&self, entry: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn indexed_child(
		&self,
		node: &Self::Value,
		index: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn decrement(&self, index: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn opening_ids(&self) -> Result<Self::Value, Self::Error>;
	fn intersects(&self, node: &Self::Value, ids: &Self::Value) -> Result<bool, Self::Error>;
	fn stack(&self, root: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn has_stack(&self, stack: &Self::Value) -> Result<bool, Self::Error>;
	fn pop(&self, stack: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn entry_node(&self, entry: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn entry_offset(&self, entry: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn after_position(&self, offset: &Self::Value) -> Result<bool, Self::Error>;
	fn push_node(
		&self,
		stack: &Self::Value,
		node: &Self::Value,
		offset: &Self::Value,
	) -> Result<(), Self::Error>;
}

/// Runs an iterable body, retaining the original exception if IteratorClose also fails.
fn visit_children<H: BracketSearchHost>(
	host: &H,
	node: &H::Value,
	mut visit: impl FnMut(H::Value) -> Result<Option<H::Value>, H::Error>,
) -> Result<Option<H::Value>, H::Error> {
	let iterator = host.iterator(node)?;
	loop {
		let step = host.next(&iterator)?;
		if host.done(&step)? {
			return Ok(None);
		}
		let child = host.step_value(&step)?;
		match visit(child) {
			Ok(None) => {}
			Ok(result) => {
				host.close(&iterator)?;
				return Ok(result);
			}
			Err(error) => {
				let _ = host.close(&iterator);
				return Err(error);
			}
		}
	}
}

/// Finds the nearest ordinary bracket using the original forward or reverse traversal.
pub fn find_bracket<H: BracketSearchHost>(
	host: &H,
	node: &H::Value,
	start: &H::Value,
	end: &H::Value,
	before: bool,
) -> Result<H::Value, H::Error> {
	if host.container(node)? {
		let mut current = start.clone();
		if before {
			let lengths = host.lengths()?;
			visit_children(host, node, |child| {
				let end = host.end(&current, &child)?;
				host.push_length(&lengths, &current, &end)?;
				current = end;
				Ok(None)
			})?;
			let mut index = host.last_index(&lengths)?;
			while host.valid_index(&index)? {
				let entry = host.length_entry(&lengths, &index)?;
				let start = host.entry_start(&entry)?;
				let end = host.entry_end(&entry)?;
				if host.before_position(&start)? {
					let child = host.indexed_child(node, &index)?;
					let result = host.find(&child, &start, &end, true)?;
					if host.truthy(&result)? {
						return Ok(result);
					}
				}
				index = host.decrement(&index)?;
			}
		} else {
			if let Some(result) = visit_children(host, node, |child| {
				let end = host.end(&current, &child)?;
				if host.position_before(&end)? {
					let result = host.find(&child, &current, &end, false)?;
					if host.truthy(&result)? {
						return Ok(Some(result));
					}
				}
				current = end;
				Ok(None)
			})? {
				return Ok(result);
			}
		}
		return Ok(host.null());
	}
	if host.unexpected(node)? {
		return Ok(host.null());
	}
	if host.bracket(node)? {
		return host.found(node, start, end);
	}
	Ok(host.null())
}

/// Finds a globally unmatched closer at or after the cursor with the original stack order.
pub fn has_unmatched_bracket<H: BracketSearchHost>(
	host: &H,
	root: &H::Value,
) -> Result<bool, H::Error> {
	let ids = host.opening_ids()?;
	if !host.intersects(root, &ids)? {
		return Ok(false);
	}
	let stack = host.stack(root)?;
	while host.has_stack(&stack)? {
		let entry = host.pop(&stack)?;
		let node = host.entry_node(&entry)?;
		let offset = host.entry_offset(&entry)?;
		if host.unexpected(&node)? {
			if host.after_position(&offset)? {
				return Ok(true);
			}
			continue;
		}
		let mut current = offset;
		visit_children(host, &node, |child| {
			let end = host.end(&current, &child)?;
			let after = host.after_position(&end)?;
			let matching = host.intersects(&child, &ids)?;
			if after && matching {
				host.push_node(&stack, &child, &current)?;
			}
			current = end;
			Ok(None)
		})?;
	}
	Ok(false)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::{Cell, RefCell};

	struct Host {
		position: f64,
		next: Cell<usize>,
		lengths: RefCell<Vec<(f64, f64)>>,
		stack: RefCell<Vec<(f64, f64)>>,
		popped: Cell<(f64, f64)>,
		closes: Cell<usize>,
		fail_step: bool,
		fail_found: bool,
		fail_close: bool,
	}

	impl BracketSearchHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn null(&self) -> f64 {
			0.0
		}
		fn truthy(&self, value: &f64) -> Result<bool, Self::Error> {
			Ok(*value != 0.0)
		}
		fn container(&self, node: &f64) -> Result<bool, Self::Error> {
			Ok(*node == 0.0)
		}
		fn unexpected(&self, node: &f64) -> Result<bool, Self::Error> {
			Ok(*node == 3.0)
		}
		fn bracket(&self, node: &f64) -> Result<bool, Self::Error> {
			Ok(*node == 1.0 || *node == 4.0)
		}
		fn found(&self, node: &f64, _: &f64, _: &f64) -> Result<f64, Self::Error> {
			if self.fail_found {
				Err("found")
			} else {
				Ok(*node)
			}
		}
		fn iterator(&self, _: &f64) -> Result<f64, Self::Error> {
			self.next.set(0);
			Ok(0.0)
		}
		fn next(&self, _: &f64) -> Result<f64, Self::Error> {
			if self.fail_step {
				return Err("step");
			}
			let next = self.next.get() + 1;
			self.next.set(next);
			Ok(next as f64)
		}
		fn done(&self, step: &f64) -> Result<bool, Self::Error> {
			Ok(*step > 4.0)
		}
		fn step_value(&self, step: &f64) -> Result<f64, Self::Error> {
			Ok(*step)
		}
		fn close(&self, _: &f64) -> Result<(), Self::Error> {
			self.closes.set(self.closes.get() + 1);
			if self.fail_close {
				Err("close")
			} else {
				Ok(())
			}
		}
		fn end(&self, start: &f64, _: &f64) -> Result<f64, Self::Error> {
			Ok(start + 1.0)
		}
		fn before_position(&self, offset: &f64) -> Result<bool, Self::Error> {
			Ok(*offset < self.position)
		}
		fn position_before(&self, offset: &f64) -> Result<bool, Self::Error> {
			Ok(self.position < *offset)
		}
		fn find(
			&self,
			node: &f64,
			start: &f64,
			end: &f64,
			before: bool,
		) -> Result<f64, Self::Error> {
			find_bracket(self, node, start, end, before)
		}
		fn lengths(&self) -> Result<f64, Self::Error> {
			self.lengths.borrow_mut().clear();
			Ok(0.0)
		}
		fn push_length(&self, _: &f64, start: &f64, end: &f64) -> Result<(), Self::Error> {
			self.lengths.borrow_mut().push((*start, *end));
			Ok(())
		}
		fn last_index(&self, _: &f64) -> Result<f64, Self::Error> {
			Ok(self.lengths.borrow().len() as f64 - 1.0)
		}
		fn valid_index(&self, index: &f64) -> Result<bool, Self::Error> {
			Ok(*index >= 0.0)
		}
		fn length_entry(&self, _: &f64, index: &f64) -> Result<f64, Self::Error> {
			Ok(*index)
		}
		fn entry_start(&self, entry: &f64) -> Result<f64, Self::Error> {
			Ok(self.lengths.borrow()[*entry as usize].0)
		}
		fn entry_end(&self, entry: &f64) -> Result<f64, Self::Error> {
			Ok(self.lengths.borrow()[*entry as usize].1)
		}
		fn indexed_child(&self, _: &f64, index: &f64) -> Result<f64, Self::Error> {
			Ok(index + 1.0)
		}
		fn decrement(&self, index: &f64) -> Result<f64, Self::Error> {
			Ok(index - 1.0)
		}
		fn opening_ids(&self) -> Result<f64, Self::Error> {
			Ok(1.0)
		}
		fn intersects(&self, node: &f64, _: &f64) -> Result<bool, Self::Error> {
			Ok(*node == 0.0 || *node == 3.0)
		}
		fn stack(&self, root: &f64) -> Result<f64, Self::Error> {
			self.stack.borrow_mut().push((*root, 0.0));
			Ok(0.0)
		}
		fn has_stack(&self, _: &f64) -> Result<bool, Self::Error> {
			Ok(!self.stack.borrow().is_empty())
		}
		fn pop(&self, _: &f64) -> Result<f64, Self::Error> {
			self.popped.set(self.stack.borrow_mut().pop().unwrap());
			Ok(0.0)
		}
		fn entry_node(&self, _: &f64) -> Result<f64, Self::Error> {
			Ok(self.popped.get().0)
		}
		fn entry_offset(&self, _: &f64) -> Result<f64, Self::Error> {
			Ok(self.popped.get().1)
		}
		fn after_position(&self, offset: &f64) -> Result<bool, Self::Error> {
			Ok(*offset >= self.position)
		}
		fn push_node(&self, _: &f64, node: &f64, offset: &f64) -> Result<(), Self::Error> {
			self.stack.borrow_mut().push((*node, *offset));
			Ok(())
		}
	}

	fn host(position: f64) -> Host {
		Host {
			position,
			next: Cell::new(0),
			lengths: RefCell::new(Vec::new()),
			stack: RefCell::new(Vec::new()),
			popped: Cell::new((0.0, 0.0)),
			closes: Cell::new(0),
			fail_step: false,
			fail_found: false,
			fail_close: false,
		}
	}

	#[test]
	fn nearest_queries_ignore_unmatched_closers_and_preserve_strict_boundaries() {
		for (position, expected) in [
			(0.0, (0.0, 1.0)),
			(1.0, (1.0, 4.0)),
			(3.0, (1.0, 4.0)),
			(4.0, (4.0, 0.0)),
		] {
			let before = find_bracket(&host(position), &0.0, &0.0, &4.0, true).unwrap();
			let after = find_bracket(&host(position), &0.0, &0.0, &4.0, false).unwrap();
			assert_eq!((before, after), expected);
		}
	}

	#[test]
	fn unmatched_queries_filter_cursor_positions_and_retain_global_orphan_affinity() {
		for (position, expected) in [(0.0, true), (2.0, true), (2.5, false), (4.0, false)] {
			assert_eq!(has_unmatched_bracket(&host(position), &0.0), Ok(expected));
		}
	}

	#[test]
	fn nearest_completion_preserves_iterator_step_body_and_close_errors() {
		for (fail_step, fail_found, fail_close, expected) in [
			(false, false, false, (Ok(1.0), 1)),
			(false, false, true, (Err("close"), 1)),
			(false, true, true, (Err("found"), 1)),
			(true, false, true, (Err("step"), 0)),
		] {
			let host = Host {
				fail_step,
				fail_found,
				fail_close,
				..host(0.0)
			};
			let result = find_bracket(&host, &0.0, &0.0, &4.0, false);
			assert_eq!((result, host.closes.get()), expected);
		}
	}
}
