/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket-tree construction retains the original ordered in-place grouping of equal-height nodes.

/// One original list construction; intermediate groups replace an input slot and the final group returns.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BracketTreeGroup {
	pub target: Option<usize>,
	pub first: usize,
	pub second: usize,
	pub third: Option<usize>,
}

/// Constructs a complete equal-height tree through the existing node factory without a second node index.
pub fn concat_bracket_trees_same_height<N, E, F>(
	length: usize,
	mut create: F,
) -> Result<Option<N>, E>
where
	F: FnMut(BracketTreeGroup) -> Result<N, E>,
{
	if !(2..=262_144).contains(&length) {
		return Ok(None);
	}
	let mut length = length;
	while length > 3 {
		let next_length = length >> 1;
		for index in 0..next_length {
			let first = index << 1;
			create(BracketTreeGroup {
				target: Some(index),
				first,
				second: first + 1,
				third: (first + 3 == length).then_some(first + 2),
			})?;
		}
		length = next_length;
	}
	create(BracketTreeGroup {
		target: None,
		first: 0,
		second: 1,
		third: (length >= 3).then_some(2),
	})
	.map(Some)
}

/// Existing AST capabilities retain host node/array identities and virtual-method side effects.
pub trait BracketTreeHost {
	type Node: Clone;
	type Height;
	type Parents;
	type Error;

	fn null_node(&self) -> Self::Node;
	fn is_end(&self, index: f64) -> Result<bool, Self::Error>;
	fn height_at(&self, index: f64) -> Result<Self::Height, Self::Error>;
	fn matches_height(&self, index: f64, height: &Self::Height) -> Result<bool, Self::Error>;
	fn item(&self, index: f64) -> Result<Self::Node, Self::Error>;
	fn group(&self, start: f64, end: f64) -> Result<Self::Node, Self::Error>;
	fn truthy(&self, node: &Self::Node) -> Result<bool, Self::Error>;
	fn prefer_first(
		&self,
		first: &Self::Node,
		second: &Self::Node,
		next: &Self::Node,
	) -> Result<bool, Self::Error>;
	fn compare_height(
		&self,
		first: &Self::Node,
		second: &Self::Node,
		greater: bool,
	) -> Result<bool, Self::Error>;
	fn create_pair(
		&self,
		first: &Self::Node,
		second: &Self::Node,
	) -> Result<Self::Node, Self::Error>;
	fn to_mutable(&self, node: &Self::Node) -> Result<Self::Node, Self::Error>;
	fn create_parents(&self) -> Result<Self::Parents, Self::Error>;
	fn push_parent(&self, parents: &Self::Parents, node: &Self::Node) -> Result<(), Self::Error>;
	fn parents_last_index(&self, parents: &Self::Parents) -> Result<i64, Self::Error>;
	fn parent_at(&self, parents: &Self::Parents, index: usize) -> Result<Self::Node, Self::Error>;
	fn is_list(&self, node: &Self::Node) -> Result<bool, Self::Error>;
	fn edge_mutable(&self, node: &Self::Node, append: bool) -> Result<Self::Node, Self::Error>;
	fn full_children(&self, node: &Self::Node) -> Result<bool, Self::Error>;
	fn split_child(
		&self,
		parent: &Self::Node,
		carried: &Self::Node,
		append: bool,
	) -> Result<Self::Node, Self::Error>;
	fn add_child(
		&self,
		parent: &Self::Node,
		carried: &Self::Node,
		append: bool,
	) -> Result<(), Self::Error>;
	fn children_changed(&self, parent: &Self::Node) -> Result<(), Self::Error>;
	fn unexpected(&self) -> Self::Error;
}

