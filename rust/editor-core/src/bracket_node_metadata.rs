/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Owning numeric AST metadata retains IEEE-754 values and original data-property attributes.

/// A configurable numeric own property, including its writable/enumerable attributes.
#[derive(Clone, Copy, Debug)]
pub struct BracketNodeNumber {
	pub value: f64,
	pub writable: bool,
	pub enumerable: bool,
}

/// Length, list height, and cached indentation have one owning record per AST facade.
#[derive(Default)]
pub struct BracketNodeMetadata {
	fields: [Option<BracketNodeNumber>; 3],
}

impl BracketNodeMetadata {
	/// Returns a copied scalar without exposing or duplicating the owning record.
	pub fn get(&self, index: usize) -> Option<BracketNodeNumber> {
		self.fields.get(index).copied().flatten()
	}

	/// Defines a supported field atomically; unsupported indices leave the record unchanged.
	pub fn define(&mut self, index: usize, field: BracketNodeNumber) -> bool {
		let Some(slot) = self.fields.get_mut(index) else {
			return false;
		};
		*slot = Some(field);
		true
	}

	/// Releases a field when its descriptor needs the original host property implementation.
	pub fn remove(&mut self, index: usize) -> bool {
		self.fields
			.get_mut(index)
			.is_some_and(|slot| slot.take().is_some())
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn metadata_preserves_number_bits_attributes_and_atomic_invalid_definitions() {
		let mut metadata = BracketNodeMetadata::default();
		for value in [
			-0.0,
			f64::INFINITY,
			f64::NEG_INFINITY,
			f64::NAN,
			9_007_199_254_740_991.0,
		] {
			let field = BracketNodeNumber {
				value,
				writable: false,
				enumerable: true,
			};
			assert!(metadata.define(0, field));
			assert!(!metadata.define(
				3,
				BracketNodeNumber {
					value: 1.0,
					..field
				}
			));
			let retained = metadata.get(0).unwrap();
			assert_eq!(
				(
					retained.value.to_bits(),
					retained.writable,
					retained.enumerable
				),
				(value.to_bits(), false, true)
			);
		}
		assert_eq!(
			(
				metadata.remove(0),
				metadata.remove(0),
				metadata.get(0).is_none(),
				metadata.get(3).is_none()
			),
			(true, false, true, true)
		);
	}
}
