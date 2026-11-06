/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Concrete bracket list mutation preserves validation, setter order, and partial metadata failures.

/// Original list fields, array methods, and metadata dispatch retain identities and thrown state.
pub trait BracketMutationHost {
	type Value;
	type Error;

	fn undefined(&self) -> Self::Value;
	fn null(&self) -> Self::Value;
	fn incoming(&self) -> Result<Self::Value, Self::Error>;
	fn item(&self, index: u32) -> Result<Self::Value, Self::Error>;
	fn truthy(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn invalid_capacity(&self, operation: u32) -> Result<(), Self::Error>;
	fn throw_if_immutable(&self) -> Result<(), Self::Error>;
	fn set_item(&self, index: u32, value: &Self::Value) -> Result<(), Self::Error>;
	fn array_mutation(&self, operation: u32) -> Result<Self::Value, Self::Error>;
	fn update(&self) -> Result<(), Self::Error>;
}

/// Applies append/remove/prepend/remove-first to a compact or array-backed list.
pub fn mutate_bracket_list<H: BracketMutationHost>(
	host: &H,
	operation: u32,
	compact: bool,
) -> Result<H::Value, H::Error> {
	let mut result = host.undefined();
	if compact {
		let third = host.item(2)?;
		let full = host.truthy(&third)?;
		let removing = operation == 1 || operation == 3;
		if full != removing {
			host.invalid_capacity(operation)?;
		}
		host.throw_if_immutable()?;
		match operation {
			0 => {
				let incoming = host.incoming()?;
				host.set_item(2, &incoming)?;
			}
			1 => {
				result = host.item(2)?;
				host.set_item(2, &host.null())?;
			}
			2 => {
				let second = host.item(1)?;
				host.set_item(2, &second)?;
				let first = host.item(0)?;
				host.set_item(1, &first)?;
				let incoming = host.incoming()?;
				host.set_item(0, &incoming)?;
			}
			3 => {
				result = host.item(0)?;
				let second = host.item(1)?;
				host.set_item(0, &second)?;
				let third = host.item(2)?;
				host.set_item(1, &third)?;
				host.set_item(2, &host.null())?;
			}
			_ => host.invalid_capacity(operation)?,
		}
	} else {
		host.throw_if_immutable()?;
		result = host.array_mutation(operation)?;
	}
	host.update()?;
	Ok(result)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::{Cell, RefCell};

	struct Host {
		items: RefCell<[i32; 3]>,
		immutable: bool,
		fail_update: bool,
		checked: Cell<bool>,
	}
	impl BracketMutationHost for Host {
		type Value = i32;
		type Error = &'static str;
		fn undefined(&self) -> i32 {
			-1
		}
		fn null(&self) -> i32 {
			0
		}
		fn incoming(&self) -> Result<i32, Self::Error> {
			Ok(4)
		}
		fn item(&self, index: u32) -> Result<i32, Self::Error> {
			Ok(self.items.borrow()[index as usize])
		}
		fn truthy(&self, value: &i32) -> Result<bool, Self::Error> {
			Ok(*value != 0)
		}
		fn invalid_capacity(&self, _: u32) -> Result<(), Self::Error> {
			Err("capacity")
		}
		fn throw_if_immutable(&self) -> Result<(), Self::Error> {
			self.checked.set(true);
			if self.immutable {
				Err("immutable")
			} else {
				Ok(())
			}
		}
		fn set_item(&self, index: u32, value: &i32) -> Result<(), Self::Error> {
			self.items.borrow_mut()[index as usize] = *value;
			Ok(())
		}
		fn array_mutation(&self, _: u32) -> Result<i32, Self::Error> {
			unreachable!()
		}
		fn update(&self) -> Result<(), Self::Error> {
			if self.fail_update {
				Err("metadata")
			} else {
				Ok(())
			}
		}
	}

	#[test]
	fn compact_mutations_preserve_slot_shifts_results_and_partial_metadata_failures() {
		for (operation, initial, expected) in [
			(0, [1, 2, 0], [1, 2, 4]),
			(1, [1, 2, 3], [1, 2, 0]),
			(2, [1, 2, 0], [4, 1, 2]),
			(3, [1, 2, 3], [2, 3, 0]),
		] {
			let host = Host {
				items: RefCell::new(initial),
				immutable: false,
				fail_update: true,
				checked: Cell::new(false),
			};
			assert_eq!(
				(
					mutate_bracket_list(&host, operation, true),
					host.items.into_inner()
				),
				(Err("metadata"), expected)
			);
		}
	}

	#[test]
	fn capacity_errors_precede_immutable_checks() {
		let host = Host {
			items: RefCell::new([1, 2, 3]),
			immutable: true,
			fail_update: false,
			checked: Cell::new(false),
		};
		assert_eq!(
			(mutate_bracket_list(&host, 0, true), host.checked.get()),
			(Err("capacity"), false)
		);
		assert_eq!(
			(mutate_bracket_list(&host, 1, true), host.checked.get()),
			(Err("immutable"), true)
		);
	}
}
