/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket AST indentation preserves recursive providers, cached state, and line-read ordering.

/// Original node/model capabilities preserve virtual callbacks, scalar values, and cache writes.
pub trait BracketIndentationHost {
	type Value: Clone;
	type Error;

	fn maximum(&self) -> Result<Self::Value, Self::Error>;
	fn pair_has_child(&self) -> Result<bool, Self::Error>;
	fn pair_compute(&self, offset: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn cache_uncomputed(&self) -> Result<bool, Self::Error>;
	fn cached(&self) -> Result<Self::Value, Self::Error>;
	fn index_before_count(&self, index: f64) -> Result<bool, Self::Error>;
	fn child(&self, index: f64) -> Result<Self::Value, Self::Error>;
	fn truthy(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn minimum_child(
		&self,
		current: &Self::Value,
		child: &Self::Value,
		offset: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn end(&self, offset: &Self::Value, child: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn set_cached(&self, value: &Self::Value) -> Result<(), Self::Error>;
	fn start_line(&self, offset: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn end_line(&self, offset: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn line_before_end(&self, line: &Self::Value, end: &Self::Value) -> Result<bool, Self::Error>;
	fn first_column(&self, line: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn line_content(&self, line: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn is_zero(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn visible_column(
		&self,
		content: &Self::Value,
		first: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn minimum(
		&self,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn increment(&self, line: &Self::Value) -> Result<Self::Value, Self::Error>;
}

/// Computes pair indentation while retaining repeated child reads and method-before-argument order.
pub fn pair_bracket_indentation<H: BracketIndentationHost>(
	host: &H,
	offset: &H::Value,
) -> Result<H::Value, H::Error> {
	if host.pair_has_child()? {
		host.pair_compute(offset)
	} else {
		host.maximum()
	}
}

/// Computes and caches list indentation only after the complete original traversal succeeds.
pub fn list_bracket_indentation<H: BracketIndentationHost>(
	host: &H,
	offset: &H::Value,
) -> Result<H::Value, H::Error> {
	if !host.cache_uncomputed()? {
		return host.cached();
	}
	let mut minimum = host.maximum()?;
	let mut offset = offset.clone();
	let mut index = 0.0;
	while host.index_before_count(index)? {
		let child = host.child(index)?;
		if host.truthy(&child)? {
			minimum = host.minimum_child(&minimum, &child, &offset)?;
			offset = host.end(&offset, &child)?;
		}
		index += 1.0;
	}
	host.set_cached(&minimum)?;
	Ok(minimum)
}

/// Scans complete text-node lines, preserving blank-line content reads and original model callbacks.
pub fn text_bracket_indentation<H: BracketIndentationHost>(
	host: &H,
	offset: &H::Value,
) -> Result<H::Value, H::Error> {
	let mut line = host.start_line(offset)?;
	let end = host.end_line(offset)?;
	let mut minimum = host.maximum()?;
	while host.line_before_end(&line, &end)? {
		let first = host.first_column(&line)?;
		let content = host.line_content(&line)?;
		if !host.is_zero(&first)? {
			let visible = host.visible_column(&content, &first)?;
			minimum = host.minimum(&minimum, &visible)?;
		}
		line = host.increment(&line)?;
	}
	Ok(minimum)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::{Cell, RefCell};

	struct Host {
		cached: Cell<f64>,
		fail_child: bool,
		observations: RefCell<Vec<(char, f64)>>,
	}

	impl BracketIndentationHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn maximum(&self) -> Result<f64, Self::Error> {
			Ok(9_007_199_254_740_991.0)
		}
		fn pair_has_child(&self) -> Result<bool, Self::Error> {
			Ok(true)
		}
		fn pair_compute(&self, offset: &f64) -> Result<f64, Self::Error> {
			Ok(offset + 5.0)
		}
		fn cache_uncomputed(&self) -> Result<bool, Self::Error> {
			Ok(self.cached.get() == -1.0)
		}
		fn cached(&self) -> Result<f64, Self::Error> {
			Ok(self.cached.get())
		}
		fn index_before_count(&self, index: f64) -> Result<bool, Self::Error> {
			Ok(index < 4.0)
		}
		fn child(&self, index: f64) -> Result<f64, Self::Error> {
			Ok(if index == 2.0 { 0.0 } else { index + 1.0 })
		}
		fn truthy(&self, value: &f64) -> Result<bool, Self::Error> {
			Ok(*value != 0.0)
		}
		fn minimum_child(
			&self,
			current: &f64,
			child: &f64,
			offset: &f64,
		) -> Result<f64, Self::Error> {
			self.observations.borrow_mut().push(('c', *offset));
			if self.fail_child && *child == 2.0 {
				return Err("child");
			}
			Ok(current.min(*child))
		}
		fn end(&self, offset: &f64, _: &f64) -> Result<f64, Self::Error> {
			Ok(offset + 1.0)
		}
		fn set_cached(&self, value: &f64) -> Result<(), Self::Error> {
			self.cached.set(*value);
			Ok(())
		}
		fn start_line(&self, offset: &f64) -> Result<f64, Self::Error> {
			Ok(offset + 1.0)
		}
		fn end_line(&self, _: &f64) -> Result<f64, Self::Error> {
			Ok(3.0)
		}
		fn line_before_end(&self, line: &f64, end: &f64) -> Result<bool, Self::Error> {
			Ok(*line <= *end)
		}
		fn first_column(&self, line: &f64) -> Result<f64, Self::Error> {
			self.observations.borrow_mut().push(('f', *line));
			Ok(if *line == 1.0 { 0.0 } else { *line })
		}
		fn line_content(&self, line: &f64) -> Result<f64, Self::Error> {
			self.observations.borrow_mut().push(('l', *line));
			Ok(*line)
		}
		fn is_zero(&self, value: &f64) -> Result<bool, Self::Error> {
			Ok(*value == 0.0)
		}
		fn visible_column(&self, content: &f64, _: &f64) -> Result<f64, Self::Error> {
			self.observations.borrow_mut().push(('v', *content));
			Ok(5.0 - content)
		}
		fn minimum(&self, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			Ok(first.min(*second))
		}
		fn increment(&self, line: &f64) -> Result<f64, Self::Error> {
			Ok(line + 1.0)
		}
	}

	fn host(fail_child: bool) -> Host {
		Host {
			cached: Cell::new(-1.0),
			fail_child,
			observations: RefCell::new(Vec::new()),
		}
	}

	#[test]
	fn list_indentation_keeps_sparse_offsets_cache_hits_and_failed_cache_state() {
		for (failure, expected) in [
			(
				false,
				(Ok(1.0), 1.0, vec![('c', 0.0), ('c', 1.0), ('c', 2.0)]),
			),
			(true, (Err("child"), -1.0, vec![('c', 0.0), ('c', 1.0)])),
		] {
			let host = host(failure);
			let result = list_bracket_indentation(&host, &0.0);
			if !failure {
				assert_eq!(list_bracket_indentation(&host, &99.0), result);
			}
			assert_eq!(
				(result, host.cached.get(), host.observations.into_inner()),
				expected
			);
		}
	}

	#[test]
	fn text_indentation_reads_blank_content_and_preserves_line_provider_order() {
		let host = host(false);
		let result = text_bracket_indentation(&host, &0.0);
		assert_eq!(
			(result, host.observations.into_inner()),
			(
				Ok(2.0),
				vec![
					('f', 1.0),
					('l', 1.0),
					('f', 2.0),
					('l', 2.0),
					('v', 2.0),
					('f', 3.0),
					('l', 3.0),
					('v', 3.0)
				]
			)
		);
	}
}
