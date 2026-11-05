/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Token serialization writes the existing big-endian headers and original buffer bytes directly.

use crate::contiguous_tokens_store::integer;
use js_sys::{Array, Function, Object, Reflect, Uint8Array, Uint32Array};
use wasm_bindgen::prelude::*;

const MAX_ENTRIES: u32 = 262_144;
const MAX_BYTES: u32 = 16 * 1024 * 1024;

#[wasm_bindgen]
extern "C" {
	type Block;
	#[wasm_bindgen(method, getter, catch, js_name = _startLineNumber)]
	fn start(this: &Block) -> Result<f64, JsValue>;
	#[wasm_bindgen(method, getter, catch, js_name = _tokens)]
	fn lines(this: &Block) -> Result<JsValue, JsValue>;
}

struct EncodedBlock {
	start: u32,
	lines: Vec<Uint32Array>,
}

struct DecodedBlock {
	start: u32,
	lines: Vec<(u32, u32)>,
}

/// Parses supported streams and returns the same source-buffer views without a persistent decoded copy.
#[wasm_bindgen]
pub fn decode_contiguous_token_blocks(
	source: Uint8Array,
	offset: f64,
	include_count: bool,
) -> Result<Option<Array>, JsError> {
	if !integer(offset)
		|| offset < 0.0
		|| offset > f64::from(source.length())
		|| !(offset as u64).is_multiple_of(4)
		|| source.byte_offset() != 0
		|| source.byte_length() != source.buffer().byte_length()
		|| !source.length().is_multiple_of(4)
		|| source.length() > MAX_BYTES
	{
		return Ok(None);
	}
	let mut bytes = Vec::new();
	if bytes.try_reserve_exact(source.length() as usize).is_err() {
		return Ok(None);
	}
	bytes.resize(source.length() as usize, 0);
	source.copy_to(&mut bytes);
	let mut offset = offset as usize;
	let count = if include_count {
		let Some(count) = read_header(&bytes, &mut offset) else {
			return Ok(None);
		};
		count
	} else {
		1
	};
	if count > MAX_ENTRIES {
		return Ok(None);
	}
	let mut blocks = Vec::new();
	if blocks.try_reserve_exact(count as usize).is_err() {
		return Ok(None);
	}
	let mut total_lines: u32 = 0;
	for _ in 0..count {
		let Some(start) = read_header(&bytes, &mut offset) else {
			return Ok(None);
		};
		let Some(count) = read_header(&bytes, &mut offset) else {
			return Ok(None);
		};
		total_lines = total_lines.saturating_add(count);
		if total_lines > MAX_ENTRIES {
			return Ok(None);
		}
		let mut lines = Vec::new();
		if lines.try_reserve_exact(count as usize).is_err() {
			return Ok(None);
		}
		for _ in 0..count {
			let Some(length) = read_header(&bytes, &mut offset) else {
				return Ok(None);
			};
			let end = offset.saturating_add(length as usize);
			if !length.is_multiple_of(4) || end > bytes.len() {
				return Ok(None);
			}
			lines.push((offset as u32 / 4, end as u32 / 4));
			offset = end;
		}
		blocks.push(DecodedBlock { start, lines });
	}
	let view = Uint32Array::new(&source.buffer());
	let result_blocks = Array::new();
	for block in blocks {
		let lines = Array::new();
		for (start, end) in block.lines {
			lines.push(&view.subarray(start, end));
		}
		let result = Array::new();
		result.push(&JsValue::from(block.start));
		result.push(&lines);
		result_blocks.push(&result);
	}
	let result = Array::new();
	result.push(&JsValue::from(offset as f64));
	result.push(&result_blocks);
	Ok(Some(result))
}

fn read_header(bytes: &[u8], offset: &mut usize) -> Option<u32> {
	let result = u32::from_be_bytes(
		bytes
			.get(*offset..offset.checked_add(4)?)?
			.try_into()
			.ok()?,
	);
	*offset += 4;
	Some(result)
}

/// Computes the existing byte size without copying encoded records or invoking nested bindings.
#[wasm_bindgen]
pub fn contiguous_token_blocks_size(
	blocks: Array,
	standard_size: Function,
	standard_write: Function,
	include_count: bool,
) -> Result<Option<u32>, JsValue> {
	Ok(collect(&blocks, &standard_size, &standard_write, include_count)?.map(|(_, size)| size))
}

