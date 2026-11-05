/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use std::ops::Range;

use vscode_editor_core::{BufferError, TextBuffer, TextChunk, TextSnapshot};
use wasm_bindgen::JsValue;

/// ASCII uses the binding's string path; other text retains UTF-16 for native JavaScript decoding.
enum TextTransfer {
	Ascii(String),
	Utf16(Vec<u16>),
}

impl TextTransfer {
	fn new(capacity: usize) -> Self {
		Self::Ascii(String::with_capacity(capacity))
	}

	fn append(&mut self, chunk: TextChunk<'_>) {
		match self {
			Self::Ascii(text) => {
				if let TextChunk::Latin1(units) = chunk
					&& units.is_ascii()
				{
					text.push_str(std::str::from_utf8(units).expect("ASCII is valid UTF-8"));
					return;
				}
				let mut units = Vec::with_capacity(text.capacity().max(text.len() + chunk.len()));
				units.extend(text.bytes().map(u16::from));
				chunk.copy_to(&mut units);
				*self = Self::Utf16(units);
			}
			Self::Utf16(units) => chunk.copy_to(units),
		}
	}

	fn into_js(self) -> JsValue {
		match self {
			Self::Ascii(text) => JsValue::from_str(&text),
			Self::Utf16(units) => js_sys::Uint16Array::from(units.as_slice()).into(),
		}
	}
}

pub(crate) fn read_range(buffer: &TextBuffer, range: Range<usize>) -> Result<JsValue, BufferError> {
	let mut snapshot = buffer.snapshot_range(range.clone())?;
	let chunk = buffer.chunk_at(range.start);
	if chunk.len() >= range.len() {
		return Ok(match chunk.slice(0..range.len()) {
			TextChunk::Latin1(units) if units.is_ascii() => {
				JsValue::from_str(std::str::from_utf8(units).expect("ASCII is valid UTF-8"))
			}
			TextChunk::Utf16(units) => js_sys::Uint16Array::from(units).into(),
			chunk => {
				let units: Vec<_> = chunk.iter().collect();
				js_sys::Uint16Array::from(units.as_slice()).into()
			}
		});
	}
	Ok(read_text(&mut snapshot, range.len()).unwrap_or_else(|| JsValue::from_str("")))
}

pub(crate) fn read_text(snapshot: &mut TextSnapshot, max_units: usize) -> Option<JsValue> {
	if snapshot.remaining_len() == 0 {
		return None;
	}
	let mut text = TextTransfer::new(snapshot.remaining_len().min(max_units));
	let mut count = 0;
	while count < max_units {
		let Some(chunk) = snapshot.read() else { break };
		count += chunk.len();
		text.append(chunk);
	}
	Some(text.into_js())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn transfer_preserves_latin1_bom_and_surrogates_across_chunk_boundaries() {
		let latin1: Vec<_> = (0..=255).collect();
		let cases: Vec<Vec<Vec<u16>>> = vec![
			vec![vec![65, 0], latin1.clone(), vec![0xFEFF, 0xD83D, 0xDE00]],
			vec![vec![65, 0xD800], vec![0xDC00, 66]],
			vec![latin1.clone(), vec![0xD800], vec![65, 0xDFFF]],
		];
		for chunks in cases {
			let expected: Vec<_> = chunks.iter().flatten().copied().collect();
			let mut transfer = TextTransfer::new(0);
			for chunk in &chunks {
				transfer.append(TextChunk::Utf16(chunk));
			}
			let actual: Vec<_> = match transfer {
				TextTransfer::Ascii(text) => text.encode_utf16().collect(),
				TextTransfer::Utf16(units) => units,
			};
			assert_eq!(actual, expected);
		}
		let mut transfer = TextTransfer::new(0);
		transfer.append(TextChunk::Latin1(&[65, 0, 128, 159, 255]));
		let TextTransfer::Utf16(units) = transfer else {
			panic!("Latin-1 outside ASCII retains its original code units");
		};
		assert_eq!(units, [65, 0, 128, 159, 255]);
		let mut transfer = TextTransfer::new(0);
		transfer.append(TextChunk::Latin1(b"ASCII\0"));
		let TextTransfer::Ascii(text) = transfer else {
			panic!("ASCII uses the string path");
		};
		assert_eq!(text, "ASCII\0");
	}
}
