/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Numeric reader stacks own their payloads without retaining host arrays or facade references.

use crate::BracketNodeNumber;

const MAX_FIELDS: usize = 262_144;

/// Sparse configurable numeric array entries preserve holes and data-property attributes.
#[derive(Default)]
pub struct BracketNumberArray {
	fields: Vec<Option<BracketNodeNumber>>,
}

impl BracketNumberArray {
	/// Reserves a supported slot before a host array-length change can commit.
	pub fn prepare(&mut self, index: usize) -> Result<bool, &'static str> {
		if index >= MAX_FIELDS {
			return Ok(false);
		}
		if index >= self.fields.len() {
			self.fields
				.try_reserve(index + 1 - self.fields.len())
				.map_err(|_| "Unable to allocate Rust bracket number array")?;
			self.fields.resize(index + 1, None);
		}
		Ok(true)
	}

	/// Reads only an existing numeric entry; holes remain distinguishable from zero.
	pub fn get(&self, index: usize) -> Option<BracketNodeNumber> {
		self.fields.get(index).copied().flatten()
	}

	/// Commits an already prepared slot without an allocation or a host callback.
	pub fn define(&mut self, index: usize, field: BracketNodeNumber) -> bool {
		let Some(slot) = self.fields.get_mut(index) else {
			return false;
		};
		*slot = Some(field);
		true
	}

	/// Deletes a configurable numeric entry without shrinking the host array length.
	pub fn remove(&mut self, index: usize) {
		if let Some(slot) = self.fields.get_mut(index) {
			*slot = None;
		}
	}

	/// Mirrors successful or partial host length reduction after nonconfigurable entry checks.
	pub fn truncate(&mut self, length: usize) {
		self.fields.truncate(length);
	}

	/// Returns existing indices in the array's canonical numeric property order.
	pub fn indices(&self) -> Vec<u32> {
		self.fields
			.iter()
			.enumerate()
			.filter_map(|(index, field)| field.as_ref().map(|_| index as u32))
			.collect()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn sparse_stacks_keep_holes_number_bits_attributes_and_bounded_preflight() {
		let mut array = BracketNumberArray::default();
		assert!(array.prepare(4).unwrap());
		for (index, value) in [(0, -0.0), (2, f64::NAN), (4, f64::INFINITY)] {
			assert!(array.define(
				index,
				BracketNodeNumber {
					value,
					writable: index != 2,
					enumerable: true
				}
			));
		}
		assert!(!array.prepare(MAX_FIELDS).unwrap());
		assert!(!array.define(
			MAX_FIELDS,
			BracketNodeNumber {
				value: 99.0,
				writable: true,
				enumerable: true
			}
		));
		assert_eq!(array.indices(), vec![0, 2, 4]);
		assert_eq!(array.get(0).unwrap().value.to_bits(), (-0.0_f64).to_bits());
		array.truncate(3);
		array.remove(0);
		assert_eq!(
			(
				array.indices(),
				array.get(1).is_none(),
				array.get(2).unwrap().writable,
				array.get(4).is_none()
			),
			(vec![2], true, false, true)
		);
	}
}
