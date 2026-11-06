/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket parser orchestration preserves original token, cache, factory, and mutation semantics.

/// Original parser capabilities retain actual AST objects, sets, tokens, and host item arrays.
pub trait BracketParserHost {
	type Node;
	type Token;
	type Set;
	type Length;
	type Items;
	type Error;

	fn undefined_node(&self) -> Self::Node;
	fn node_exists(&self, node: &Self::Node) -> Result<bool, Self::Error>;
	fn reset_counters(&self) -> Result<(), Self::Error>;
	fn parse_root(&self) -> Result<Self::Node, Self::Error>;
	fn empty(&self) -> Result<Self::Node, Self::Error>;
	fn new_items(&self) -> Result<Self::Items, Self::Error>;
	fn cached(&self, opened: &Self::Set) -> Result<Self::Node, Self::Error>;
	fn peek(&self) -> Result<Self::Token, Self::Error>;
	fn token_exists(&self, token: &Self::Token) -> Result<bool, Self::Error>;
	fn closes_opened(&self, token: &Self::Token, opened: &Self::Set) -> Result<bool, Self::Error>;
	fn parse_child(&self, opened: &Self::Set, level: f64) -> Result<Self::Node, Self::Error>;
	fn empty_list(&self, node: &Self::Node) -> Result<bool, Self::Error>;
	fn push(&self, items: &Self::Items, node: &Self::Node) -> Result<(), Self::Error>;
	fn concat(&self, items: &Self::Items) -> Result<Self::Node, Self::Error>;
	fn has_reader(&self) -> Result<bool, Self::Error>;
	fn cacheable_length(&self) -> Result<Self::Length, Self::Error>;
	fn cacheable(&self, length: &Self::Length) -> Result<bool, Self::Error>;
	fn read_cache(
		&self,
		length: &Self::Length,
		opened: &Self::Set,
	) -> Result<Self::Node, Self::Error>;
	fn increment_cached(&self) -> Result<(), Self::Error>;
	fn skip_node(&self, node: &Self::Node) -> Result<(), Self::Error>;
	fn length_accepts(
		&self,
		node: &Self::Node,
		maximum: &Self::Length,
	) -> Result<bool, Self::Error>;
	fn can_reuse(&self, node: &Self::Node, opened: &Self::Set) -> Result<bool, Self::Error>;
	fn increment_constructed(&self) -> Result<(), Self::Error>;
	fn read(&self) -> Result<Self::Token, Self::Error>;
	fn token_kind(&self, token: &Self::Token) -> Result<Option<u32>, Self::Error>;
	fn invalid(&self, token: &Self::Token) -> Result<Self::Node, Self::Error>;
	fn text(&self, token: &Self::Token) -> Result<Self::Node, Self::Error>;
	fn new_text(&self, token: &Self::Token) -> Result<Self::Node, Self::Error>;
	fn merge(&self, opened: &Self::Set, token: &Self::Token) -> Result<Self::Set, Self::Error>;
	fn parse_list(&self, opened: &Self::Set, level: f64) -> Result<Self::Node, Self::Error>;
	fn closes_pair(
		&self,
		closing: &Self::Token,
		opening: &Self::Token,
	) -> Result<bool, Self::Error>;
	fn pair(
		&self,
		opening: &Self::Token,
		child: &Self::Node,
		closing: Option<&Self::Token>,
	) -> Result<Self::Node, Self::Error>;
	fn unexpected(&self) -> Self::Error;
}

/// Resets document counters and resolves the original empty-root shortcut.
pub fn parse_bracket_document<H: BracketParserHost>(host: &H) -> Result<H::Node, H::Error> {
	host.reset_counters()?;
	let node = host.parse_root()?;
	if host.node_exists(&node)? {
		Ok(node)
	} else {
		host.empty()
	}
}

/// Builds one list, retaining cache preference, closing affinity, and empty-list filtering.
pub fn parse_bracket_list<H: BracketParserHost>(
	host: &H,
	opened: &H::Set,
	level: f64,
) -> Result<H::Node, H::Error> {
	let items = host.new_items()?;
	loop {
		let mut child = host.cached(opened)?;
		if !host.node_exists(&child)? {
			let token = host.peek()?;
			if !host.token_exists(&token)? || host.closes_opened(&token, opened)? {
				break;
			}
			child = host.parse_child(opened, level + 1.0)?;
		}
		if !host.empty_list(&child)? {
			host.push(&items, &child)?;
		}
	}
	host.concat(&items)
}

