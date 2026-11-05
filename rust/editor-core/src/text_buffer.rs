/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use std::{error::Error, fmt, ops::Range};

use crate::TextChunk;
use crate::tree::{self, Tree};

/// A one-based editor position. Columns count UTF-16 code units, including unpaired surrogates.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Position {
	pub line_number: usize,
	pub column: usize,
}

/// A replacement in the original document's zero-based UTF-16 coordinates.
#[derive(Debug)]
pub struct TextEdit<'a> {
	pub range: Range<usize>,
	pub text: &'a [u16],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BufferError {
	InvalidRange,
	InvalidPosition,
	OverlappingEdits,
}

impl fmt::Display for BufferError {
	fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
		formatter.write_str(match self {
			Self::InvalidRange => "The text range is outside the document",
			Self::InvalidPosition => "The text position is outside the document",
			Self::OverlappingEdits => "Text edits must be sorted and must not overlap",
		})
	}
}

impl Error for BufferError {}

/// A persistent, balanced UTF-16 rope. Cloning retains a shared immutable document version.
#[derive(Clone, Debug, Default)]
pub struct TextBuffer {
	root: Tree,
}

impl TextBuffer {
	pub fn new(units: &[u16]) -> Self {
		Self {
			root: tree::from_units(units),
		}
	}

	/// Constructs known-valid Unicode text. The UTF-16 constructor remains available for arbitrary code units.
	pub fn from_text(text: &str) -> Self {
		Self {
			root: tree::from_text(text),
		}
	}

	pub fn len(&self) -> usize {
		self.root.as_ref().map_or(0, |root| root.summary.length)
	}

	pub fn is_empty(&self) -> bool {
		self.len() == 0
	}

	pub fn line_count(&self) -> usize {
		1 + self
			.root
			.as_ref()
			.map_or(0, |root| root.summary.line_breaks)
	}

	pub fn char_at(&self, offset: usize) -> Option<u16> {
		self.root.as_ref().and_then(|root| root.char_at(offset))
	}

	pub fn slice(&self, range: Range<usize>) -> Result<Vec<u16>, BufferError> {
		self.validate_range(&range)?;
		let mut units = Vec::with_capacity(range.len());
		if let Some(root) = &self.root {
			root.copy_range(range.start, range.end, &mut units);
		}
		Ok(units)
	}

	pub fn to_units(&self) -> Vec<u16> {
		self.slice(0..self.len())
			.expect("The entire document is a valid range")
	}

	pub fn replace(&mut self, range: Range<usize>, units: &[u16]) -> Result<(), BufferError> {
		self.validate_range(&range)?;
		self.replace_tree(range, tree::from_units(units));
		Ok(())
	}

	pub fn replace_text(&mut self, range: Range<usize>, text: &str) -> Result<(), BufferError> {
		self.validate_range(&range)?;
		self.replace_tree(range, tree::from_text(text));
		Ok(())
	}

	fn replace_tree(&mut self, range: Range<usize>, inserted: Tree) {
		if range.is_empty() && inserted.is_none() {
			return;
		}
		let (before, tail) = tree::split(self.root.clone(), range.start);
		let (_, after) = tree::split(tail, range.len());
		self.root = tree::concat(tree::concat(before, inserted), after);
	}

