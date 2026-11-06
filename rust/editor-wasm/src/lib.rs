/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Typed WebAssembly bindings. Text crosses the boundary as UTF-16, never a lossy Rust string.

use vscode_editor_core::{
	BufferError, Position, TextBuffer, TextEdit, TextSnapshot, compute_active_indent_guide,
	compute_indent_guides, compute_indentation_folding, guess_indentation,
};
use wasm_bindgen::prelude::*;

mod arrays;
mod bracket_collection;
mod bracket_edits;
mod bracket_lengths;
mod bracket_node_reader;
mod bracket_pair_collection;
mod bracket_parser;
mod bracket_position_mapper;
mod bracket_tokenizer;
mod bracket_trees;
mod contiguous_tokens_block;
mod contiguous_tokens_store;
mod cursor_columns;
mod decorations;
mod fast_bracket_tokenizer;
mod line_tokens;
mod model_edits;
mod sequence_diff;
mod small_immutable_set;
mod sparse_tokens_store;
mod text_change;
mod text_shape;
mod text_transfer;
mod token_array;
mod token_iteration;
mod token_serialization;
mod tokens;
mod unicode;

/// Identifies the storage contract independently of the binding generator's version.
#[wasm_bindgen]
pub fn text_buffer_abi_version() -> u32 {
	8
}

#[wasm_bindgen]
pub struct WasmTextBuffer {
	buffer: TextBuffer,
}

#[wasm_bindgen]
impl WasmTextBuffer {
	#[wasm_bindgen(constructor)]
	pub fn new(units: &[u16]) -> Self {
		Self {
			buffer: TextBuffer::new(units),
		}
	}

	pub fn from_text(text: &str) -> Self {
		Self {
			buffer: TextBuffer::from_text(text),
		}
	}

	pub fn length(&self) -> usize {
		self.buffer.len()
	}

	pub fn line_count(&self) -> usize {
		self.buffer.line_count()
	}

	pub fn replace(&mut self, offset: usize, length: usize, units: &[u16]) -> Result<(), JsError> {
		let end = offset
			.checked_add(length)
			.ok_or(BufferError::InvalidRange)?;
		Ok(self.buffer.replace(offset..end, units)?)
	}

	pub fn replace_text(
		&mut self,
		offset: usize,
		length: usize,
		text: &str,
	) -> Result<(), JsError> {
		let end = offset
			.checked_add(length)
			.ok_or(BufferError::InvalidRange)?;
		Ok(self.buffer.replace_text(offset..end, text)?)
	}

	/// Receives ascending replacements as offset, length, text offset, and text length tuples.
	pub fn apply_edits(&mut self, ranges: &[u32], units: &[u16]) -> Result<(), JsError> {
		let (ranges, remainder) = ranges.as_chunks::<4>();
		if !remainder.is_empty() {
			return Err(BufferError::InvalidRange.into());
		}
		let edits: Result<Vec<_>, BufferError> = ranges
			.iter()
			.map(|range| {
				let start = range[0] as usize;
				let end = start
					.checked_add(range[1] as usize)
					.ok_or(BufferError::InvalidRange)?;
				let text_start = range[2] as usize;
				let text_end = text_start
					.checked_add(range[3] as usize)
					.ok_or(BufferError::InvalidRange)?;
				let text = units
					.get(text_start..text_end)
					.ok_or(BufferError::InvalidRange)?;
				Ok(TextEdit {
					range: start..end,
					text,
				})
			})
			.collect();
		Ok(self.buffer.apply_edits(&edits?)?)
	}

	/// Prepares model edits, inverse records, and whitespace candidates in one native scope.
	pub fn apply_model_edits(
		&mut self,
		operations: &[u32],
		units: &[u16],
		crlf: bool,
		flags: u32,
		record_trim_auto_whitespace: bool,
		compute_undo_edits: bool,
	) -> Result<Option<Vec<u8>>, JsError> {
		model_edits::apply(
			&mut self.buffer,
			operations,
			units,
			crlf,
			flags,
			record_trim_auto_whitespace,
			compute_undo_edits,
		)
	}

