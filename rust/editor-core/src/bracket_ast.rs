/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket AST construction, metadata, reuse, and mutable-edge control preserve live node contracts.

/// Original node/factory/set capabilities retain reference identity and ordered partial mutation.
pub trait BracketAstHost {
	type Value: Clone;
	type Error;

	fn boolean(&self, value: bool) -> Self::Value;
	fn undefined(&self) -> Self::Value;
	fn receiver(&self) -> Result<Self::Value, Self::Error>;
	fn item(&self, index: f64) -> Result<Self::Value, Self::Error>;
	fn truthy(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn length(&self, node: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn missing(&self, node: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn empty_ids(&self) -> Result<Self::Value, Self::Error>;
	fn add_length(
		&self,
		length: &Self::Value,
		node: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn merge_ids(&self, ids: &Self::Value, node: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn merge_item(&self, ids: &Self::Value, index: f64) -> Result<Self::Value, Self::Error>;
	fn equal_heights(&self, first: &Self::Value, second: &Self::Value)
	-> Result<bool, Self::Error>;
	fn invalid_heights(&self) -> Result<(), Self::Error>;
	fn create_pair(
		&self,
		length: &Self::Value,
		ids: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn create_list(
		&self,
		length: &Self::Value,
		ids: &Self::Value,
		compact: bool,
	) -> Result<Self::Value, Self::Error>;
	fn item_count(&self) -> Result<Self::Value, Self::Error>;
	fn is_zero(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn index_before(&self, index: f64, count: &Self::Value) -> Result<bool, Self::Error>;
	fn empty_list(&self) -> Result<Self::Value, Self::Error>;
	fn throw_if_immutable(&self) -> Result<(), Self::Error>;
	fn child_count(&self, node: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn child(&self, node: &Self::Value, index: f64) -> Result<Self::Value, Self::Error>;
	fn set_length(&self, value: &Self::Value) -> Result<(), Self::Error>;
	fn set_missing(&self, value: &Self::Value) -> Result<(), Self::Error>;
	fn reset_indentation(&self) -> Result<(), Self::Error>;
	fn closing_missing(&self) -> Result<bool, Self::Error>;
	fn intersects_node(&self, node: &Self::Value) -> Result<bool, Self::Error>;
	fn is_list(&self, node: &Self::Value) -> Result<bool, Self::Error>;
	fn invalid_empty_child(&self) -> Result<(), Self::Error>;
	fn edge_child(
		&self,
		node: &Self::Value,
		count: &Self::Value,
		last: bool,
	) -> Result<Self::Value, Self::Error>;
	fn reuse_leaf(&self, node: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn to_mutable(&self, node: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn same(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
	fn set_edge(
		&self,
		count: &Self::Value,
		child: &Self::Value,
		last: bool,
	) -> Result<(), Self::Error>;
}

/// Constructs the original pair after source lengths and missing-set observations.
pub fn create_bracket_pair<H: BracketAstHost>(host: &H) -> Result<H::Value, H::Error> {
	let opening = host.item(0.0)?;
	let mut length = host.length(&opening)?;
	let child = host.item(1.0)?;
	if host.truthy(&child)? {
		length = host.add_length(&length, &child)?;
	}
	let closing = host.item(2.0)?;
	if host.truthy(&closing)? {
		length = host.add_length(&length, &closing)?;
	}
	let ids = if host.truthy(&child)? {
		host.missing(&child)?
	} else {
		host.empty_ids()?
	};
	host.create_pair(&length, &ids)
}

/// Constructs compact or array-backed lists with original height checks and repeated slot reads.
pub fn create_bracket_list<H: BracketAstHost>(
	host: &H,
	compact: bool,
) -> Result<H::Value, H::Error> {
	if !compact {
		let count = host.item_count()?;
		if host.is_zero(&count)? {
			return host.empty_list();
		}
	}
	let first = host.item(0.0)?;
	let mut length = host.length(&first)?;
	let first = host.item(0.0)?;
	let mut ids = host.missing(&first)?;
	if compact {
		let first = host.item(0.0)?;
		let second = host.item(1.0)?;
		if !host.equal_heights(&first, &second)? {
			host.invalid_heights()?;
		}
		let second = host.item(1.0)?;
		length = host.add_length(&length, &second)?;
		let second = host.item(1.0)?;
		ids = host.merge_ids(&ids, &second)?;
		let third = host.item(2.0)?;
		if host.truthy(&third)? {
			let first = host.item(0.0)?;
			if !host.equal_heights(&first, &third)? {
				host.invalid_heights()?;
			}
			length = host.add_length(&length, &third)?;
			ids = host.merge_ids(&ids, &third)?;
		}
	} else {
		let mut index = 1.0;
		loop {
			let count = host.item_count()?;
			if !host.index_before(index, &count)? {
				break;
			}
			let child = host.item(index)?;
			length = host.add_length(&length, &child)?;
			ids = host.merge_item(&ids, index)?;
			index += 1.0;
		}
	}
	host.create_list(&length, &ids, compact)
}

/// Recomputes node metadata before the original ordered field/cache commits.
pub fn update_bracket_children<H: BracketAstHost>(host: &H) -> Result<(), H::Error> {
	host.throw_if_immutable()?;
	let node = host.receiver()?;
	let count = host.child_count(&node)?;
	let first = host.child(&node, 0.0)?;
	let mut length = host.length(&first)?;
	let first = host.child(&node, 0.0)?;
	let mut ids = host.missing(&first)?;
	let mut index = 1.0;
	while host.index_before(index, &count)? {
		let child = host.child(&node, index)?;
		length = host.add_length(&length, &child)?;
		ids = host.merge_ids(&ids, &child)?;
		index += 1.0;
	}
	host.set_length(&length)?;
	host.set_missing(&ids)?;
	host.reset_indentation()
}

/// Decides cache reuse for pair, list, invalid, text, and ordinary bracket nodes.
pub fn reuse_bracket_node<H: BracketAstHost>(host: &H, kind: u32) -> Result<H::Value, H::Error> {
	if kind == 0 {
		return Ok(host.boolean(true));
	}
	if kind == 1 {
		return Ok(host.boolean(false));
	}
	if kind == 2 && host.closing_missing()? {
		return Ok(host.boolean(false));
	}
	let mut node = host.receiver()?;
	if host.intersects_node(&node)? {
		return Ok(host.boolean(false));
	}
	if kind != 4 {
		return Ok(host.boolean(true));
	}
	let count = host.child_count(&node)?;
	if host.is_zero(&count)? {
		return Ok(host.boolean(false));
	}
	while host.is_list(&node)? {
		let count = host.child_count(&node)?;
		if host.is_zero(&count)? {
			host.invalid_empty_child()?;
		}
		node = host.edge_child(&node, &count, true)?;
	}
	host.reuse_leaf(&node)
}

/// Makes one edge mutable while preserving immutable checks, identity shortcuts, and setter order.
pub fn make_bracket_edge_mutable<H: BracketAstHost>(
	host: &H,
	last: bool,
) -> Result<H::Value, H::Error> {
	host.throw_if_immutable()?;
	let node = host.receiver()?;
	let count = host.child_count(&node)?;
	if host.is_zero(&count)? {
		return Ok(host.undefined());
	}
	let child = host.edge_child(&node, &count, last)?;
	let mutable = if host.is_list(&child)? {
		host.to_mutable(&child)?
	} else {
		child.clone()
	};
	if !host.same(&child, &mutable)? {
		host.set_edge(&count, &mutable, last)?;
	}
	Ok(mutable)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::{Cell, RefCell};

	struct Host {
		items: [f64; 3],
		fail_heights: bool,
		fail_reset: bool,
		constructed: Cell<(f64, f64, bool)>,
		metadata: Cell<(f64, f64)>,
		writes: RefCell<Vec<char>>,
	}

	impl BracketAstHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn boolean(&self, value: bool) -> f64 {
			f64::from(value)
		}
		fn undefined(&self) -> f64 {
			0.0
		}
		fn receiver(&self) -> Result<f64, Self::Error> {
			Ok(10.0)
		}
		fn item(&self, index: f64) -> Result<f64, Self::Error> {
			Ok(self.items[index as usize])
		}
		fn truthy(&self, value: &f64) -> Result<bool, Self::Error> {
			Ok(*value != 0.0)
		}
		fn length(&self, node: &f64) -> Result<f64, Self::Error> {
			Ok(*node)
		}
		fn missing(&self, node: &f64) -> Result<f64, Self::Error> {
			Ok(*node)
		}
		fn empty_ids(&self) -> Result<f64, Self::Error> {
			Ok(0.0)
		}
		fn add_length(&self, length: &f64, node: &f64) -> Result<f64, Self::Error> {
			Ok(length + node)
		}
		fn merge_ids(&self, ids: &f64, node: &f64) -> Result<f64, Self::Error> {
			Ok(((*ids as u32) | (*node as u32)) as f64)
		}
		fn merge_item(&self, ids: &f64, index: f64) -> Result<f64, Self::Error> {
			self.merge_ids(ids, &self.items[index as usize])
		}
		fn equal_heights(&self, _: &f64, _: &f64) -> Result<bool, Self::Error> {
			Ok(!self.fail_heights)
		}
		fn invalid_heights(&self) -> Result<(), Self::Error> {
			Err("heights")
		}
		fn create_pair(&self, length: &f64, ids: &f64) -> Result<f64, Self::Error> {
			self.constructed.set((*length, *ids, false));
			Ok(10.0)
		}
		fn create_list(&self, length: &f64, ids: &f64, compact: bool) -> Result<f64, Self::Error> {
			self.constructed.set((*length, *ids, compact));
			Ok(10.0)
		}
		fn item_count(&self) -> Result<f64, Self::Error> {
			Ok(3.0)
		}
		fn is_zero(&self, value: &f64) -> Result<bool, Self::Error> {
			Ok(*value == 0.0)
		}
		fn index_before(&self, index: f64, count: &f64) -> Result<bool, Self::Error> {
			Ok(index < *count)
		}
		fn empty_list(&self) -> Result<f64, Self::Error> {
			Ok(0.0)
		}
		fn throw_if_immutable(&self) -> Result<(), Self::Error> {
			Ok(())
		}
		fn child_count(&self, _: &f64) -> Result<f64, Self::Error> {
			Ok(3.0)
		}
		fn child(&self, _: &f64, index: f64) -> Result<f64, Self::Error> {
			self.item(index)
		}
		fn set_length(&self, value: &f64) -> Result<(), Self::Error> {
			self.metadata.set((*value, self.metadata.get().1));
			self.writes.borrow_mut().push('l');
			Ok(())
		}
		fn set_missing(&self, value: &f64) -> Result<(), Self::Error> {
			self.metadata.set((self.metadata.get().0, *value));
			self.writes.borrow_mut().push('m');
			Ok(())
		}
		fn reset_indentation(&self) -> Result<(), Self::Error> {
			self.writes.borrow_mut().push('c');
			if self.fail_reset {
				Err("cache")
			} else {
				Ok(())
			}
		}
		fn closing_missing(&self) -> Result<bool, Self::Error> {
			Ok(false)
		}
		fn intersects_node(&self, _: &f64) -> Result<bool, Self::Error> {
			Ok(false)
		}
		fn is_list(&self, node: &f64) -> Result<bool, Self::Error> {
			Ok(*node == 10.0)
		}
		fn invalid_empty_child(&self) -> Result<(), Self::Error> {
			Err("empty")
		}
		fn edge_child(&self, _: &f64, count: &f64, last: bool) -> Result<f64, Self::Error> {
			self.item(if last { count - 1.0 } else { 0.0 })
		}
		fn reuse_leaf(&self, _: &f64) -> Result<f64, Self::Error> {
			Ok(0.0)
		}
		fn to_mutable(&self, node: &f64) -> Result<f64, Self::Error> {
			Ok(*node)
		}
		fn same(&self, first: &f64, second: &f64) -> Result<bool, Self::Error> {
			Ok(first == second)
		}
		fn set_edge(&self, _: &f64, _: &f64, _: bool) -> Result<(), Self::Error> {
			unreachable!()
		}
	}

	fn host() -> Host {
		Host {
			items: [1.0, 2.0, 3.0],
			fail_heights: false,
			fail_reset: false,
			constructed: Cell::new((0.0, 0.0, false)),
			metadata: Cell::new((0.0, 0.0)),
			writes: RefCell::new(Vec::new()),
		}
	}

	#[test]
	fn construction_preserves_lengths_missing_ids_and_height_failures() {
		let host = host();
		create_bracket_pair(&host).unwrap();
		assert_eq!(host.constructed.get(), (6.0, 2.0, false));
		for compact in [false, true] {
			create_bracket_list(&host, compact).unwrap();
			assert_eq!(host.constructed.get(), (6.0, 3.0, compact));
		}
		let invalid = Host {
			fail_heights: true,
			..host
		};
		assert_eq!(create_bracket_list(&invalid, true), Err("heights"));
	}

	#[test]
	fn metadata_commits_precede_cache_failures_and_reuse_reaches_the_original_leaf() {
		let host = Host {
			fail_reset: true,
			..host()
		};
		let result = update_bracket_children(&host);
		let reuse = reuse_bracket_node(&host, 4);
		let edge = make_bracket_edge_mutable(&host, true);
		assert_eq!(
			(
				result,
				host.metadata.get(),
				reuse,
				edge,
				host.writes.into_inner()
			),
			(
				Err("cache"),
				(6.0, 3.0),
				Ok(0.0),
				Ok(3.0),
				vec!['l', 'm', 'c']
			)
		);
	}
}
