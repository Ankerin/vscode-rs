/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use vscode_editor_core::{BufferError, TextChange, compress_text_changes};
use wasm_bindgen::prelude::*;

const MAX_TEXT_CHANGE_UNITS: usize = 4 * 1024 * 1024;

/// Versions undo-change composition independently from storage and diff contracts.
#[wasm_bindgen]
pub fn text_change_abi_version() -> u32 {
	1
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
	let decode = |values: &[u32]| -> Result<Vec<TextChange<'_>>, BufferError> {
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
	};
	let previous = decode(previous)?;
	let current = decode(current)?;
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
		let (Ok(old_position), Ok(new_position)) = (
			u32::try_from(change.old_position),
			u32::try_from(change.new_position),
		) else {
			return Ok(None);
		};
		values.extend(old_position.to_be_bytes());
		values.extend(new_position.to_be_bytes());
		values.extend((change.old_length() as u32).to_be_bytes());
		for unit in change.old_text() {
			values.extend(unit.to_le_bytes());
		}
		values.extend((change.new_length() as u32).to_be_bytes());
		for unit in change.new_text() {
			values.extend(unit.to_le_bytes());
		}
	}
	Ok(Some(values))
}
