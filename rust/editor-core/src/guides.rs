/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Indentation guide levels and active scope selection over borrowed model text.

use std::ops::Range;

use crate::{BufferError, TextBuffer, TextChunk, folding::indent_level};

/// The active guide's inclusive document lines and indentation level.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ActiveIndentGuide {
	pub start_line: usize,
	pub end_line: usize,
	pub indent: f64,
}

#[derive(Clone, Copy, Default)]
enum ContentLine {
	#[default]
	Unresolved,
	Missing,
	Found {
		line: usize,
		indent: f64,
	},
}

impl ContentLine {
	fn indent(self) -> f64 {
		match self {
			Self::Found { indent, .. } => indent,
			_ => -1.0,
		}
	}
}

#[derive(Default)]
struct AdjacentContent {
	above: ContentLine,
	below: ContentLine,
}

impl AdjacentContent {
	fn resolve(
		&mut self,
		cursor: &mut LineIndentCursor<'_>,
		line: usize,
		going_up: bool,
	) -> Result<(), BufferError> {
		if matches!(self.above, ContentLine::Unresolved)
			|| going_up
				&& matches!(self.above, ContentLine::Found { line: previous, .. } if previous > line)
		{
			self.above = ContentLine::Missing;
			for previous in (1..line).rev() {
				let indent = cursor.indent(previous)?;
				if indent >= 0.0 {
					self.above = ContentLine::Found {
						line: previous,
						indent,
					};
					break;
				}
			}
		}
		if matches!(self.below, ContentLine::Unresolved)
			|| !going_up
				&& matches!(self.below, ContentLine::Found { line: next, .. } if next < line)
		{
			self.below = ContentLine::Missing;
			for next in line + 1..=cursor.buffer.line_count() {
				let indent = cursor.indent(next)?;
				if indent >= 0.0 {
					self.below = ContentLine::Found { line: next, indent };
					break;
				}
			}
		}
		Ok(())
	}

	fn level(
		&mut self,
		cursor: &mut LineIndentCursor<'_>,
		line: usize,
		indent_size: f64,
		off_side: bool,
		going_up: bool,
	) -> Result<f64, BufferError> {
		let indent = cursor.indent(line)?;
		if indent >= 0.0 {
			let content = ContentLine::Found { line, indent };
			if going_up {
				self.below = content;
			} else {
				self.above = content;
			}
			return Ok((indent / indent_size).ceil());
		}
		self.resolve(cursor, line, going_up)?;
		Ok(whitespace_level(
			self.above.indent(),
			self.below.indent(),
			indent_size,
			off_side,
		))
	}
}

/// Computes viewport guide levels with the existing nearest-content whitespace rules.
pub fn compute_indent_guides(
	buffer: &TextBuffer,
	start_line: usize,
	end_line: usize,
	tab_size: f64,
	indent_size: f64,
	off_side: bool,
) -> Result<Option<Vec<f64>>, BufferError> {
	if !supported_options(tab_size, indent_size)
		|| start_line == 0
		|| end_line == 0
		|| start_line > buffer.line_count()
		|| end_line > buffer.line_count()
		|| start_line > end_line + 1
	{
		return Ok(None);
	}
	let mut result = Vec::new();
	if result.try_reserve_exact(end_line + 1 - start_line).is_err() {
		return Ok(None);
	}
	let mut content = AdjacentContent::default();
	let mut cursor = LineIndentCursor::new(buffer, tab_size);
	for line in start_line..=end_line {
		result.push(content.level(&mut cursor, line, indent_size, off_side, false)?);
	}
	Ok(Some(result))
}

