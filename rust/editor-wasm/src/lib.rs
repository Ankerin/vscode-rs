/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Typed WebAssembly bindings. Text crosses the boundary as UTF-16, never a lossy Rust string.

use vscode_editor_core::{BufferError, Position, TextBuffer, TextSnapshot};
use wasm_bindgen::prelude::*;

mod text_transfer;

/// Identifies the storage contract independently of the binding generator's version.
#[wasm_bindgen]
pub fn text_buffer_abi_version() -> u32 {
	2
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

#[wasm_bindgen]
impl WasmTextSnapshot {
	pub fn read(&mut self) -> Option<JsValue> {
		text_transfer::read_text(&mut self.snapshot, 65536)
	}
}