	pub fn slice(&self, offset: usize, length: usize) -> Result<Vec<u16>, JsError> {
		let end = offset
			.checked_add(length)
			.ok_or(BufferError::InvalidRange)?;
		Ok(self.buffer.slice(offset..end)?)
	}

	pub fn slice_text(&self, offset: usize, length: usize) -> Result<JsValue, JsError> {
		let end = offset
			.checked_add(length)
			.ok_or(BufferError::InvalidRange)?;
		Ok(text_transfer::read_range(&self.buffer, offset..end)?)
	}

	pub fn offset_at(&self, line_number: usize, column: usize) -> Result<usize, JsError> {
		Ok(self.buffer.offset_at(Position {
			line_number,
			column,
		})?)
	}

	pub fn position_at(&self, offset: usize) -> Vec<u32> {
		let position = self.buffer.position_at(offset);
		vec![position.line_number as u32, position.column as u32]
	}

	pub fn line_content(&self, line_number: usize) -> Result<Vec<u16>, JsError> {
		Ok(self.buffer.line_content(line_number)?)
	}

	pub fn first_non_whitespace_column(&self, line_number: usize) -> Result<usize, JsError> {
		Ok(self.buffer.first_non_whitespace_column(line_number)?)
	}

	pub fn last_non_whitespace_column(&self, line_number: usize) -> Result<usize, JsError> {
		Ok(self.buffer.last_non_whitespace_column(line_number)?)
	}

	pub fn guess_indentation(
		&self,
		default_tab_size: f64,
		default_insert_spaces: bool,
	) -> Result<Vec<f64>, JsError> {
		let guess = guess_indentation(&self.buffer, default_tab_size, default_insert_spaces)?;
		Ok(vec![guess.tab_size, f64::from(guess.insert_spaces)])
	}

	pub fn indent_guides(
		&self,
		start_line: f64,
		end_line: f64,
		tab_size: f64,
		indent_size: f64,
		off_side: bool,
	) -> Result<Option<Vec<f64>>, JsError> {
		if !is_line_number(start_line) || !is_line_number(end_line) {
			return Ok(None);
		}
		Ok(compute_indent_guides(
			&self.buffer,
			start_line as usize,
			end_line as usize,
			tab_size,
			indent_size,
			off_side,
		)?)
	}

	pub fn active_indent_guide(
		&self,
		line: f64,
		min_line: f64,
		max_line: f64,
		tab_size: f64,
		indent_size: f64,
		off_side: bool,
	) -> Result<Option<Vec<f64>>, JsError> {
		if !is_line_number(line) {
			return Ok(None);
		}
		let min_line = min_line.ceil() as usize;
		let max_line = if max_line.is_nan() {
			usize::MAX
		} else {
			max_line.floor() as usize
		};
		Ok(compute_active_indent_guide(
			&self.buffer,
			line as usize,
			min_line,
			max_line,
			tab_size,
			indent_size,
			off_side,
		)?
		.map(|guide| vec![guide.start_line as f64, guide.end_line as f64, guide.indent]))
	}

