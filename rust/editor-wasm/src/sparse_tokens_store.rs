/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Sparse piece orchestration retains the original mutable piece-array and object identities.

use js_sys::{Array, Function, Uint32Array};
use vscode_editor_core::{SparseTokenEdit, edit_sparse_tokens};
use wasm_bindgen::prelude::*;

const MAX_PIECES: u32 = 262_144;

#[wasm_bindgen]
extern "C" {
	type Piece;
	#[wasm_bindgen(method, getter, catch, js_name = acceptEdit)]
	fn edit_function(this: &Piece) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, getter, catch, js_name = _startLineNumber)]
	fn block_start(this: &Piece) -> Result<f64, JsValue>;
	#[wasm_bindgen(method, setter, catch, js_name = _startLineNumber)]
	fn set_block_start(this: &Piece, value: f64) -> Result<(), JsValue>;
	#[wasm_bindgen(method, setter, catch, js_name = _endLineNumber)]
	fn set_block_end(this: &Piece, value: f64) -> Result<(), JsValue>;
	#[wasm_bindgen(method, getter, catch, js_name = _tokens)]
	fn storage(this: &Piece) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, getter, catch, js_name = startLineNumber)]
	fn start_line(this: &Piece) -> Result<f64, JsValue>;
	#[wasm_bindgen(method, getter, catch, js_name = endLineNumber)]
	fn end_line(this: &Piece) -> Result<f64, JsValue>;
	#[wasm_bindgen(method, catch, js_name = getRange)]
	fn range(this: &Piece) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = getLineTokens)]
	fn line_tokens(this: &Piece, line: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = removeTokens)]
	fn remove(this: &Piece, range: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = isEmpty)]
	fn empty(this: &Piece) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = split)]
	fn split(this: &Piece, range: &JsValue) -> Result<Array, JsValue>;
	#[wasm_bindgen(method, catch, js_name = acceptEdit)]
	fn edit(
		this: &Piece,
		range: &JsValue,
		eols: f64,
		first_length: f64,
		last_length: f64,
		first_code: f64,
	) -> Result<(), JsValue>;

	type Storage;
	#[wasm_bindgen(method, getter, catch, js_name = _tokens)]
	fn tokens(this: &Storage) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, getter, catch, js_name = _tokenCount)]
	fn count(this: &Storage) -> Result<f64, JsValue>;
	#[wasm_bindgen(method, setter, catch, js_name = _tokenCount)]
	fn set_count(this: &Storage, value: f64) -> Result<(), JsValue>;

	type TokenRange;
	#[wasm_bindgen(method, getter, catch, js_name = startLineNumber)]
	fn start_line(this: &TokenRange) -> Result<f64, JsValue>;
	#[wasm_bindgen(method, getter, catch, js_name = startColumn)]
	fn start_column(this: &TokenRange) -> Result<f64, JsValue>;
	#[wasm_bindgen(method, getter, catch, js_name = endLineNumber)]
	fn end_line(this: &TokenRange) -> Result<f64, JsValue>;
	#[wasm_bindgen(method, getter, catch, js_name = endColumn)]
	fn end_column(this: &TokenRange) -> Result<f64, JsValue>;
	#[wasm_bindgen(method, catch, js_name = plusRange)]
	fn plus(this: &TokenRange, other: &JsValue) -> Result<JsValue, JsValue>;
}

/// Owns completion, piece selection, partial updates, and edit/removal orchestration.
#[wasm_bindgen]
pub struct WasmSparseTokensStore {
	pieces: Array,
	complete: bool,
	standard_edit: Option<JsValue>,
}

#[wasm_bindgen]
impl WasmSparseTokensStore {
	#[wasm_bindgen(constructor)]
	pub fn new(standard_edit: Option<Function>) -> Self {
		Self {
			pieces: Array::new(),
			complete: false,
			standard_edit: standard_edit.map(Into::into),
		}
	}

	pub fn flush(&mut self) {
		self.pieces = Array::new();
		self.complete = false;
	}

	pub fn is_empty(&self) -> bool {
		self.pieces.length() == 0
	}

	pub fn is_complete(&self) -> bool {
		self.complete
	}

	/// Keeps the caller's original array; external edits to that array remain observable.
	pub fn set_pieces(&mut self, pieces: Array, complete: bool) -> bool {
		if pieces.length() > MAX_PIECES {
			return false;
		}
		self.pieces = pieces;
		self.complete = complete;
		true
	}

