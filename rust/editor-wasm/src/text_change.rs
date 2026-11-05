/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use vscode_editor_core::{BufferError, TextChange, UndoChangeBatch, compress_text_changes};
use wasm_bindgen::prelude::*;

const MAX_TEXT_CHANGE_UNITS: usize = 4 * 1024 * 1024;

/// Versions undo-change composition independently from storage and diff contracts.
#[wasm_bindgen]
pub fn text_change_abi_version() -> u32 {
	2
}

/// A scoped owning undo batch. Generated finalization covers abandoned open stack elements.
#[wasm_bindgen]
pub struct WasmUndoChangeBatch {
	batch: UndoChangeBatch,
}

#[wasm_bindgen]
impl WasmUndoChangeBatch {
	#[wasm_bindgen(constructor)]
	pub fn new() -> Self {
		Self {
			batch: UndoChangeBatch::default(),
		}
	}

	pub fn len(&self) -> usize {
		self.batch.len()
	}

	pub fn append(&mut self, ranges: &[u32], units: &[u16]) -> Result<bool, JsError> {
		if units.len() > MAX_TEXT_CHANGE_UNITS || ranges.len() > MAX_TEXT_CHANGE_UNITS {
			return Ok(false);
		}
		let changes = decode_changes(ranges, units)?;
		Ok(self.batch.append(&changes).unwrap_or(false))
	}

	/// Uses the existing text-change record format; the owning stack supplies the count/header.
	pub fn serialize(&self) -> Result<Vec<u8>, JsError> {
		let changes = self.batch.changes();
		let mut values = Vec::with_capacity(
			changes
				.iter()
				.map(|change| 16 + 2 * (change.old_text.len() + change.new_text.len()))
				.sum(),
		);
		for change in changes {
			append_change(
				&mut values,
				change.old_position,
				change.new_position,
				change.old_text.len(),
				change.new_text.len(),
				change.old_text.iter().copied(),
				change.new_text.iter().copied(),
			)?;
		}
		Ok(values)
	}
}

impl Default for WasmUndoChangeBatch {
	fn default() -> Self {
		Self::new()
	}
}

fn decode_changes<'a>(
	values: &[u32],
	units: &'a [u16],
) -> Result<Vec<TextChange<'a>>, BufferError> {
	let (values, remainder) = values.as_chunks::<6>();
	if !remainder.is_empty() {
		return Err(BufferError::InvalidRange);
	}
	values
		.iter()
		.map(|value| {
			let text = |start: u32, length: u32| {
				units
					.get(
						start as usize
							..(start as usize)
								.checked_add(length as usize)
								.ok_or(BufferError::InvalidRange)?,
					)
					.ok_or(BufferError::InvalidRange)
			};
			Ok(TextChange {
				old_position: value[0] as usize,
				old_text: text(value[1], value[2])?,
				new_position: value[3] as usize,
				new_text: text(value[4], value[5])?,
			})
		})
		.collect()
}

/// Receives position/text-slice tuples and returns the existing TextChange binary representation.
#[wasm_bindgen]
pub fn compress_changes(
	previous: &[u32],
	current: &[u32],
	units: &[u16],
) -> Result<Option<Vec<u8>>, JsError> {
	if units.len() > MAX_TEXT_CHANGE_UNITS || previous.len() + current.len() > MAX_TEXT_CHANGE_UNITS
	{
		return Ok(None);
	}
	let previous = decode_changes(previous, units)?;
	let current = decode_changes(current, units)?;
	let total = previous
		.iter()
		.chain(&current)
		.try_fold(0_usize, |total, change| {
			total
				.checked_add(change.old_text.len())?
				.checked_add(change.new_text.len())
		});
	if total.is_none_or(|total| total > MAX_TEXT_CHANGE_UNITS) {
		return Ok(None);
	}
	let changes = match compress_text_changes(&previous, &current) {
		Ok(changes) => changes,
		Err(_) => return Ok(None),
	};
	let mut values = Vec::new();
	let length = changes.iter().try_fold(0_usize, |length, change| {
		length.checked_add(16 + 2 * (change.old_length() + change.new_length()))
	});
	let Some(length) = length.filter(|length| {
		*length <= 2 * MAX_TEXT_CHANGE_UNITS + 16 * (previous.len() + current.len())
	}) else {
		return Ok(None);
	};
	if values.try_reserve_exact(length).is_err() {
		return Ok(None);
	}
	for change in changes {
		if change
			.old_position
			.checked_add(change.old_length())
			.is_none_or(|end| end > u32::MAX as usize)
			|| change
				.new_position
				.checked_add(change.new_length())
				.is_none_or(|end| end > u32::MAX as usize)
		{
			return Ok(None);
		}
		append_change(
			&mut values,
			change.old_position,
			change.new_position,
			change.old_length(),
			change.new_length(),
			change.old_text(),
			change.new_text(),
		)?;
	}
	Ok(Some(values))
}

fn append_change(
	values: &mut Vec<u8>,
	old_position: usize,
	new_position: usize,
	old_length: usize,
	new_length: usize,
	old_text: impl Iterator<Item = u16>,
	new_text: impl Iterator<Item = u16>,
) -> Result<(), BufferError> {
	values.extend(
		u32::try_from(old_position)
			.map_err(|_| BufferError::InvalidRange)?
			.to_be_bytes(),
	);
	values.extend(
		u32::try_from(new_position)
			.map_err(|_| BufferError::InvalidRange)?
			.to_be_bytes(),
	);
	values.extend((old_length as u32).to_be_bytes());
	for unit in old_text {
		values.extend(unit.to_le_bytes());
	}
	values.extend((new_length as u32).to_be_bytes());
	for unit in new_text {
		values.extend(unit.to_le_bytes());
	}
	Ok(())
}