/// Preserves scope-start/end preferences, minimum-distance bounds, and the 50,000-line cutoff.
pub fn compute_active_indent_guide(
	buffer: &TextBuffer,
	line: usize,
	min_line: usize,
	max_line: usize,
	tab_size: f64,
	indent_size: f64,
	off_side: bool,
) -> Result<Option<ActiveIndentGuide>, BufferError> {
	if !supported_options(tab_size, indent_size) || line == 0 || line > buffer.line_count() {
		return Ok(None);
	}
	let mut above = AdjacentContent::default();
	let mut below = AdjacentContent::default();
	let mut up_cursor = LineIndentCursor::new(buffer, tab_size);
	let mut down_cursor = LineIndentCursor::new(buffer, tab_size);
	let mut result = ActiveIndentGuide {
		start_line: 0,
		end_line: 0,
		indent: 0.0,
	};
	let (mut go_up, mut go_down) = (true, true);
	let mut initial_indent = 0.0;
	let mut distance = 0;
	while go_up || go_down {
		let up_line = line.saturating_sub(distance);
		let down_line = line.saturating_add(distance);
		if distance > 1 && (up_line < 1 || up_line < min_line) {
			go_up = false;
		}
		if distance > 1 && (down_line > buffer.line_count() || down_line > max_line) {
			go_down = false;
		}
		if distance > 50_000 {
			go_up = false;
			go_down = false;
		}
		let up_indent = if go_up && up_line >= 1 {
			above.level(&mut up_cursor, up_line, indent_size, off_side, true)?
		} else {
			-1.0
		};
		let down_indent = if go_down && down_line <= buffer.line_count() {
			below.level(&mut down_cursor, down_line, indent_size, off_side, false)?
		} else {
			-1.0
		};
		if distance == 0 {
			initial_indent = up_indent;
			distance += 1;
			continue;
		}
		if distance == 1 {
			if down_line <= buffer.line_count()
				&& down_indent >= 0.0
				&& initial_indent + 1.0 == down_indent
			{
				go_up = false;
				result = ActiveIndentGuide {
					start_line: down_line,
					end_line: down_line,
					indent: down_indent,
				};
				distance += 1;
				continue;
			}
			if up_line >= 1 && up_indent >= 0.0 && up_indent - 1.0 == initial_indent {
				go_down = false;
				result = ActiveIndentGuide {
					start_line: up_line,
					end_line: up_line,
					indent: up_indent,
				};
				distance += 1;
				continue;
			}
			result = ActiveIndentGuide {
				start_line: line,
				end_line: line,
				indent: initial_indent,
			};
			if result.indent == 0.0 {
				return Ok(Some(result));
			}
		}
		if go_up {
			if up_indent >= result.indent {
				result.start_line = up_line;
			} else {
				go_up = false;
			}
		}
		if go_down {
			if down_indent >= result.indent {
				result.end_line = down_line;
			} else {
				go_down = false;
			}
		}
		distance += 1;
	}
	Ok(Some(result))
}

fn supported_options(tab_size: f64, indent_size: f64) -> bool {
	[tab_size, indent_size].into_iter().all(|value| {
		value.is_finite() && value >= 1.0 && value <= u32::MAX as f64 && value.fract() == 0.0
	})
}

/// Reuses a borrowed leaf and adjacent line bounds within one immutable query scope.
struct LineIndentCursor<'a> {
	buffer: &'a TextBuffer,
	tab_size: f64,
	line: usize,
	range: Range<usize>,
	chunk: TextChunk<'a>,
	chunk_start: usize,
}

impl<'a> LineIndentCursor<'a> {
	fn new(buffer: &'a TextBuffer, tab_size: f64) -> Self {
		Self {
			buffer,
			tab_size,
			line: 0,
			range: 0..0,
			chunk: TextChunk::Latin1(&[]),
			chunk_start: 0,
		}
	}