/// Concatenates all height runs with the original smaller-pair preference and in-place balancing.
pub fn concat_bracket_trees<H: BracketTreeHost>(host: &H) -> Result<H::Node, H::Error> {
	let mut index = 0.0;
	let mut first = read_node(host, &mut index)?;
	let mut second = read_node(host, &mut index)?;
	if !host.truthy(&second)? {
		return Ok(first);
	}
	loop {
		let next = read_node(host, &mut index)?;
		if !host.truthy(&next)? {
			break;
		}
		if host.prefer_first(&first, &second, &next)? {
			first = join(host, &first, &second)?;
			second = next;
		} else {
			second = join(host, &second, &next)?;
		}
	}
	join(host, &first, &second)
}

fn read_node<H: BracketTreeHost>(host: &H, index: &mut f64) -> Result<H::Node, H::Error> {
	if host.is_end(*index)? {
		return Ok(host.null_node());
	}
	let start = *index;
	let height = host.height_at(start)?;
	*index += 1.0;
	while host.matches_height(*index, &height)? {
		*index += 1.0;
	}
	if *index - start >= 2.0 {
		host.group(start, *index)
	} else {
		host.item(start)
	}
}

fn join<H: BracketTreeHost>(
	host: &H,
	first: &H::Node,
	second: &H::Node,
) -> Result<H::Node, H::Error> {
	if host.compare_height(first, second, false)? {
		return host.create_pair(first, second);
	}
	if host.compare_height(first, second, true)? {
		balance(host, first, second, true)
	} else {
		balance(host, second, first, false)
	}
}

fn balance<H: BracketTreeHost>(
	host: &H,
	list: &H::Node,
	inserted: &H::Node,
	append: bool,
) -> Result<H::Node, H::Error> {
	let list = host.to_mutable(list)?;
	let mut current = list.clone();
	let parents = host.create_parents()?;
	while !host.compare_height(inserted, &current, false)? {
		if !host.is_list(&current)? {
			return Err(host.unexpected());
		}
		host.push_parent(&parents, &current)?;
		current = host.edge_mutable(&current, append)?;
	}
	let mut carried = Some(inserted.clone());
	let mut index = host.parents_last_index(&parents)?;
	while index >= 0 {
		let parent = host.parent_at(&parents, index as usize)?;
		if let Some(node) = carried.as_ref() {
			if host.truthy(node)? {
				if host.full_children(&parent)? {
					carried = Some(host.split_child(&parent, node, append)?);
				} else {
					host.add_child(&parent, node, append)?;
					carried = None;
				}
			} else {
				host.children_changed(&parent)?;
			}
		} else {
			host.children_changed(&parent)?;
		}
		index -= 1;
	}
	if let Some(carried) = carried
		&& host.truthy(&carried)?
	{
		return if append {
			host.create_pair(&list, &carried)
		} else {
			host.create_pair(&carried, &list)
		};
	}
	Ok(list)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn construction_keeps_group_order_odd_tail_and_callback_failures() {
		let mut groups = Vec::new();
		let result = concat_bracket_trees_same_height(7, |group| {
			groups.push(group);
			Ok::<_, ()>(group.target)
		})
		.unwrap();
		assert_eq!(result, Some(None));
		assert_eq!(
			groups,
			vec![
				BracketTreeGroup {
					target: Some(0),
					first: 0,
					second: 1,
					third: None
				},
				BracketTreeGroup {
					target: Some(1),
					first: 2,
					second: 3,
					third: None
				},
				BracketTreeGroup {
					target: Some(2),
					first: 4,
					second: 5,
					third: Some(6)
				},
				BracketTreeGroup {
					target: None,
					first: 0,
					second: 1,
					third: Some(2)
				},
			]
		);
		let mut calls = 0;
		assert_eq!(
			concat_bracket_trees_same_height(8, |_| {
				calls += 1;
				if calls == 2 {
					Err("factory failure")
				} else {
					Ok(())
				}
			}),
			Err("factory failure")
		);
		assert_eq!(calls, 2);
		assert_eq!(
			concat_bracket_trees_same_height(262_145, |_| Ok::<_, ()>(())),
			Ok(None)
		);
	}
}
