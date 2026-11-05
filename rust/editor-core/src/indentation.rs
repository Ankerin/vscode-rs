/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Indentation detection with the existing alignment and score preferences.

use crate::{BufferError, TextBuffer, TextChunk};

/// The detected indentation settings; an unscored source preserves its original defaults.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GuessedIndentation {
	pub tab_size: f64,
	pub insert_spaces: bool,
}

#[derive(Clone, Copy)]
struct IndentedLine<'a> {
	start: usize,
	length: usize,
	indentation: usize,
	spaces: usize,
	tabs: usize,
	prefix: TextChunk<'a>,
}

impl Default for IndentedLine<'_> {
	fn default() -> Self {
		Self {
			start: 0,
			length: 0,
			indentation: 0,
			spaces: 0,
			tabs: 0,
			prefix: TextChunk::Latin1(&[]),
		}
	}
}

/// Examines at most 10,000 lines without copying or decoding their text.
pub fn guess_indentation(
	buffer: &TextBuffer,
	default_tab_size: f64,
	default_insert_spaces: bool,
) -> Result<GuessedIndentation, BufferError> {
	let mut tab_lines = 0;
	let mut space_lines = 0;
	let mut previous = IndentedLine::default();
	let mut scores = [0_usize; 9];
	for current in IndentedLines::new(buffer).take(10_000) {
		if current.indentation == current.length {
			continue;
		}
		if current.tabs > 0 {
			tab_lines += 1;
		} else if current.spaces > 1 {
			space_lines += 1;
		}
		let (difference, alignment) = spaces_difference(buffer, previous, current);
		if alignment && !(default_insert_spaces && default_tab_size == difference as f64) {
			continue;
		}
		if let Some(score) = scores.get_mut(difference) {
			*score += 1;
		}
		previous = current;
	}
	let insert_spaces = if tab_lines == space_lines {
		default_insert_spaces
	} else {
		tab_lines < space_lines
	};
	let mut tab_size = default_tab_size;
	if insert_spaces {
		let mut highest_score = 0;
		for candidate in [2, 4, 6, 8, 3, 5, 7] {
			if scores[candidate] > highest_score {
				highest_score = scores[candidate];
				tab_size = candidate as f64;
			}
		}
		if tab_size == 4.0
			&& scores[4] > 0
			&& scores[2] > 0
			&& scores[2] as f64 >= scores[4] as f64 * 2.0 / 3.0
		{
			tab_size = 2.0;
		}
	}
	Ok(GuessedIndentation {
		tab_size,
		insert_spaces,
	})
}

/// Keeps one borrowed leaf suffix while walking line metadata, without repeated line lookups.
struct IndentedLines<'a> {
	buffer: &'a TextBuffer,
	chunk: TextChunk<'a>,
	offset: usize,
	finished: bool,
}

impl<'a> IndentedLines<'a> {
	fn new(buffer: &'a TextBuffer) -> Self {
		Self {
			buffer,
			chunk: buffer.chunk_at(0),
			offset: 0,
			finished: false,
		}
	}

	fn advance(&mut self, count: usize) {
		self.offset += count;
		self.chunk = self.chunk.slice(count..self.chunk.len());
		if self.chunk.is_empty() {
			self.chunk = self.buffer.chunk_at(self.offset);
		}
	}
}

impl<'a> Iterator for IndentedLines<'a> {
	type Item = IndentedLine<'a>;