	fn chunk_at(&mut self, offset: usize) -> TextChunk<'a> {
		if offset < self.chunk_start || offset >= self.chunk_start + self.chunk.len() {
			self.chunk = self.buffer.chunk_at(offset);
			self.chunk_start = offset;
		}
		self.chunk
			.slice(offset - self.chunk_start..self.chunk.len())
	}

	fn chunk_before(&mut self, offset: usize) -> TextChunk<'a> {
		if offset <= self.chunk_start || offset > self.chunk_start + self.chunk.len() {
			self.chunk = self.buffer.chunk_before(offset);
			self.chunk_start = offset - self.chunk.len();
		}
		self.chunk.slice(0..offset - self.chunk_start)
	}

	fn line_end(&mut self, mut offset: usize) -> usize {
		while offset < self.buffer.len() {
			let chunk = self.chunk_at(offset);
			let separator = match chunk {
				TextChunk::Latin1(units) => memchr::memchr2(10, 13, units),
				TextChunk::Utf16(units) => units.iter().position(|&unit| unit == 10 || unit == 13),
			};
			if let Some(separator) = separator {
				return offset + separator;
			}
			offset += chunk.len();
		}
		offset
	}

	fn line_start(&mut self, mut offset: usize) -> usize {
		while offset > 0 {
			let chunk = self.chunk_before(offset);
			let separator = match chunk {
				TextChunk::Latin1(units) => memchr::memrchr2(10, 13, units),
				TextChunk::Utf16(units) => units.iter().rposition(|&unit| unit == 10 || unit == 13),
			};
			if let Some(separator) = separator {
				return offset - chunk.len() + separator + 1;
			}
			offset -= chunk.len();
		}
		0
	}

	fn indent(&mut self, line: usize) -> Result<f64, BufferError> {
		let range = if self.line == line {
			self.range.clone()
		} else if self.line > 0 && line == self.line + 1 {
			let mut start = self.range.end;
			if self.chunk_at(start).get(0) == Some(13) {
				start += 1;
			}
			if self.chunk_at(start).get(0) == Some(10) {
				start += 1;
			}
			start..self.line_end(start)
		} else if self.line > 1 && line + 1 == self.line {
			let mut end = self.range.start;
			if end > 0 && self.chunk_at(end - 1).get(0) == Some(10) {
				end -= 1;
			}
			if end > 0 && self.chunk_at(end - 1).get(0) == Some(13) {
				end -= 1;
			}
			self.line_start(end)..end
		} else {
			self.buffer.line_range(line)?
		};
		self.line = line;
		self.range = range.clone();
		let prefix = self.chunk_at(range.start);
		Ok(indent_level(
			self.buffer,
			range.start,
			range.end,
			prefix,
			self.tab_size,
		))
	}
}

fn whitespace_level(above: f64, below: f64, indent_size: f64, off_side: bool) -> f64 {
	if above == -1.0 || below == -1.0 {
		0.0
	} else if above < below {
		1.0 + (above / indent_size).floor()
	} else if above == below || off_side {
		(below / indent_size).ceil()
	} else {
		1.0 + (below / indent_size).floor()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn guide_levels_keep_scope_boundaries_whitespace_and_off_side_rules() {
		let buffer = TextBuffer::from_text("root\n  child\n\nroot\n");
		assert_eq!(
			compute_indent_guides(&buffer, 1, 5, 4.0, 2.0, false).unwrap(),
			Some(vec![0.0, 1.0, 1.0, 0.0, 0.0])
		);
		assert_eq!(
			compute_indent_guides(&buffer, 1, 5, 4.0, 2.0, true).unwrap(),
			Some(vec![0.0, 1.0, 0.0, 0.0, 0.0])
		);
		assert_eq!(
			compute_active_indent_guide(&buffer, 1, 1, 5, 4.0, 2.0, false).unwrap(),
			Some(ActiveIndentGuide {
				start_line: 2,
				end_line: 3,
				indent: 1.0
			})
		);
	}

	#[test]
	fn borrowed_line_cursor_keeps_adjacent_and_random_reads_across_shared_splits() {
		let mut buffer = TextBuffer::from_text(&" \tvalue\r\n\t  \rroot\n".repeat(1024));
		buffer.replace(510..511, &[0xD800]).unwrap();
		buffer.replace(1023..1024, &[13, 10]).unwrap();
		let count = buffer.line_count();
		let mut cursor = LineIndentCursor::new(&buffer, 3.0);
		let mut seed = 149_u32;
		let random = (0..4096).map(|_| {
			seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
			seed as usize % count + 1
		});
		for line in (1..=count).chain((1..=count).rev()).chain(random) {
			let content = buffer.line_content(line).unwrap();
			let mut expected = -1.0;
			let mut indent = 0.0;
			for unit in content {
				match unit {
					32 => indent += 1.0,
					9 => indent = indent - indent % 3.0 + 3.0,
					_ => {
						expected = indent;
						break;
					}
				}
			}
			assert_eq!(cursor.indent(line).unwrap(), expected);
		}
	}
}
