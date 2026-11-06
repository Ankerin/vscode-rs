/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket-tree lifecycle preserves lazy edits, token-accuracy transitions, and event ordering.

/// Original model, parser, queue, and event capabilities retain virtual dispatch and partial writes.
pub trait BracketLifecycleHost {
	type Value;
	type Error;

	fn undefined(&self) -> Self::Value;
	fn truthy(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn is_undefined(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn has_tokens(&self) -> Result<bool, Self::Error>;
	fn completed(&self, constructing: bool) -> Result<bool, Self::Error>;
	fn initial_brackets(&self) -> Result<Self::Value, Self::Error>;
	fn fast_tokenizer(&self, brackets: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn parse_initial(&self, tokenizer: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn initial(&self) -> Result<Self::Value, Self::Error>;
	fn set_initial(&self, node: &Self::Value) -> Result<(), Self::Error>;
	fn set_current(&self, node: &Self::Value) -> Result<(), Self::Error>;
	fn parse_empty(&self, immutable: bool) -> Result<Self::Value, Self::Error>;
	fn fire(&self) -> Result<(), Self::Error>;
	fn combine_queue(&self, initial: bool) -> Result<Self::Value, Self::Error>;
	fn set_queue(&self, initial: bool, edits: &Self::Value) -> Result<(), Self::Error>;
	fn handle_edits(&self, token_change: bool) -> Result<(), Self::Error>;
	fn queue_nonempty(&self, initial: bool) -> Result<bool, Self::Error>;
	fn parse_queue(&self, initial: bool) -> Result<Self::Value, Self::Error>;
	fn clear_queue(&self, initial: bool) -> Result<(), Self::Error>;
}

/// Initializes the original fast, accurate, or provisional tree without changing construction order.
pub fn initialize_bracket_tree<H: BracketLifecycleHost>(host: &H) -> Result<(), H::Error> {
	if !host.has_tokens()? {
		let brackets = host.initial_brackets()?;
		let tokenizer = host.fast_tokenizer(&brackets)?;
		let node = host.parse_initial(&tokenizer)?;
		host.set_initial(&node)?;
		let initial = host.initial()?;
		host.set_current(&initial)?;
	} else if host.completed(true)? {
		host.set_initial(&host.undefined())?;
		let node = host.parse_empty(false)?;
		host.set_current(&node)?;
	} else {
		let node = host.parse_empty(true)?;
		host.set_initial(&node)?;
		let initial = host.initial()?;
		host.set_current(&initial)?;
	}
	Ok(())
}

/// Switches to accurate token information and emits only the original tree-transition event.
pub fn complete_bracket_tokenization<H: BracketLifecycleHost>(host: &H) -> Result<(), H::Error> {
	if host.completed(false)? {
		let initial = host.initial()?;
		let was_undefined = host.is_undefined(&initial)?;
		host.set_initial(&host.undefined())?;
		if !was_undefined {
			host.fire()?;
		}
	}
	Ok(())
}

/// Queues content and token edits in the original order, including partial combination failures.
pub fn queue_bracket_edits<H: BracketLifecycleHost>(
	host: &H,
	token_change: bool,
) -> Result<(), H::Error> {
	let edits = host.combine_queue(false)?;
	host.set_queue(false, &edits)?;
	let initial = host.initial()?;
	if host.truthy(&initial)? && !token_change {
		let edits = host.combine_queue(true)?;
		host.set_queue(true, &edits)?;
	}
	Ok(())
}

/// Dispatches original overridable edit handling before token-change notification.
pub fn handle_bracket_change<H: BracketLifecycleHost>(
	host: &H,
	token_change: bool,
) -> Result<(), H::Error> {
	host.handle_edits(token_change)?;
	if token_change {
		let initial = host.initial()?;
		if !host.truthy(&initial)? {
			host.fire()?;
		}
	}
	Ok(())
}

/// Lazily reparses both queues, retaining successfully committed state if a later parse fails.
pub fn flush_bracket_queues<H: BracketLifecycleHost>(host: &H) -> Result<(), H::Error> {
	if host.queue_nonempty(false)? {
		let node = host.parse_queue(false)?;
		host.set_current(&node)?;
		host.clear_queue(false)?;
	}
	if host.queue_nonempty(true)? {
		let initial = host.initial()?;
		if host.truthy(&initial)? {
			let node = host.parse_queue(true)?;
			host.set_initial(&node)?;
		}
		host.clear_queue(true)?;
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::{Cell, RefCell};

	struct Host {
		has_tokens: bool,
		completed: Cell<bool>,
		initial: Cell<i32>,
		current: Cell<i32>,
		queues: [Cell<i32>; 2],
		edits: i32,
		fail_initial: bool,
		events: RefCell<Vec<(i32, i32)>>,
	}

	impl BracketLifecycleHost for Host {
		type Value = i32;
		type Error = &'static str;
		fn undefined(&self) -> i32 {
			-1
		}
		fn truthy(&self, node: &i32) -> Result<bool, Self::Error> {
			Ok(*node >= 0)
		}
		fn is_undefined(&self, node: &i32) -> Result<bool, Self::Error> {
			Ok(*node == -1)
		}
		fn has_tokens(&self) -> Result<bool, Self::Error> {
			Ok(self.has_tokens)
		}
		fn completed(&self, _: bool) -> Result<bool, Self::Error> {
			Ok(self.completed.get())
		}
		fn initial_brackets(&self) -> Result<i32, Self::Error> {
			Ok(1)
		}
		fn fast_tokenizer(&self, _: &i32) -> Result<i32, Self::Error> {
			Ok(2)
		}
		fn parse_initial(&self, _: &i32) -> Result<i32, Self::Error> {
			Ok(3)
		}
		fn initial(&self) -> Result<i32, Self::Error> {
			Ok(self.initial.get())
		}
		fn set_initial(&self, node: &i32) -> Result<(), Self::Error> {
			self.initial.set(*node);
			Ok(())
		}
		fn set_current(&self, node: &i32) -> Result<(), Self::Error> {
			self.current.set(*node);
			Ok(())
		}
		fn parse_empty(&self, immutable: bool) -> Result<i32, Self::Error> {
			Ok(if immutable { 5 } else { 4 })
		}
		fn fire(&self) -> Result<(), Self::Error> {
			self.events
				.borrow_mut()
				.push((self.initial.get(), self.current.get()));
			Ok(())
		}
		fn combine_queue(&self, initial: bool) -> Result<i32, Self::Error> {
			if initial && self.fail_initial {
				return Err("combine");
			}
			Ok(self.queues[usize::from(initial)].get() + self.edits)
		}
		fn set_queue(&self, initial: bool, edits: &i32) -> Result<(), Self::Error> {
			self.queues[usize::from(initial)].set(*edits);
			Ok(())
		}
		fn handle_edits(&self, token_change: bool) -> Result<(), Self::Error> {
			queue_bracket_edits(self, token_change)
		}
		fn queue_nonempty(&self, initial: bool) -> Result<bool, Self::Error> {
			Ok(self.queues[usize::from(initial)].get() > 0)
		}
		fn parse_queue(&self, initial: bool) -> Result<i32, Self::Error> {
			if initial && self.fail_initial {
				return Err("parse");
			}
			Ok(10 + self.queues[usize::from(initial)].get())
		}
		fn clear_queue(&self, initial: bool) -> Result<(), Self::Error> {
			self.queues[usize::from(initial)].set(0);
			Ok(())
		}
	}

	fn host(has_tokens: bool, completed: bool) -> Host {
		Host {
			has_tokens,
			completed: Cell::new(completed),
			initial: Cell::new(-1),
			current: Cell::new(-1),
			queues: [Cell::new(0), Cell::new(0)],
			edits: 2,
			fail_initial: false,
			events: RefCell::new(Vec::new()),
		}
	}

	#[test]
	fn initialization_retains_fast_accurate_and_provisional_branches() {
		for (tokens, completed, expected) in [
			(false, false, (3, 3)),
			(true, true, (-1, 4)),
			(true, false, (5, 5)),
		] {
			let host = host(tokens, completed);
			initialize_bracket_tree(&host).unwrap();
			assert_eq!((host.initial.get(), host.current.get()), expected);
		}
	}

	#[test]
	fn change_events_wait_for_accurate_tokens_and_retain_current_state() {
		let host = host(false, false);
		initialize_bracket_tree(&host).unwrap();
		handle_bracket_change(&host, false).unwrap();
		handle_bracket_change(&host, true).unwrap();
		flush_bracket_queues(&host).unwrap();
		host.completed.set(true);
		complete_bracket_tokenization(&host).unwrap();
		complete_bracket_tokenization(&host).unwrap();
		handle_bracket_change(&host, true).unwrap();
		assert_eq!(
			(
				host.initial.get(),
				host.current.get(),
				host.queues[0].get(),
				host.queues[1].get(),
				host.events.into_inner()
			),
			(-1, 14, 2, 0, vec![(-1, 14), (-1, 14)])
		);
	}

	#[test]
	fn queue_and_parse_failures_preserve_preceding_commits() {
		let host = Host {
			initial: Cell::new(3),
			fail_initial: true,
			..host(false, false)
		};
		let queue_result = queue_bracket_edits(&host, false);
		host.queues[1].set(2);
		let parse_result = flush_bracket_queues(&host);
		assert_eq!(
			(
				queue_result,
				parse_result,
				host.initial.get(),
				host.current.get(),
				host.queues[0].get(),
				host.queues[1].get()
			),
			(Err("combine"), Err("parse"), 3, 12, 0, 2)
		);
	}
}
