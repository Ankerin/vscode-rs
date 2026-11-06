/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Owning bracket metadata retains scalar values and original data-property attributes.

/// A configurable scalar own property, including its writable/enumerable attributes.
#[derive(Clone, Copy, Debug)]
pub struct BracketNodeProperty<V> {
	pub value: V,
	pub writable: bool,
	pub enumerable: bool,
}

/// Numeric stack slots retain native IEEE-754 payloads.
pub type BracketNodeNumber = BracketNodeProperty<f64>;

/// AST metadata and bracket parser/tokenizer cursors have one owning record per facade.
pub struct BracketNodeMetadata<const N: usize = 3, V = f64> {
	fields: [Option<BracketNodeProperty<V>>; N],
}

impl<const N: usize, V> Default for BracketNodeMetadata<N, V> {
	fn default() -> Self {
		Self {
			fields: std::array::from_fn(|_| None),
		}
	}
}

impl<const N: usize, V: Clone> BracketNodeMetadata<N, V> {
	/// Returns a copied scalar without exposing or duplicating the owning record.
	pub fn get(&self, index: usize) -> Option<BracketNodeProperty<V>> {
		self.fields.get(index).cloned().flatten()
	}

	/// Defines a supported field atomically; unsupported indices leave the record unchanged.
	pub fn define(&mut self, index: usize, field: BracketNodeProperty<V>) -> bool {
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
	fn owned_payloads_keep_prior_values_after_replacement_and_release_removed_fields() {
		let mut metadata = BracketNodeMetadata::<2, String>::default();
		metadata.define(
			0,
			BracketNodeProperty {
				value: "original".to_owned(),
				writable: true,
				enumerable: true,
			},
		);
		let original = metadata.get(0).unwrap().value;
		metadata.define(
			0,
			BracketNodeProperty {
				value: "replacement".to_owned(),
				writable: false,
				enumerable: true,
			},
		);
		let replacement = metadata.get(0).unwrap();
		metadata.remove(0);
		assert_eq!(
			(
				original,
				replacement.value,
				replacement.writable,
				metadata.get(0).is_none()
			),
			("original".to_owned(), "replacement".to_owned(), false, true)
		);
	}

	#[test]
	fn cursor_records_keep_all_five_fields_independent_and_reject_extra_slots() {
		let mut metadata = BracketNodeMetadata::<5>::default();
		for index in 0..5 {
			metadata.define(
				index,
				BracketNodeNumber {
					value: index as f64 - 1.0,
					writable: index != 2,
					enumerable: index != 3,
				},
			);
		}
		assert!(!metadata.define(
			5,
			BracketNodeNumber {
				value: 99.0,
				writable: true,
				enumerable: true
			}
		));
		metadata.remove(1);
		let values: Vec<_> = (0..5)
			.map(|index| {
				metadata
					.get(index)
					.map(|field| (field.value, field.writable, field.enumerable))
			})
			.collect();
		assert_eq!(
			values,
			vec![
				Some((-1.0, true, true)),
				None,
				Some((1.0, false, true)),
				Some((2.0, true, false)),
				Some((3.0, true, true))
			]
		);
	}

	#[test]
	fn metadata_preserves_number_bits_attributes_and_atomic_invalid_definitions() {
		let mut metadata = BracketNodeMetadata::<3>::default();
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