/// Reuses the longest valid node without touching edits or skipping tokens before acceptance.
pub fn read_bracket_parser_cache<H: BracketParserHost>(
	host: &H,
	opened: &H::Set,
) -> Result<H::Node, H::Error> {
	if host.has_reader()? {
		let maximum = host.cacheable_length()?;
		if host.cacheable(&maximum)? {
			let node = host.read_cache(&maximum, opened)?;
			if host.node_exists(&node)? {
				host.increment_cached()?;
				host.skip_node(&node)?;
				return Ok(node);
			}
		}
	}
	Ok(host.undefined_node())
}

/// Touching an edit rejects reuse before invoking the node's original compatibility predicate.
pub fn can_reuse_bracket_parser_node<H: BracketParserHost>(
	host: &H,
	node: &H::Node,
	maximum: &H::Length,
	opened: &H::Set,
) -> Result<bool, H::Error> {
	if !host.length_accepts(node, maximum)? {
		return Ok(false);
	}
	host.can_reuse(node, opened)
}

/// Parses a token and an optional matching closer with the original depth guard and factories.
pub fn parse_bracket_child<H: BracketParserHost>(
	host: &H,
	opened: &H::Set,
	level: f64,
) -> Result<H::Node, H::Error> {
	host.increment_constructed()?;
	let token = host.read()?;
	match host.token_kind(&token)? {
		Some(2) => host.invalid(&token),
		Some(0) => host.text(&token),
		Some(1) => {
			if level > 300.0 {
				return host.new_text(&token);
			}
			let merged = host.merge(opened, &token)?;
			let child = host.parse_list(&merged, level + 1.0)?;
			let next = host.peek()?;
			if host.token_exists(&next)? && host.closes_pair(&next, &token)? {
				host.read()?;
				host.pair(&token, &child, Some(&next))
			} else {
				host.pair(&token, &child, None)
			}
		}
		_ => Err(host.unexpected()),
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::{Cell, RefCell};
	use std::rc::Rc;

	struct Host {
		tokens: Vec<(u32, u32)>,
		index: Cell<usize>,
		constructed: Cell<usize>,
	}

	impl BracketParserHost for Host {
		type Node = Option<String>;
		type Token = Option<(u32, u32)>;
		type Set = u32;
		type Length = Option<f64>;
		type Items = Rc<RefCell<Vec<String>>>;
		type Error = &'static str;

		fn undefined_node(&self) -> Self::Node {
			None
		}
		fn node_exists(&self, node: &Self::Node) -> Result<bool, Self::Error> {
			Ok(node.is_some())
		}
		fn reset_counters(&self) -> Result<(), Self::Error> {
			self.constructed.set(0);
			Ok(())
		}
		fn parse_root(&self) -> Result<Self::Node, Self::Error> {
			parse_bracket_list(self, &0, 0.0)
		}
		fn empty(&self) -> Result<Self::Node, Self::Error> {
			Ok(Some("empty".into()))
		}
		fn new_items(&self) -> Result<Self::Items, Self::Error> {
			Ok(Rc::new(RefCell::new(Vec::new())))
		}
		fn cached(&self, opened: &u32) -> Result<Self::Node, Self::Error> {
			read_bracket_parser_cache(self, opened)
		}
		fn peek(&self) -> Result<Self::Token, Self::Error> {
			Ok(self.tokens.get(self.index.get()).copied())
		}
		fn token_exists(&self, token: &Self::Token) -> Result<bool, Self::Error> {
			Ok(token.is_some())
		}
		fn closes_opened(&self, token: &Self::Token, opened: &u32) -> Result<bool, Self::Error> {
			Ok(token.is_some_and(|(kind, ids)| kind == 2 && ids & opened != 0))
		}
		fn parse_child(&self, opened: &u32, level: f64) -> Result<Self::Node, Self::Error> {
			parse_bracket_child(self, opened, level)
		}
		fn empty_list(&self, _: &Self::Node) -> Result<bool, Self::Error> {
			Ok(false)
		}
		fn push(&self, items: &Self::Items, node: &Self::Node) -> Result<(), Self::Error> {
			items.borrow_mut().push(node.clone().unwrap());
			Ok(())
		}
		fn concat(&self, items: &Self::Items) -> Result<Self::Node, Self::Error> {
			Ok(if items.borrow().is_empty() {
				None
			} else {
				Some(items.borrow().join(","))
			})
		}
		fn has_reader(&self) -> Result<bool, Self::Error> {
			Ok(false)
		}
		fn cacheable_length(&self) -> Result<Self::Length, Self::Error> {
			unreachable!()
		}
		fn cacheable(&self, _: &Self::Length) -> Result<bool, Self::Error> {
			unreachable!()
		}
		fn read_cache(&self, _: &Self::Length, _: &u32) -> Result<Self::Node, Self::Error> {
			unreachable!()
		}
		fn increment_cached(&self) -> Result<(), Self::Error> {
			unreachable!()
		}
		fn skip_node(&self, _: &Self::Node) -> Result<(), Self::Error> {
			unreachable!()
		}
		fn length_accepts(
			&self,
			_: &Self::Node,
			maximum: &Self::Length,
		) -> Result<bool, Self::Error> {
			Ok(maximum.is_none_or(|maximum| maximum > 1.0))
		}
		fn can_reuse(&self, _: &Self::Node, _: &u32) -> Result<bool, Self::Error> {
			Ok(true)
		}
		fn increment_constructed(&self) -> Result<(), Self::Error> {
			self.constructed.set(self.constructed.get() + 1);
			Ok(())
		}
		fn read(&self) -> Result<Self::Token, Self::Error> {
			let token = self.peek()?;
			self.index.set(self.index.get() + 1);
			Ok(token)
		}
		fn token_kind(&self, token: &Self::Token) -> Result<Option<u32>, Self::Error> {
			Ok(token.map(|token| token.0))
		}
		fn invalid(&self, token: &Self::Token) -> Result<Self::Node, Self::Error> {
			Ok(Some(format!("invalid{}", token.unwrap().1)))
		}
		fn text(&self, _: &Self::Token) -> Result<Self::Node, Self::Error> {
			Ok(Some("text".into()))
		}
		fn new_text(&self, _: &Self::Token) -> Result<Self::Node, Self::Error> {
			Ok(Some("guard".into()))
		}
		fn merge(&self, opened: &u32, token: &Self::Token) -> Result<u32, Self::Error> {
			Ok(opened | token.unwrap().1)
		}
		fn parse_list(&self, opened: &u32, level: f64) -> Result<Self::Node, Self::Error> {
			parse_bracket_list(self, opened, level)
		}
		fn closes_pair(
			&self,
			closing: &Self::Token,
			opening: &Self::Token,
		) -> Result<bool, Self::Error> {
			Ok(closing.is_some_and(|(kind, ids)| kind == 2 && ids & opening.unwrap().1 != 0))
		}
		fn pair(
			&self,
			opening: &Self::Token,
			child: &Self::Node,
			closing: Option<&Self::Token>,
		) -> Result<Self::Node, Self::Error> {
			Ok(Some(format!(
				"pair{}[{}]{}",
				opening.unwrap().1,
				child.as_deref().unwrap_or(""),
				if closing.is_some() { "closed" } else { "open" }
			)))
		}
		fn unexpected(&self) -> Self::Error {
			"unexpected"
		}
	}

	#[test]
	fn parser_keeps_unexpected_closers_nested_pairs_unclosed_tails_and_depth_guard() {
		let host = Host {
			tokens: vec![(2, 2), (1, 1), (0, 0), (2, 1), (1, 4), (0, 0)],
			index: Cell::new(0),
			constructed: Cell::new(99),
		};
		assert_eq!(
			(
				parse_bracket_document(&host),
				host.index.get(),
				host.constructed.get()
			),
			(
				Ok(Some("invalid2,pair1[text]closed,pair4[text]open".into())),
				6,
				5
			)
		);
		host.index.set(1);
		assert_eq!(
			parse_bracket_child(&host, &0, 301.0),
			Ok(Some("guard".into()))
		);
		assert!(!can_reuse_bracket_parser_node(&host, &None, &Some(1.0), &0).unwrap());
		assert!(can_reuse_bracket_parser_node(&host, &None, &None, &0).unwrap());
	}
}
