/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Owning line indexing over existing JavaScript token buffers keeps externally mutable aliases.

use js_sys::{Array, ArrayBuffer, Uint32Array};
use vscode_editor_core::{
	ContiguousTokensUpdate, append_contiguous_tokens, delete_contiguous_tokens,
	insert_contiguous_tokens,
};
use wasm_bindgen::prelude::*;

pub(crate) const MAX_LINES: usize = 262_144;
pub(crate) const MAX_WORDS: u32 = 4 * 1024 * 1024;

/// Owns syntax line state without retaining a second decoded token/document representation.
#[wasm_bindgen]
pub struct WasmContiguousTokensStore {
	lines: Vec<JsValue>,
	empty: JsValue,
}

#[wasm_bindgen]
impl WasmContiguousTokensStore {
	#[wasm_bindgen(constructor)]
	pub fn new(empty: ArrayBuffer) -> Self {
		Self {
			lines: Vec::new(),
			empty: empty.into(),
		}
	}

	pub fn has_tokens(&self) -> bool {
		!self.lines.is_empty()
	}

	/// Releases all line references and index capacity, preserving previously returned views.
	pub fn flush(&mut self) {
		self.lines = Vec::new();
	}

	pub fn get_tokens(&self, index: f64) -> JsValue {
		if !integer(index) || index < 0.0 {
			return JsValue::UNDEFINED;
		}
		self.lines
			.get(index as usize)
			.cloned()
			.unwrap_or(JsValue::NULL)
	}

	/// Materializes only the reference index when a caller needs the unsupported-state fallback.
	pub fn export_lines(&self) -> Array {
		self.lines.iter().collect()
	}

	pub fn set_tokens(
		&mut self,
		language: u32,
		index: f64,
		text_length: f64,
		tokens: JsValue,
		check_equality: bool,
	) -> Result<Option<bool>, JsError> {
		if !integer(index)
			|| index < 0.0
			|| index >= MAX_LINES as f64
			|| !integer(text_length)
			|| text_length < 0.0
			|| (!tokens.is_null()
				&& !tokens.is_undefined()
				&& !tokens.is_instance_of::<Uint32Array>()
				&& !tokens.is_instance_of::<ArrayBuffer>())
		{
			return Ok(None);
		}
		let index = index as usize;
		if self
			.lines
			.try_reserve(index.saturating_add(1).saturating_sub(self.lines.len()))
			.is_err()
		{
			return Ok(None);
		}
		let tokens = if tokens.is_null() || tokens.is_undefined() {
			None
		} else {
			Some(view(&tokens))
		};
		if tokens
			.as_ref()
			.is_some_and(|tokens| tokens.length() > MAX_WORDS)
		{
			return Ok(None);
		}
		let massaged = if text_length == 0.0
			&& !tokens
				.as_ref()
				.is_some_and(|tokens| tokens.length() > 1 && tokens.get_index(1) & 255 != language)
		{
			self.empty.clone()
		} else if let Some(tokens) = tokens.filter(|tokens| tokens.length() != 0) {
			if tokens.length() >= 2 {
				tokens.set_index(tokens.length() - 2, text_length as i64 as u32);
			}
			if tokens.byte_offset() == 0 && tokens.byte_length() == tokens.buffer().byte_length() {
				tokens.buffer().into()
			} else {
				tokens.into()
			}
		} else {
			Uint32Array::from(&[text_length as i64 as u32, language | 0x0200_8400][..])
				.buffer()
				.into()
		};
		self.lines
			.resize_with(self.lines.len().max(index + 1), || JsValue::NULL);
		let old = std::mem::replace(&mut self.lines[index], massaged);
		Ok(Some(check_equality && !equal(&old, &self.lines[index])))
	}