	/// Applies sorted, nonoverlapping edits atomically. Equal-offset insertions keep input order.
	pub fn apply_edits(&mut self, edits: &[TextEdit<'_>]) -> Result<(), BufferError> {
		let mut previous_end = 0;
		for edit in edits {
			self.validate_range(&edit.range)?;
			if edit.range.start < previous_end {
				return Err(BufferError::OverlappingEdits);
			}
			previous_end = edit.range.end;
		}
		let mut updated = None;
		let mut tail = self.root.clone();
		let mut offset = 0;
		for edit in edits {
			if edit.range.is_empty() && edit.text.is_empty() {
				continue;
			}
			let (before, rest) = tree::split(tail, edit.range.start - offset);
			let (_, after) = tree::split(rest, edit.range.len());
			updated = tree::concat(tree::concat(updated, before), tree::from_units(edit.text));
			tail = after;
			offset = edit.range.end;
		}
		self.root = tree::concat(updated, tail);
		Ok(())
	}

	/// Clamps offsets to the document, matching the editor's offset-to-position contract.
	pub fn position_at(&self, offset: usize) -> Position {
		let offset = offset.min(self.len());
		let line_number = 1 + self
			.root
			.as_ref()
			.map_or(0, |root| root.line_breaks_before(offset));
		Position {
			line_number,
			column: offset
				- self
					.line_start(line_number)
					.expect("The computed line exists")
				+ 1,
		}
	}

	/// Resolves a validated position. Columns may address the interior of a CRLF sequence.
	pub fn offset_at(&self, position: Position) -> Result<usize, BufferError> {
		let start = self.line_start(position.line_number)?;
		let end = if position.line_number == self.line_count() {
			self.len()
		} else {
			self.line_start(position.line_number + 1)? - 1
		};
		let offset = position
			.column
			.checked_sub(1)
			.and_then(|column| start.checked_add(column));
		match offset {
			Some(offset) if offset <= end => Ok(offset),
			_ => Err(BufferError::InvalidPosition),
		}
	}

	pub fn line_length(&self, line_number: usize) -> Result<usize, BufferError> {
		Ok(self.line_range(line_number)?.len())
	}

	pub fn line_content(&self, line_number: usize) -> Result<Vec<u16>, BufferError> {
		self.slice(self.line_range(line_number)?)
	}

	/// Returns the one-based first non-tab/space column, or zero for an all-whitespace line.
	pub fn first_non_whitespace_column(&self, line_number: usize) -> Result<usize, BufferError> {
		let range = self.line_range(line_number)?;
		let mut offset = range.start;
		while offset < range.end {
			let chunk = self.chunk_at(offset);
			let length = chunk.len().min(range.end - offset);
			if let Some(index) = chunk
				.slice(0..length)
				.iter()
				.position(|unit| !matches!(unit, 9 | 32))
			{
				return Ok(offset - range.start + index + 1);
			}
			offset += length;
		}
		Ok(0)
	}

	/// Returns the column after the last non-tab/space unit, or zero for an all-whitespace line.
	pub fn last_non_whitespace_column(&self, line_number: usize) -> Result<usize, BufferError> {
		let range = self.line_range(line_number)?;
		let mut offset = range.end;
		while offset > range.start {
			let chunk = self.chunk_before(offset);
			let length = chunk.len().min(offset - range.start);
			let text = chunk.slice(chunk.len() - length..chunk.len());
			if let Some(index) = text.iter().rposition(|unit| !matches!(unit, 9 | 32)) {
				return Ok(offset - range.start - length + index + 2);
			}
			offset -= length;
		}
		Ok(0)
	}

	/// Preserves the existing model's high-surrogate skip rule, including unmatched high units.
	/// Line boundaries reset that rule and contribute the requested EOL length separately.
	pub fn character_count(
		&self,
		start: Position,
		end: Position,
		eol_length: usize,
	) -> Result<usize, BufferError> {
		if (start.line_number, start.column) > (end.line_number, end.column)
			|| !matches!(eol_length, 1 | 2)
		{
			return Err(BufferError::InvalidRange);
		}
		if start.column > self.line_length(start.line_number)? + 1
			|| end.column > self.line_length(end.line_number)? + 1
		{
			return Err(BufferError::InvalidPosition);
		}
		let start_offset = self.offset_at(start)?;
		let end_offset = self.offset_at(end)?;
		let mut snapshot = self.snapshot_range(start_offset..end_offset)?;
		let mut count = 0_usize;
		let mut skip = false;
		while let Some(chunk) = snapshot.read() {
			for unit in chunk.iter() {
				if skip || matches!(unit, 10 | 13) {
					skip = false;
				} else {
					count += 1;
					skip = matches!(unit, 0xD800..=0xDBFF);
				}
			}
		}
		count
			.checked_add(
				(end.line_number - start.line_number)
					.checked_mul(eol_length)
					.ok_or(BufferError::InvalidRange)?,
			)
			.ok_or(BufferError::InvalidRange)
	}

	/// Transfers complete adjacent lines with their original separators. A long first line is never truncated.
	pub fn line_batch(
		&self,
		start_line: usize,
		max_lines: usize,
		max_units: usize,
	) -> Result<Vec<u16>, BufferError> {
		self.slice(self.line_batch_range(start_line, max_lines, max_units)?)
	}

	/// Resolves a bounded complete-line transfer without allocating its text.
	pub fn line_batch_range(
		&self,
		start_line: usize,
		max_lines: usize,
		max_units: usize,
	) -> Result<Range<usize>, BufferError> {
		if max_lines == 0 {
			return Err(BufferError::InvalidPosition);
		}
		if max_lines == 1 {
			return self.line_range(start_line);
		}
		let start = self.line_start(start_line)?;
		let budget_end = start.saturating_add(max_units).min(self.len());
		let mut end_line = start_line
			.saturating_add(max_lines - 1)
			.min(self.line_count())
			.min(self.position_at(budget_end).line_number);
		let mut end = self.line_range(end_line)?.end;
		if end_line > start_line && end > budget_end {
			end_line -= 1;
			end = self.line_range(end_line)?.end;
		}
		Ok(start..end)
	}

	/// Resolves adjacent lines ending at the requested line. A long final line is never truncated.
	pub fn backward_line_batch_range(
		&self,
		end_line: usize,
		max_lines: usize,
		max_units: usize,
	) -> Result<Range<usize>, BufferError> {
		if max_lines == 0 {
			return Err(BufferError::InvalidPosition);
		}
		if max_lines == 1 {
			return self.line_range(end_line);
		}
		let end = self.line_range(end_line)?.end;
		let budget_start = end.saturating_sub(max_units);
		let mut start_line = end_line
			.saturating_sub(max_lines - 1)
			.max(1)
			.max(self.position_at(budget_start).line_number);
		let mut start = self.line_start(start_line)?;
		if start_line < end_line && start < budget_start {
			start_line += 1;
			start = self.line_start(start_line)?;
		}
		Ok(start..end)
	}

	/// Rewrites only line-ending units; all other UTF-16 units are preserved verbatim.
	pub fn normalize_eol(&mut self, crlf: bool) {
		let mut units = Vec::with_capacity(self.len());
		let mut previous_cr = false;
		let mut snapshot = self.snapshot();
		while let Some(chunk) = snapshot.read() {
			for unit in chunk.iter() {
				if unit == 10 && previous_cr {
					previous_cr = false;
					continue;
				}
				previous_cr = unit == 13;
				if unit == 13 || unit == 10 {
					if crlf {
						units.push(13);
					}
					units.push(10);
				} else {
					units.push(unit);
				}
			}
		}
		self.root = tree::from_units(&units);
	}

	pub fn snapshot(&self) -> TextSnapshot {
		TextSnapshot {
			chunks: self.chunks_at(0),
			remaining: self.len(),
		}
	}

	/// Retains an immutable range without copying its text or walking the tree at creation.
	pub fn snapshot_range(&self, range: Range<usize>) -> Result<TextSnapshot, BufferError> {
		self.validate_range(&range)?;
		Ok(TextSnapshot {
			chunks: self.chunks_at(range.start),
			remaining: range.len(),
		})
	}

	/// Returns a leaf suffix without allocating or collecting the whole document.
	pub fn chunk_at(&self, offset: usize) -> TextChunk<'_> {
		if offset >= self.len() {
			return TextChunk::Latin1(&[]);
		}
		self.root
			.as_ref()
			.expect("A nonempty document has a root")
			.chunk_at(offset)
	}