/// Writes a supported block stream into the caller's existing view; unsupported states stay untouched.
#[wasm_bindgen]
pub fn serialize_contiguous_token_blocks(
	blocks: Array,
	standard_size: Function,
	standard_write: Function,
	destination: Uint8Array,
	offset: f64,
	include_count: bool,
) -> Result<Option<f64>, JsValue> {
	if !integer(offset) || offset < 0.0 || offset > f64::from(destination.length()) {
		return Ok(None);
	}
	let Some((blocks, size)) = collect(&blocks, &standard_size, &standard_write, include_count)?
	else {
		return Ok(None);
	};
	if size > destination.length() - offset as u32 {
		return Ok(None);
	}
	Ok(Some(f64::from(write(
		&blocks,
		&destination,
		offset as u32,
		include_count,
	))))
}

/// Allocates one existing JavaScript byte buffer and writes records without a second native encoding.
#[wasm_bindgen]
pub fn encode_contiguous_token_blocks(
	blocks: Array,
	standard_size: Function,
	standard_write: Function,
) -> Result<Option<Uint8Array>, JsValue> {
	let Some((blocks, size)) = collect(&blocks, &standard_size, &standard_write, true)? else {
		return Ok(None);
	};
	let destination = Uint8Array::new_with_length(size);
	write(&blocks, &destination, 0, true);
	Ok(Some(destination))
}

fn collect(
	blocks: &Array,
	standard_size: &Function,
	standard_write: &Function,
	include_count: bool,
) -> Result<Option<(Vec<EncodedBlock>, u32)>, JsValue> {
	if blocks.length() > MAX_ENTRIES {
		return Ok(None);
	}
	let size_method: &JsValue = standard_size.as_ref();
	let write_method: &JsValue = standard_write.as_ref();
	let mut result = Vec::new();
	if result.try_reserve_exact(blocks.length() as usize).is_err() {
		return Ok(None);
	}
	let mut size: u32 = if include_count { 4 } else { 0 };
	let mut line_count: u32 = 0;
	for value in blocks.iter() {
		let block: &Block = value.unchecked_ref();
		if !standard_method(&value, "serializeSize", size_method)
			|| !standard_method(&value, "serialize", write_method)
		{
			return Ok(None);
		}
		let start = block.start()?;
		let values = block.lines()?;
		if !integer(start) || !Array::is_array(&values) {
			return Ok(None);
		}
		let values: &Array = values.unchecked_ref();
		line_count = line_count.saturating_add(values.length());
		if line_count > MAX_ENTRIES {
			return Ok(None);
		}
		size = size.saturating_add(8);
		let mut lines = Vec::new();
		if lines.try_reserve_exact(values.length() as usize).is_err() {
			return Ok(None);
		}
		for value in values.iter() {
			let Some(tokens) = value.dyn_ref::<Uint32Array>() else {
				return Ok(None);
			};
			// Existing serialization copies the entire backing buffer. Preserve unusual subviews on fallback.
			if tokens.byte_offset() != 0 || tokens.byte_length() != tokens.buffer().byte_length() {
				return Ok(None);
			}
			size = size.saturating_add(4).saturating_add(tokens.byte_length());
			if size > MAX_BYTES {
				return Ok(None);
			}
			lines.push(tokens.clone());
		}
		result.push(EncodedBlock {
			start: start as i64 as u32,
			lines,
		});
	}
	Ok((size <= MAX_BYTES).then_some((result, size)))
}

// Inspect descriptors without invoking accessors that the original size-only path never reads.
fn standard_method(value: &JsValue, name: &str, expected: &JsValue) -> bool {
	let name = JsValue::from_str(name);
	let mut object: Object = value.clone().unchecked_into();
	while !object.is_null() {
		let descriptor = Object::get_own_property_descriptor(&object, &name);
		if !descriptor.is_undefined() {
			return Reflect::get(&descriptor, &JsValue::from_str("value"))
				.is_ok_and(|value| value == *expected);
		}
		object = Object::get_prototype_of(&object);
	}
	false
}

fn write(
	blocks: &[EncodedBlock],
	destination: &Uint8Array,
	mut offset: u32,
	include_count: bool,
) -> u32 {
	if include_count {
		write_header(destination, blocks.len() as u32, offset);
		offset += 4;
	}
	for block in blocks {
		write_header(destination, block.start, offset);
		write_header(destination, block.lines.len() as u32, offset + 4);
		offset += 8;
		for tokens in &block.lines {
			write_header(destination, tokens.byte_length(), offset);
			offset += 4;
			let bytes = Uint8Array::new_with_byte_offset_and_length(
				&tokens.buffer(),
				0,
				tokens.byte_length(),
			);
			destination.set(&bytes, offset);
			offset += tokens.byte_length();
		}
	}
	offset
}

fn write_header(destination: &Uint8Array, value: u32, offset: u32) {
	// Match the existing helper's assignment order when caller buffers alias serialized records.
	for index in (0..4).rev() {
		destination.set_index(offset + index, (value >> ((3 - index) * 8)) as u8);
	}
}