	/// Owns deletion, line joining/removal, insertion affinity, and new null line slots in one call.
	pub fn accept_edit(&mut self, parameters: &[f64]) -> Result<bool, JsError> {
		let &[
			start_line,
			start_column,
			end_line,
			end_column,
			eol_count,
			first_length,
		] = parameters
		else {
			return Err(JsError::new(
				"The syntax token edit does not match the editor contract",
			));
		};
		if parameters.iter().any(|value| !integer(*value))
			|| start_line < 1.0
			|| start_column < 1.0
			|| end_line < start_line
			|| end_column < 1.0
			|| (start_line == end_line && end_column < start_column)
			|| eol_count < 0.0
			|| first_length < 0.0
		{
			return Ok(false);
		}
		let first = (start_line - 1.0) as usize;
		if first >= self.lines.len() {
			return Ok(true);
		}
		let last = (end_line - 1.0) as usize;
		let eols = eol_count as usize;
		let start = start_column as i64 - 1;
		let end = end_column as i64 - 1;
		let first_length = first_length as i64;
		// Preflight every affected encoding/allocation before changing public source buffers.
		let Some(capacity) = self
			.lines
			.len()
			.checked_add(eols)
			.filter(|&length| length <= MAX_LINES)
		else {
			return Ok(false);
		};
		if self.lines.try_reserve(capacity - self.lines.len()).is_err() {
			return Ok(false);
		}
		if !self.supports(first) || (last < self.lines.len() && !self.supports(last)) {
			return Ok(false);
		}
		if (first != last || eols != 0)
			&& !self.lines[first].is_null()
			&& self.lines[first] != self.empty
		{
			let tokens = view(&self.lines[first]);
			if i64::from(tokens.get_index(tokens.length() - 2)) < start {
				return Ok(false);
			}
		}
		if first != last
			&& last < self.lines.len()
			&& !self.lines[first].is_null()
			&& !self.lines[last].is_null()
			&& self.lines[first] != self.empty
			&& self.lines[last] != self.empty
			&& view(&self.lines[first]).length() + view(&self.lines[last]).length() > MAX_WORDS
		{
			return Ok(false);
		}
		if first == last && eols == 0 {
			self.lines[first] = self.edit_line(&self.lines[first], start, end, first_length)?;
			return Ok(true);
		}
		if first == last {
			if start != end {
				self.lines[first] = self.delete(&self.lines[first], start, end)?;
			}
		} else {
			self.lines[first] = self.delete_ending(&self.lines[first], start)?;
			let last_tokens = if last < self.lines.len() {
				self.delete(&self.lines[last], 0, end)?
			} else {
				JsValue::NULL
			};
			self.lines[first] = self.append(&self.lines[first], &last_tokens)?;
			let stop = last.saturating_add(1).min(self.lines.len());
			self.lines.drain(first + 1..stop);
		}
		if eols == 0 {
			if first_length != 0 {
				self.lines[first] = self.insert(&self.lines[first], start, first_length)?;
			}
		} else {
			self.lines[first] = self.delete_ending(&self.lines[first], start)?;
			self.lines[first] = self.insert(&self.lines[first], start, first_length)?;
			self.lines.splice(
				first + 1..first + 1,
				std::iter::repeat_n(JsValue::NULL, eols),
			);
		}
		Ok(true)
	}
}

impl WasmContiguousTokensStore {
	pub(crate) fn edit_line(
		&self,
		value: &JsValue,
		start: i64,
		end: i64,
		length: i64,
	) -> Result<JsValue, JsError> {
		if value.is_null() || *value == self.empty || (start == end && length == 0) {
			return Ok(value.clone());
		}
		let tokens = view(value);
		let mut words = tokens.to_vec();
		let result = delete_contiguous_tokens(&mut words, start, end)?;
		match result {
			ContiguousTokensUpdate::EmptyLine => Ok(self.empty.clone()),
			ContiguousTokensUpdate::Words(count) if count == words.len() => {
				if length != 0 {
					insert_contiguous_tokens(&mut words, start, length)?;
				}
				tokens.copy_from(&words);
				Ok(value.clone())
			}
			ContiguousTokensUpdate::Words(count) => {
				// Deletion still mutates the original alias; insertion belongs to the trimmed output.
				tokens.copy_from(&words);
				if length != 0 && count != 0 {
					insert_contiguous_tokens(&mut words[..count], start, length)?;
				}
				Ok(Uint32Array::from(&words[..count]).buffer().into())
			}
		}
	}

