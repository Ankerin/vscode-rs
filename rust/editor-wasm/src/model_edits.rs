/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use std::borrow::Cow;

use vscode_editor_core::{
	BufferError, MAX_MODEL_EDIT_UNITS, MAX_MODEL_EDITS, ModelEdit, ModelEditOptions,
	ModelTextFlags, Position, TextBuffer, TextRange, prepare_model_edits,
};
use wasm_bindgen::JsError;

/// Returns one packed result and commits only after result allocation succeeds.
pub(crate) fn apply(
	buffer: &mut TextBuffer,
	values: &[u32],
	units: &[u16],
	crlf: bool,
	flags: u32,
	record_trim_auto_whitespace: bool,
	compute_undo_edits: bool,
) -> Result<Option<Vec<u8>>, JsError> {
	if values.len() > MAX_MODEL_EDITS * 7 || units.len() > MAX_MODEL_EDIT_UNITS {
		return Ok(None);
	}
	if flags & !7 != 0 {
		return Err(BufferError::InvalidRange.into());
	}
	let (values, remainder) = values.as_chunks::<7>();
	if !remainder.is_empty() {
		return Err(BufferError::InvalidRange.into());
	}
	let options = ModelEditOptions {
		crlf,
		flags: ModelTextFlags {
			non_basic_ascii: flags & 1 != 0,
			rtl: flags & 2 != 0,
			unusual_line_terminators: flags & 4 != 0,
		},
		record_trim_auto_whitespace,
		compute_undo_edits,
	};
	let prepared = if let [value] = values {
		prepare_model_edits(
			buffer,
			std::slice::from_ref(&decode_edit(value, units)?),
			options,
		)
	} else {
		let edits: Result<Vec<_>, _> = values
			.iter()
			.map(|value| decode_edit(value, units))
			.collect();
		prepare_model_edits(buffer, &edits?, options)
	};
	let prepared = match prepared {
		Ok(Some(prepared)) => prepared,
		Ok(None) => return Ok(None),
		Err(BufferError::OverlappingEdits) => {
			return Err(JsError::new("Overlapping ranges are not allowed!"));
		}
		Err(error) => return Err(error.into()),
	};
	let length = 12
		+ prepared
			.operations
			.iter()
			.map(|operation| {
				68 + 2
					* (operation
						.old_text_range
						.as_ref()
						.map_or(0, std::ops::Range::len)
						+ if matches!(operation.text, Cow::Owned(_)) {
							operation.text.len()
						} else {
							0
						})
			})
			.sum::<usize>()
		+ 4 * prepared
			.trim_auto_whitespace_lines
			.as_ref()
			.map_or(0, Vec::len);
	let mut result = Vec::new();
	if result.try_reserve_exact(length).is_err() {
		return Ok(None);
	}
	let flags = u32::from(prepared.flags.non_basic_ascii)
		| u32::from(prepared.flags.rtl) << 1
		| u32::from(prepared.flags.unusual_line_terminators) << 2
		| u32::from(prepared.has_touching_ranges) << 3;
	append_values(
		&mut result,
		[
			flags,
			prepared.operations.len() as u32,
			prepared
				.trim_auto_whitespace_lines
				.as_ref()
				.map_or(u32::MAX, |lines| lines.len() as u32),
		],
	);
	for operation in &prepared.operations {
		let text_source = if matches!(operation.text, Cow::Owned(_)) {
			u32::MAX
		} else {
			operation.input_index as u32
		};
		append_values(
			&mut result,
			[
				operation.input_index as u32,
				operation.sort_index as u32,
				operation.range.start.line_number as u32,
				operation.range.start.column as u32,
				operation.range.end.line_number as u32,
				operation.range.end.column as u32,
				operation.range_offset as u32,
				operation.range_length as u32,
				text_source,
				operation.text.len() as u32,
				operation
					.old_text_range
					.as_ref()
					.map_or(0, std::ops::Range::len) as u32,
				operation.reverse_range.start.line_number as u32,
				operation.reverse_range.start.column as u32,
				operation.reverse_range.end.line_number as u32,
				operation.reverse_range.end.column as u32,
				operation.reverse_offset as u32,
				u32::from(operation.force_move_markers),
			],
		);
		if text_source == u32::MAX {
			append_text(&mut result, &operation.text);
		}
		if let Some(range) = &operation.old_text_range {
			let chunk = buffer.chunk_at(range.start);
			if chunk.len() >= range.len() {
				for unit in chunk.slice(0..range.len()).iter() {
					result.extend(unit.to_le_bytes());
				}
			} else {
				let mut snapshot = buffer.snapshot_range(range.clone())?;
				while let Some(chunk) = snapshot.read() {
					for unit in chunk.iter() {
						result.extend(unit.to_le_bytes());
					}
				}
			}
		}
	}
	if let Some(lines) = &prepared.trim_auto_whitespace_lines {
		append_values(&mut result, lines.iter().map(|line| *line as u32));
	}
	*buffer = prepared.buffer;
	Ok(Some(result))
}

fn append_values(result: &mut Vec<u8>, values: impl IntoIterator<Item = u32>) {
	for value in values {
		result.extend(value.to_be_bytes());
	}
}

fn append_text(result: &mut Vec<u8>, text: &[u16]) {
	for unit in text {
		result.extend(unit.to_le_bytes());
	}
}

fn decode_edit<'a>(value: &[u32; 7], units: &'a [u16]) -> Result<ModelEdit<'a>, BufferError> {
	if value[6] & !7 != 0 {
		return Err(BufferError::InvalidRange);
	}
	let start = value[4] as usize;
	let end = start
		.checked_add(value[5] as usize)
		.ok_or(BufferError::InvalidRange)?;
	Ok(ModelEdit {
		range: TextRange {
			start: Position {
				line_number: value[0] as usize,
				column: value[1] as usize,
			},
			end: Position {
				line_number: value[2] as usize,
				column: value[3] as usize,
			},
		},
		text: units.get(start..end).ok_or(BufferError::InvalidRange)?,
		force_move_markers: value[6] & 1 != 0,
		auto_whitespace: value[6] & 2 != 0,
		tracked: value[6] & 4 != 0,
	})
}
