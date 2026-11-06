/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Longest-node cache traversal retains live AST/cursor state and original predicate side effects.

/// Existing reader capabilities retain ordered host reads, predicate calls, and partially updated stacks.
pub trait BracketNodeReaderHost {
	type Node: Clone;
	type Offset;
	type Index;
	type Error;

	fn undefined_node(&self) -> Self::Node;
	fn first_index(&self) -> Self::Index;
	fn current_node(&self) -> Result<Self::Node, Self::Error>;
	fn current_offset(&self) -> Result<Self::Offset, Self::Error>;
	fn truthy(&self, node: &Self::Node) -> Result<bool, Self::Error>;
	fn offset_before(
		&self,
		first: &Self::Offset,
		second: &Self::Offset,
	) -> Result<bool, Self::Error>;
	fn end_before(
		&self,
		node: &Self::Node,
		current: &Self::Offset,
		requested: &Self::Offset,
	) -> Result<bool, Self::Error>;
	fn predicate(&self, node: &Self::Node) -> Result<bool, Self::Error>;
	fn advance(&self) -> Result<(), Self::Error>;
	fn increment_index(&self, index: &Self::Index) -> Result<Self::Index, Self::Error>;
	fn index_at_end(&self, node: &Self::Node, index: &Self::Index) -> Result<bool, Self::Error>;
	fn child_exists(&self, node: &Self::Node, index: &Self::Index) -> Result<bool, Self::Error>;
	fn missing_index(&self, index: &Self::Index) -> Result<bool, Self::Error>;
	fn descend(
		&self,
		node: &Self::Node,
		offset: &Self::Offset,
		index: &Self::Index,
	) -> Result<(), Self::Error>;
	fn pop_current(&self) -> Result<(), Self::Error>;
	fn no_parents(&self) -> Result<bool, Self::Error>;
	fn last_child_index(&self) -> Result<Self::Index, Self::Error>;
	fn move_to_child(
		&self,
		parent: &Self::Node,
		current: &Self::Node,
		offset: &Self::Offset,
		index: &Self::Index,
	) -> Result<(), Self::Error>;
	fn pop_parent(&self) -> Result<(), Self::Error>;
}

/// Finds the longest accepted node, preserving the original ahead/inside/exact-offset traversal.
pub fn read_longest_bracket_node<H: BracketNodeReaderHost>(
	host: &H,
	requested: &H::Offset,
) -> Result<H::Node, H::Error> {
	loop {
		let node = host.current_node()?;
		if !host.truthy(&node)? {
			return Ok(host.undefined_node());
		}
		let current = host.current_offset()?;
		if host.offset_before(requested, &current)? {
			return Ok(host.undefined_node());
		}
		if host.offset_before(&current, requested)? {
			if host.end_before(&node, &current, requested)? {
				host.advance()?;
			} else if let Some(index) = next_child_index(host, &node, host.first_index())? {
				host.descend(&node, &current, &index)?;
			} else {
				host.advance()?;
			}
		} else {
			if host.predicate(&node)? {
				host.advance()?;
				return Ok(node);
			}
			if let Some(index) = next_child_index(host, &node, host.first_index())? {
				host.descend(&node, &current, &index)?;
			} else {
				host.advance()?;
				return Ok(host.undefined_node());
			}
		}
	}
}

/// Advances through the live reader stacks without retaining a second traversal index.
pub fn advance_bracket_node<H: BracketNodeReaderHost>(host: &H) -> Result<(), H::Error> {
	loop {
		let offset = host.current_offset()?;
		let current = host.current_node()?;
		host.pop_current()?;
		if host.no_parents()? {
			break;
		}
		let parent = host.current_node()?;
		let previous = host.last_child_index()?;
		if let Some(index) = next_child_index(host, &parent, previous)? {
			host.move_to_child(&parent, &current, &offset, &index)?;
			break;
		}
		host.pop_parent()?;
	}
	Ok(())
}

fn next_child_index<H: BracketNodeReaderHost>(
	host: &H,
	node: &H::Node,
	mut index: H::Index,
) -> Result<Option<H::Index>, H::Error> {
	loop {
		index = host.increment_index(&index)?;
		if host.index_at_end(node, &index)? {
			return Ok(None);
		}
		if host.child_exists(node, &index)? {
			return Ok(if host.missing_index(&index)? {
				None
			} else {
				Some(index)
			});
		}
	}
}