	fn supports(&self, index: usize) -> bool {
		supported(&self.lines[index], &self.empty)
	}

	pub(crate) fn delete(&self, value: &JsValue, start: i64, end: i64) -> Result<JsValue, JsError> {
		if value.is_null() || *value == self.empty || start == end {
			return Ok(value.clone());
		}
		let tokens = view(value);
		let mut words = tokens.to_vec();
		let result = delete_contiguous_tokens(&mut words, start, end)?;
		tokens.copy_from(&words);
		Ok(match result {
			ContiguousTokensUpdate::EmptyLine => self.empty.clone(),
			ContiguousTokensUpdate::Words(length) if length == words.len() => value.clone(),
			ContiguousTokensUpdate::Words(length) => {
				Uint32Array::from(&words[..length]).buffer().into()
			}
		})
	}

	pub(crate) fn delete_ending(&self, value: &JsValue, start: i64) -> Result<JsValue, JsError> {
		if value.is_null() || *value == self.empty {
			return Ok(value.clone());
		}
		let tokens = view(value);
		if tokens.length() == 0 {
			return Ok(if start == 0 {
				self.empty.clone()
			} else {
				Uint32Array::new_with_length(2).buffer().into()
			});
		}
		self.delete(
			value,
			start,
			i64::from(tokens.get_index(tokens.length() - 2)),
		)
	}

	pub(crate) fn insert(
		&self,
		value: &JsValue,
		character: i64,
		length: i64,
	) -> Result<JsValue, JsError> {
		if value.is_null() || *value == self.empty {
			return Ok(value.clone());
		}
		let tokens = view(value);
		if tokens.length() == 0 {
			return Ok(value.clone());
		}
		let mut words = tokens.to_vec();
		insert_contiguous_tokens(&mut words, character, length)?;
		tokens.copy_from(&words);
		Ok(value.clone())
	}

	pub(crate) fn append(&self, first: &JsValue, second: &JsValue) -> Result<JsValue, JsError> {
		if *second == self.empty {
			return Ok(first.clone());
		}
		if *first == self.empty {
			return Ok(second.clone());
		}
		if first.is_null() || second.is_null() {
			return Ok(JsValue::NULL);
		}
		let first = view(first).to_vec();
		let second = view(second).to_vec();
		let result = append_contiguous_tokens(&first, &second)?.ok_or_else(|| {
			JsError::new("The syntax token concatenation exceeded its preflight budget")
		})?;
		Ok(Uint32Array::from(result.as_slice()).buffer().into())
	}
}

pub(crate) fn integer(value: f64) -> bool {
	value.is_finite() && value.fract() == 0.0 && value.abs() <= (1u64 << 40) as f64
}

pub(crate) fn supported(value: &JsValue, empty: &JsValue) -> bool {
	if value.is_null() || value == empty {
		return true;
	}
	if !value.is_instance_of::<Uint32Array>() && !value.is_instance_of::<ArrayBuffer>() {
		return false;
	}
	let length = view(value).length();
	length != 0 && length.is_multiple_of(2) && length <= MAX_WORDS
}

pub(crate) fn view(value: &JsValue) -> Uint32Array {
	if let Some(tokens) = value.dyn_ref::<Uint32Array>() {
		tokens.clone()
	} else {
		Uint32Array::new(value)
	}
}

fn equal(first: &JsValue, second: &JsValue) -> bool {
	if first == second {
		return true;
	}
	if first.is_null() || second.is_null() {
		return first.is_null() && second.is_null();
	}
	let first = view(first);
	let second = view(second);
	first.length() == second.length() && first.to_vec() == second.to_vec()
}
