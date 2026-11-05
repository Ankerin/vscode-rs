/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use std::{error::Error, fmt, ops::Range};

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
		if range.is_empty() && units.is_empty() {
			return Ok(());
		}
		let (before, tail) = tree::split(self.root.clone(), range.start);
		let (_, after) = tree::split(tail, range.len());
		self.root = tree::concat(tree::concat(before, tree::from_units(units)), after);
		Ok(())
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
		let mut updated = self.clone();
		for edit in edits.iter().rev() {
			updated.replace(edit.range.clone(), edit.text)?;
		}
		*self = updated;
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

	/// Rewrites only line-ending units; all other UTF-16 units are preserved verbatim.
	pub fn normalize_eol(&mut self, crlf: bool) {
		let mut units = Vec::with_capacity(self.len());
		let mut previous_cr = false;
		let mut snapshot = self.snapshot();
		while let Some(chunk) = snapshot.read() {
			for &unit in chunk {
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
			buffer: self.clone(),
			offset: 0,
		}
	}

	/// Returns a leaf suffix without allocating or collecting the whole document.
	pub fn chunk_at(&self, offset: usize) -> &[u16] {
		if offset >= self.len() {
			return &[];
		}
		self.root
			.as_ref()
			.expect("A nonempty document has a root")
			.chunk_at(offset)
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

	fn line_range(&self, line_number: usize) -> Result<Range<usize>, BufferError> {
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
	buffer: TextBuffer,
	offset: usize,
}

impl TextSnapshot {
	pub fn read(&mut self) -> Option<&[u16]> {
		let chunk = self.buffer.chunk_at(self.offset);
		if chunk.is_empty() {
			return None;
		}
		self.offset += chunk.len();
		Some(chunk)
	}
}

#[cfg(test)]
#[path = "text_buffer/tests.rs"]
mod tests;