	pub fn export_pieces(&self) -> Array {
		self.pieces.clone()
	}

	/// Returns the same line-token view selected by the original piece boundary search.
	pub fn get_line_tokens(&self, line: f64) -> Result<JsValue, JsValue> {
		let length = self.pieces.length();
		if length == 0 {
			return Ok(JsValue::NULL);
		}
		let mut low = 0;
		let mut high = length - 1;
		while low < high {
			let mut mid = low + (high - low) / 2;
			let value = self.pieces.get(mid);
			let piece = as_piece(&value);
			if piece.end_line()? < line {
				low = mid + 1;
			} else if piece.start_line()? > line {
				high = mid.saturating_sub(1);
			} else {
				while mid > low {
					let previous = self.pieces.get(mid - 1);
					let previous = as_piece(&previous);
					if !(previous.start_line()? <= line && line <= previous.end_line()?) {
						break;
					}
					mid -= 1;
				}
				return as_piece(&self.pieces.get(mid)).line_tokens(line);
			}
		}
		as_piece(&self.pieces.get(low)).line_tokens(line)
	}

	/// Retains Range identity, touching-token removal, original array splices, and insertion order.
	pub fn set_partial(
		&mut self,
		range: JsValue,
		pieces: Array,
	) -> Result<Option<JsValue>, JsValue> {
		if self
			.pieces
			.length()
			.saturating_mul(2)
			.saturating_add(pieces.length())
			> MAX_PIECES
			|| !supported_range(&range)?
		{
			return Ok(None);
		}
		let mut range = range;
		if pieces.length() > 0 {
			let first = as_piece(&pieces.get(0)).range()?;
			let last = as_piece(&pieces.get(pieces.length() - 1)).range()?;
			if first.is_null() || last.is_null() {
				return Ok(Some(range));
			}
			if !supported_range(&first)? || !supported_range(&last)? {
				return Ok(None);
			}
			range = as_range(&range).plus(&first)?;
			range = as_range(&range).plus(&last)?;
		}
		let start = as_range(&range).start_line()?;
		let end = as_range(&range).end_line()?;
		let mut insertion = None;
		let mut index = 0;
		let mut length = self.pieces.length();
		while index < length {
			let value = self.pieces.get(index);
			let piece = as_piece(&value);
			if piece.end_line()? < start {
				index += 1;
				continue;
			}
			if piece.start_line()? > end {
				insertion.get_or_insert(index);
				break;
			}
			piece.remove(&range)?;
			if piece.empty()? {
				remove_at(&self.pieces, index);
				length -= 1;
				continue;
			}
			if piece.end_line()? < start {
				index += 1;
				continue;
			}
			if piece.start_line()? > end {
				insertion.get_or_insert(index);
				index += 1;
				continue;
			}
			let split = piece.split(&range)?;
			let first = split.get(0);
			let second = split.get(1);
			if as_piece(&first).empty()? {
				insertion.get_or_insert(index);
				index += 1;
				continue;
			}
			if as_piece(&second).empty()? {
				index += 1;
				continue;
			}
			for slot in (index + 1..length).rev() {
				self.pieces.set(slot + 1, self.pieces.get(slot));
			}
			self.pieces.set(index, first);
			self.pieces.set(index + 1, second);
			index += 1;
			length += 1;
			insertion.get_or_insert(index);
			index += 1;
		}
		if pieces.length() > 0 {
			let at = insertion.unwrap_or(self.pieces.length());
			let result = Array::new();
			for index in 0..at {
				result.push(&self.pieces.get(index));
			}
			for piece in pieces.iter() {
				result.push(&piece);
			}
			for index in at..self.pieces.length() {
				result.push(&self.pieces.get(index));
			}
			self.pieces = result;
		}
		Ok(Some(range))
	}

	/// Edits each original piece and removes empty entries from the existing aliased array.
	pub fn accept_edit(
		&mut self,
		range: &JsValue,
		eols: f64,
		first_length: f64,
		last_length: f64,
		first_code: f64,
	) -> Result<bool, JsValue> {
		if self.pieces.length() > MAX_PIECES
			|| !supported_range(range)?
			|| [eols, first_length, last_length, first_code]
				.iter()
				.any(|&value| !integer(value))
		{
			return Ok(false);
		}
		let mut index = 0;
		while index < self.pieces.length() {
			let value = self.pieces.get(index);
			let piece = as_piece(&value);
			let edited = if let Some(standard) = &self.standard_edit {
				if piece.edit_function()? == *standard {
					edit_piece(piece, range, eols, first_length, last_length, first_code)?
				} else {
					false
				}
			} else {
				false
			};
			if !edited {
				piece.edit(range, eols, first_length, last_length, first_code)?;
			}
			if piece.empty()? {
				remove_at(&self.pieces, index);
			} else {
				index += 1;
			}
		}
		Ok(true)
	}
}

