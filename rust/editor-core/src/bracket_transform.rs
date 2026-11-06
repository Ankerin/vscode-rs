/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket AST cloning, flattening, and shallow mutable construction retain original identities.

/// Original clone/factory/iterator capabilities preserve method lookup, source aliases, and completion.
pub trait BracketTransformHost {
	type Value;
	type Error;

	fn receiver(&self) -> Result<Self::Value, Self::Error>;
	fn length(&self) -> Result<Self::Value, Self::Error>;
	fn height(&self) -> Result<Self::Value, Self::Error>;
	fn missing(&self) -> Result<Self::Value, Self::Error>;
	fn pair_factory(&self) -> Result<Self::Value, Self::Error>;
	fn pair_opening(&self, clone: bool) -> Result<Self::Value, Self::Error>;
	fn pair_child(&self, clone: bool) -> Result<Self::Value, Self::Error>;
	fn pair_closing(&self, clone: bool) -> Result<Self::Value, Self::Error>;
	fn create_pair(
		&self,
		factory: &Self::Value,
		children: [&Self::Value; 3],
	) -> Result<Self::Value, Self::Error>;
	fn clone_pair(
		&self,
		length: &Self::Value,
		children: [&Self::Value; 3],
		missing: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn compact_item(&self, index: u32, clone: bool) -> Result<Self::Value, Self::Error>;
	fn create_compact(
		&self,
		metadata: [&Self::Value; 3],
		children: [&Self::Value; 3],
	) -> Result<Self::Value, Self::Error>;
	fn clone_array(&self) -> Result<Self::Value, Self::Error>;
	fn index_before_count(&self, index: f64) -> Result<bool, Self::Error>;
	fn clone_into(&self, output: &Self::Value, index: f64) -> Result<(), Self::Error>;
	fn spread_children(&self) -> Result<Self::Value, Self::Error>;
	fn create_array(
		&self,
		metadata: [&Self::Value; 3],
		children: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn empty_items(&self) -> Result<Self::Value, Self::Error>;
	fn iterator(&self) -> Result<Self::Value, Self::Error>;
	fn next(&self, iterator: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn done(&self, step: &Self::Value) -> Result<bool, Self::Error>;
	fn step_value(&self, step: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn close(&self, iterator: &Self::Value) -> Result<(), Self::Error>;
	fn flatten_child(&self, child: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn is_list(&self, child: &Self::Value) -> Result<bool, Self::Error>;
	fn push_flattened(
		&self,
		items: &Self::Value,
		child: &Self::Value,
		expand: bool,
	) -> Result<(), Self::Error>;
	fn create_flattened(&self, items: &Self::Value) -> Result<Self::Value, Self::Error>;
}

/// Clones or flattens pairs with original factory lookup and argument order.
pub fn transform_bracket_pair<H: BracketTransformHost>(
	host: &H,
	clone: bool,
) -> Result<H::Value, H::Error> {
	if clone {
		let length = host.length()?;
		let opening = host.pair_opening(true)?;
		let child = host.pair_child(true)?;
		let closing = host.pair_closing(true)?;
		let missing = host.missing()?;
		host.clone_pair(&length, [&opening, &child, &closing], &missing)
	} else {
		let factory = host.pair_factory()?;
		let opening = host.pair_opening(false)?;
		let child = host.pair_child(false)?;
		let closing = host.pair_closing(false)?;
		host.create_pair(&factory, [&opening, &child, &closing])
	}
}

/// Clones compact lists or constructs their original mutable shallow copy.
pub fn transform_compact_bracket_list<H: BracketTransformHost>(
	host: &H,
	clone: bool,
) -> Result<H::Value, H::Error> {
	let length = host.length()?;
	let height = host.height()?;
	let first = host.compact_item(0, clone)?;
	let second = host.compact_item(1, clone)?;
	let third = host.compact_item(2, clone)?;
	let missing = host.missing()?;
	host.create_compact([&length, &height, &missing], [&first, &second, &third])
}

/// Clones array-backed lists with live length rereads or creates their shallow mutable copy.
pub fn transform_array_bracket_list<H: BracketTransformHost>(
	host: &H,
	clone: bool,
) -> Result<H::Value, H::Error> {
	if clone {
		let children = host.clone_array()?;
		let mut index = 0.0;
		while host.index_before_count(index)? {
			host.clone_into(&children, index)?;
			index += 1.0;
		}
		let length = host.length()?;
		let height = host.height()?;
		let missing = host.missing()?;
		host.create_array([&length, &height, &missing], &children)
	} else {
		let length = host.length()?;
		let height = host.height()?;
		let children = host.spread_children()?;
		let missing = host.missing()?;
		host.create_array([&length, &height, &missing], &children)
	}
}

/// Flattens lists, preserving spread/push observations and original iterable close precedence.
pub fn flatten_bracket_list<H: BracketTransformHost>(host: &H) -> Result<H::Value, H::Error> {
	let items = host.empty_items()?;
	let iterator = host.iterator()?;
	loop {
		let step = host.next(&iterator)?;
		if host.done(&step)? {
			break;
		}
		let child = host.step_value(&step)?;
		let visited = (|| {
			let normalized = host.flatten_child(&child)?;
			let expand = host.is_list(&normalized)?;
			host.push_flattened(&items, &normalized, expand)
		})();
		if let Err(error) = visited {
			let _ = host.close(&iterator);
			return Err(error);
		}
	}
	host.create_flattened(&items)
}