	/// Computes indentation folding in one native scope; JavaScript retains regex semantics.
	pub fn indentation_folding(
		&self,
		tab_size: f64,
		off_side: bool,
		limit: f64,
		marker: Option<js_sys::Function>,
	) -> Result<Option<Vec<u32>>, JsValue> {
		if !limit.is_finite() || !(0.0..=65535.0).contains(&limit) || limit.fract() != 0.0 {
			return Ok(None);
		}
		let mut marker_start = 0;
		let mut marker_values = Vec::new();
		let result = compute_indentation_folding(
			&self.buffer,
			tab_size,
			off_side,
			limit as usize,
			&mut |line| -> Result<u8, JsValue> {
				if line >= marker_start
					&& let Some(&value) = marker_values.get(line - marker_start)
				{
					return Ok(value);
				}
				let Some(marker) = &marker else { return Ok(0) };
				let value = marker.call1(&JsValue::UNDEFINED, &JsValue::from_f64(line as f64))?;
				if value.is_instance_of::<js_sys::Uint8Array>() {
					let values = js_sys::Uint8Array::from(value);
					let length = values.length() as usize;
					if length == 0 || length > 64 || length > line {
						return Err(JsError::new(
							"The folding marker batch does not match the current model contract",
						)
						.into());
					}
					marker_values = values.to_vec();
					if marker_values.iter().any(|&value| value > 2) {
						return Err(JsError::new(
							"The folding marker batch does not match the current model contract",
						)
						.into());
					}
					marker_start = line + 1 - length;
					return Ok(marker_values[length - 1]);
				}
				match value.as_f64() {
					Some(0.0) => Ok(0),
					Some(1.0) => Ok(1),
					Some(2.0) => Ok(2),
					_ => Err(JsError::new(
						"The folding marker does not match the current model contract",
					)
					.into()),
				}
			},
		)?;
		let Some(result) = result else {
			return Ok(None);
		};
		let mut values = Vec::new();
		if values
			.try_reserve_exact(1 + result.starts.len() * 2)
			.is_err()
		{
			return Ok(None);
		}
		values.push(result.computed as u32);
		values.extend_from_slice(&result.starts);
		values.extend_from_slice(&result.ends);
		Ok(Some(values))
	}

	/// Unsupported visible-line coordinates leave the existing character-count path available.
	pub fn character_count(
		&self,
		start_line: usize,
		start_column: usize,
		end_line: usize,
		end_column: usize,
		eol_length: usize,
	) -> Option<usize> {
		self.buffer
			.character_count(
				Position {
					line_number: start_line,
					column: start_column,
				},
				Position {
					line_number: end_line,
					column: end_column,
				},
				eol_length,
			)
			.ok()
	}

	pub fn line_batch(
		&self,
		start_line: usize,
		max_lines: usize,
		max_units: usize,
	) -> Result<JsValue, JsError> {
		let range = self
			.buffer
			.line_batch_range(start_line, max_lines, max_units)?;
		Ok(text_transfer::read_range(&self.buffer, range)?)
	}

	pub fn backward_line_batch(
		&self,
		end_line: usize,
		max_lines: usize,
		max_units: usize,
	) -> Result<JsValue, JsError> {
		let range = self
			.buffer
			.backward_line_batch_range(end_line, max_lines, max_units)?;
		Ok(text_transfer::read_range(&self.buffer, range)?)
	}

	pub fn find_literal(
		&self,
		start_line: usize,
		start_column: usize,
		end_line: usize,
		end_column: usize,
		needle: &[u16],
		limit: usize,
	) -> Result<Vec<u32>, JsError> {
		let matches = self.buffer.find_literal(
			Position {
				line_number: start_line,
				column: start_column,
			},
			Position {
				line_number: end_line,
				column: end_column,
			},
			needle,
			limit,
		)?;
		Ok(matches
			.into_iter()
			.flat_map(|position| [position.line_number as u32, position.column as u32])
			.collect())
	}

	pub fn line_length(&self, line_number: usize) -> Result<usize, JsError> {
		Ok(self.buffer.line_length(line_number)?)
	}

	pub fn char_code(&self, offset: usize) -> i32 {
		self.buffer.char_at(offset).map_or(-1, i32::from)
	}

	pub fn nearest_chunk(&self, offset: usize) -> Vec<u16> {
		self.buffer.chunk_at(offset).iter().collect()
	}

	pub fn normalize_eol(&mut self, crlf: bool) {
		self.buffer.normalize_eol(crlf);
	}

	pub fn snapshot(&self) -> WasmTextSnapshot {
		WasmTextSnapshot {
			snapshot: self.buffer.snapshot(),
		}
	}
}

#[wasm_bindgen]
pub struct WasmTextSnapshot {
	snapshot: TextSnapshot,
}

fn is_line_number(value: f64) -> bool {
	value.is_finite() && (1.0..=u32::MAX as f64).contains(&value) && value.fract() == 0.0
}

#[wasm_bindgen]
impl WasmTextSnapshot {
	pub fn read(&mut self) -> Option<JsValue> {
		text_transfer::read_text(&mut self.snapshot, 65536)
	}
}