impl Default for WasmSparseTokensStore {
	fn default() -> Self {
		Self::new(None)
	}
}

/// Runs standard piece editing in this native scope, avoiding nested bindings and per-piece packets.
fn edit_piece(
	piece: &Piece,
	range: &JsValue,
	eols: f64,
	first_length: f64,
	last_length: f64,
	first_code: f64,
) -> Result<bool, JsValue> {
	let start = piece.block_start()?;
	let value = piece.storage()?;
	let storage: &Storage = value.unchecked_ref();
	let count = storage.count()?;
	let value = storage.tokens()?;
	if !integer(start)
		|| !integer(count)
		|| count < 0.0
		|| count > 1024.0 * 1024.0
		|| !value.is_instance_of::<Uint32Array>()
	{
		return Ok(false);
	}
	let tokens: &Uint32Array = value.unchecked_ref();
	if count * 4.0 > f64::from(tokens.length()) {
		return Ok(false);
	}
	let range = as_range(range);
	let mut edit = SparseTokenEdit {
		block_start: start as i64,
		start_line: range.start_line()? as i64,
		start_column: range.start_column()? as i64,
		end_line: range.end_line()? as i64,
		end_column: range.end_column()? as i64,
		eol_count: eols as i64,
		first_line_length: first_length as i64,
		last_line_length: last_length as i64,
		first_char_code: first_code as i64,
	};
	if edit.start_line < 1
		|| edit.start_column < 1
		|| edit.end_line < edit.start_line
		|| edit.end_column < 1
		|| (edit.start_line == edit.end_line && edit.end_column < edit.start_column)
		|| eols < 0.0
		|| first_length < 0.0
		|| last_length < 0.0
	{
		return Ok(false);
	}
	let count = count as u32;
	let max_line = if count == 0 {
		-1
	} else {
		i64::from(tokens.get_index((count - 1) * 4))
	};
	// Outside edits change only scalar coordinates. Read the current backing delta, not cached end.
	if edit.end_line < edit.block_start {
		edit.block_start += edit.eol_count - (edit.end_line - edit.start_line);
		piece.set_block_start(edit.block_start as f64)?;
		piece.set_block_end((edit.block_start + max_line) as f64)?;
		return Ok(true);
	}
	if edit.start_line > edit.block_start + max_line {
		piece.set_block_end((edit.block_start + max_line) as f64)?;
		return Ok(true);
	}
	let active = tokens.subarray(0, count * 4);
	let mut words = active.to_vec();
	let update =
		edit_sparse_tokens(&mut words, &edit).map_err(|error| JsError::new(&error.to_string()))?;
	active.copy_from(&words);
	storage.set_count(update.count as f64)?;
	piece.set_block_start(update.start_line as f64)?;
	let max_line = if update.count == 0 {
		-1
	} else {
		i64::from(words[(update.count - 1) * 4])
	};
	piece.set_block_end((update.start_line + max_line) as f64)?;
	Ok(true)
}

fn remove_at(array: &Array, index: u32) {
	let length = array.length();
	for slot in index..length - 1 {
		array.set(slot, array.get(slot + 1));
	}
	array.set_length(length - 1);
}

fn supported_range(value: &JsValue) -> Result<bool, JsValue> {
	let range = as_range(value);
	Ok([
		range.start_line()?,
		range.start_column()?,
		range.end_line()?,
		range.end_column()?,
	]
	.iter()
	.all(|&value| integer(value)))
}

fn integer(value: f64) -> bool {
	value.is_finite() && value.fract() == 0.0 && value.abs() <= (1u64 << 40) as f64
}

// These objects originate from the existing private constructors; generated methods preserve errors.
fn as_piece(value: &JsValue) -> &Piece {
	value.unchecked_ref()
}
fn as_range(value: &JsValue) -> &TokenRange {
	value.unchecked_ref()
}