	fn next(&mut self) -> Option<Self::Item> {
		if self.finished {
			return None;
		}
		let mut line = IndentedLine {
			start: self.offset,
			prefix: self.chunk,
			..Default::default()
		};
		loop {
			let length = self
				.chunk
				.iter()
				.take_while(|&unit| unit == 9 || unit == 32)
				.count();
			let tabs = self
				.chunk
				.slice(0..length)
				.iter()
				.filter(|&unit| unit == 9)
				.count();
			line.tabs += tabs;
			line.spaces += length - tabs;
			line.indentation += length;
			self.advance(length);
			if length == 0 || !self.chunk.is_empty() && !matches!(self.chunk.get(0), Some(9 | 32)) {
				break;
			}
		}
		loop {
			let end = match self.chunk {
				TextChunk::Latin1(units) => memchr::memchr2(10, 13, units),
				TextChunk::Utf16(units) => units.iter().position(|&unit| unit == 10 || unit == 13),
			};
			if let Some(end) = end {
				line.length = self.offset + end - line.start;
				let cr = self.chunk.get(end) == Some(13);
				self.advance(end + 1);
				if cr && self.chunk.get(0) == Some(10) {
					self.advance(1);
				}
				return Some(line);
			}
			self.advance(self.chunk.len());
			if self.chunk.is_empty() {
				line.length = self.offset - line.start;
				self.finished = true;
				return Some(line);
			}
		}
	}
}

fn spaces_difference(
	buffer: &TextBuffer,
	previous: IndentedLine<'_>,
	current: IndentedLine<'_>,
) -> (usize, bool) {
	let (mut shared_spaces, mut shared_tabs) = (0, 0);
	let mut offset = 0;
	let limit = previous.indentation.min(current.indentation);
	while offset < limit {
		let first = if offset < previous.prefix.len() {
			previous.prefix.slice(offset..previous.prefix.len())
		} else {
			buffer.chunk_at(previous.start + offset)
		};
		let second = if offset < current.prefix.len() {
			current.prefix.slice(offset..current.prefix.len())
		} else {
			buffer.chunk_at(current.start + offset)
		};
		let length = first.len().min(second.len()).min(limit - offset);
		let mut matched = 0;
		for (first, second) in first
			.slice(0..length)
			.iter()
			.zip(second.slice(0..length).iter())
		{
			if first != second {
				break;
			}
			if first == 32 {
				shared_spaces += 1;
			} else {
				shared_tabs += 1;
			}
			matched += 1;
		}
		offset += matched;
		if matched != length {
			break;
		}
	}
	let first_spaces = previous.spaces - shared_spaces;
	let first_tabs = previous.tabs - shared_tabs;
	let second_spaces = current.spaces - shared_spaces;
	let second_tabs = current.tabs - shared_tabs;
	if first_spaces > 0 && first_tabs > 0 || second_spaces > 0 && second_tabs > 0 {
		return (0, false);
	}
	let tabs = first_tabs.abs_diff(second_tabs);
	let spaces = first_spaces.abs_diff(second_spaces);
	if tabs == 0 {
		let alignment = spaces > 0
			&& second_spaces > 0
			&& second_spaces - 1 < previous.length
			&& second_spaces < current.length
			&& buffer.char_at(current.start + second_spaces) != Some(32)
			&& buffer.char_at(previous.start + second_spaces - 1) == Some(32)
			&& buffer.char_at(previous.start + previous.length - 1) == Some(44);
		return (spaces, alignment);
	}
	if spaces.is_multiple_of(tabs) {
		return (spaces / tabs, false);
	}
	(0, false)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn indentation_keeps_alignment_defaults_tab_preferences_and_whitespace_only_lines() {
		for (text, tab_size, insert_spaces) in [
			("root\n  child\n    nested\n  child", 2.0, true),
			("root\n\tchild\n\t\tnested", 4.0, false),
			("const a = 1,\n      b = 2;\n  \n\t", 4.0, true),
		] {
			assert_eq!(
				guess_indentation(&TextBuffer::from_text(text), 4.0, true).unwrap(),
				GuessedIndentation {
					tab_size,
					insert_spaces
				}
			);
		}
		let guess = guess_indentation(&TextBuffer::from_text(" \t\n\r\n"), -0.0, false).unwrap();
		assert_eq!(
			(guess.tab_size.to_bits(), guess.insert_spaces),
			((-0.0_f64).to_bits(), false)
		);
	}
}