	pub(crate) fn chunk_before(&self, offset: usize) -> TextChunk<'_> {
		if offset == 0 {
			return TextChunk::Latin1(&[]);
		}
		self.root
			.as_ref()
			.expect("A nonempty document has a root")
			.chunk_before(offset.min(self.len()))
	}

	pub(crate) fn chunks_at(&self, offset: usize) -> tree::Chunks {
		tree::Chunks::new(self.root.clone(), offset)
	}

	fn line_start(&self, line_number: usize) -> Result<usize, BufferError> {
		if line_number == 0 || line_number > self.line_count() {
			return Err(BufferError::InvalidPosition);
		}
		if line_number == 1 {
			return Ok(0);
		}
		Ok(self
			.root
			.as_ref()
			.expect("A multiline document has a root")
			.line_break_end(line_number - 1))
	}

	pub(crate) fn line_range(&self, line_number: usize) -> Result<Range<usize>, BufferError> {
		let start = self.line_start(line_number)?;
		let mut end = if line_number == self.line_count() {
			self.len()
		} else {
			let mut end = self.line_start(line_number + 1)?;
			if self.char_at(end - 1) == Some(10) {
				end -= 1;
			}
			if end > start && self.char_at(end - 1) == Some(13) {
				end -= 1;
			}
			end
		};
		end = end.max(start);
		Ok(start..end)
	}

	fn validate_range(&self, range: &Range<usize>) -> Result<(), BufferError> {
		if range.start > range.end || range.end > self.len() {
			Err(BufferError::InvalidRange)
		} else {
			Ok(())
		}
	}

	#[cfg(test)]
	pub(crate) fn assert_invariants(&self) {
		tree::assert_invariants(&self.root);
	}
}

/// A streaming immutable document version. Later edits cannot alter its contents.
#[derive(Debug)]
pub struct TextSnapshot {
	chunks: tree::Chunks,
	remaining: usize,
}

impl TextSnapshot {
	pub fn read(&mut self) -> Option<TextChunk<'_>> {
		if self.remaining == 0 {
			return None;
		}
		let chunk = self.chunks.read()?;
		let count = self.remaining.min(chunk.len());
		self.remaining -= count;
		Some(chunk.slice(0..count))
	}

	pub fn remaining_len(&self) -> usize {
		self.remaining
	}
}

#[cfg(test)]
#[path = "text_buffer/tests.rs"]
mod tests;
