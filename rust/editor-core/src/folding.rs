/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Indentation folding with the existing marker stack, off-side, and limit rules.

use crate::{TextBuffer, TextChunk};

const MAX_LINE_NUMBER: usize = 0xFF_FFFF;
const MAX_FOLDING_REGIONS: usize = 0xFFFF;

/// Ordered folding endpoints and the candidate count reported before applying the limit.
#[derive(Debug, PartialEq, Eq)]
pub struct IndentationFoldingRanges {
	pub starts: Vec<u32>,
	pub ends: Vec<u32>,
	pub computed: usize,
}

#[derive(Clone, Copy)]
struct PreviousRegion {
	indent: f64,
	end_above: usize,
	line: usize,
}

struct FoldingRange {
	start: usize,
	end: usize,
	indent: f64,
}

/// Marker callbacks run bottom-to-top for non-whitespace lines: 0 is none, 1 start, 2 end.
/// Unsupported coordinates, options, or allocations retain the caller's existing implementation.
pub fn compute_indentation_folding<E>(
	buffer: &TextBuffer,
	tab_size: f64,
	off_side: bool,
	limit: usize,
	marker: &mut impl FnMut(usize) -> Result<u8, E>,
) -> Result<Option<IndentationFoldingRanges>, E> {
	if !tab_size.is_finite()
		|| tab_size < 1.0
		|| tab_size.fract() != 0.0
		|| tab_size > u32::MAX as f64
		|| limit > MAX_FOLDING_REGIONS
		|| buffer.line_count() > u32::MAX as usize - 1
	{
		return Ok(None);
	}
	let mut previous_regions = Vec::new();
	if previous_regions.try_reserve(1).is_err() {
		return Ok(None);
	}
	let line = buffer.line_count() + 1;
	previous_regions.push(PreviousRegion {
		indent: -1.0,
		end_above: line,
		line,
	});
	let mut ranges = Vec::new();
	let mut occurrences = [0_usize; 1000];
	let mut occurrence_length = 0;
	let mut lines = ReverseLines::new(buffer);
	for line in (1..=buffer.line_count()).rev() {
		let (start, end, prefix) = lines.next_line();
		let indent = indent_level(buffer, start, end, prefix, tab_size);
		let mut previous = previous_regions.len() - 1;
		if indent == -1.0 {
			if off_side {
				previous_regions[previous].end_above = line;
			}
			continue;
		}
		let mut region_end = None;
		let mut matched_start = false;
		match marker(line)? {
			1 => {
				while previous > 0 && previous_regions[previous].indent != -2.0 {
					previous -= 1;
				}
				if previous > 0 {
					previous_regions.truncate(previous + 1);
					region_end = Some(previous_regions[previous].line);
					matched_start = true;
					previous_regions[previous] = PreviousRegion {
						indent,
						end_above: line,
						line,
					};
				} else {
					previous = previous_regions.len() - 1;
				}
			}
			2 => {
				if previous_regions.try_reserve(1).is_err() {
					return Ok(None);
				}
				previous_regions.push(PreviousRegion {
					indent: -2.0,
					end_above: line,
					line,
				});
				continue;
			}
			_ => {}
		}
		if region_end.is_none() && previous_regions[previous].indent > indent {
			while previous_regions[previous].indent > indent {
				previous_regions.pop();
				previous -= 1;
			}
			let end = previous_regions[previous].end_above - 1;
			if end > line {
				region_end = Some(end);
			}
		}
		if let Some(end) = region_end
			&& line <= MAX_LINE_NUMBER
			&& end <= MAX_LINE_NUMBER
		{
			if ranges.try_reserve(1).is_err() {
				return Ok(None);
			}
			ranges.push(FoldingRange {
				start: line,
				end,
				indent,
			});
			if indent < 1000.0 {
				occurrences[indent as usize] += 1;
				occurrence_length = occurrence_length.max(indent as usize + 1);
			}
		}
		if matched_start {
			continue;
		}
		if previous_regions[previous].indent == indent {
			previous_regions[previous].end_above = line;
		} else {
			if previous_regions.try_reserve(1).is_err() {
				return Ok(None);
			}
			previous_regions.push(PreviousRegion {
				indent,
				end_above: line,
				line,
			});
		}
	}
	let computed = ranges.len();
	let length = computed.min(limit);
	let (mut starts, mut ends) = (Vec::new(), Vec::new());
	if starts.try_reserve_exact(length).is_err() || ends.try_reserve_exact(length).is_err() {
		return Ok(None);
	}
	starts.resize(length, 0);
	ends.resize(length, 0);
	if computed <= limit {
		for (index, range) in ranges.iter().rev().enumerate() {
			starts[index] = range.start as u32;
			ends[index] = range.end as u32;
		}
	} else {
		let mut entries = 0;
		let mut max_indent = occurrence_length;
		for (indent, &count) in occurrences[..occurrence_length].iter().enumerate() {
			if count > 0 {
				if count + entries > limit {
					max_indent = indent;
					break;
				}
				entries += count;
			}
		}
		let mut index = 0;
		for range in ranges.iter().rev() {
			let selected = if range.indent < max_indent as f64 {
				true
			} else if range.indent == max_indent as f64 {
				let selected = entries < limit;
				entries += 1;
				selected
			} else {
				false
			};
			if selected {
				if index < length {
					starts[index] = range.start as u32;
					ends[index] = range.end as u32;
				}
				index += 1;
			}
		}
	}
	Ok(Some(IndentationFoldingRanges {
		starts,
		ends,
		computed,
	}))
}

/// Walks backward through borrowed leaf prefixes, retaining CRLF across leaf boundaries.
struct ReverseLines<'a> {
	buffer: &'a TextBuffer,
	chunk: TextChunk<'a>,
	offset: usize,
}

impl<'a> ReverseLines<'a> {
	fn new(buffer: &'a TextBuffer) -> Self {
		Self {
			buffer,
			chunk: buffer.chunk_before(buffer.len()),
			offset: buffer.len(),
		}
	}

	fn retreat(&mut self, count: usize) {
		self.offset -= count;
		self.chunk = self.chunk.slice(0..self.chunk.len() - count);
		if self.chunk.is_empty() {
			self.chunk = self.buffer.chunk_before(self.offset);
		}
	}

	fn next_line(&mut self) -> (usize, usize, TextChunk<'a>) {
		let end = self.offset;
		loop {
			let separator = match self.chunk {
				TextChunk::Latin1(units) => memchr::memrchr2(10, 13, units),
				TextChunk::Utf16(units) => units.iter().rposition(|&unit| unit == 10 || unit == 13),
			};
			if let Some(separator) = separator {
				let prefix = self.chunk.slice(separator + 1..self.chunk.len());
				let start = self.offset - prefix.len();
				let lf = self.chunk.get(separator) == Some(10);
				self.retreat(prefix.len() + 1);
				if lf && self.chunk.get(self.chunk.len().saturating_sub(1)) == Some(13) {
					self.retreat(1);
				}
				return (start, end, prefix);
			}
			let prefix = self.chunk;
			self.retreat(self.chunk.len());
			if self.offset == 0 {
				return (0, end, prefix);
			}
		}
	}
}

fn indent_level(
	buffer: &TextBuffer,
	start: usize,
	end: usize,
	prefix: TextChunk<'_>,
	tab_size: f64,
) -> f64 {
	let mut chunk = prefix;
	let mut offset = start;
	let mut indent = 0_u32;
	let mut wide_indent = None;
	let integer_tab_size = tab_size as u32;
	while offset < end {
		if chunk.is_empty() {
			chunk = buffer.chunk_at(offset);
		}
		for unit in chunk.slice(0..chunk.len().min(end - offset)).iter() {
			if unit != 32 && unit != 9 {
				return wide_indent.unwrap_or(f64::from(indent));
			}
			if let Some(indent) = &mut wide_indent {
				*indent = if unit == 32 {
					*indent + 1.0
				} else {
					*indent - *indent % tab_size + tab_size
				};
			} else {
				let step = if unit == 32 {
					1
				} else {
					integer_tab_size - indent % integer_tab_size
				};
				if let Some(next) = indent.checked_add(step) {
					indent = next;
				} else {
					// Preserve JavaScript's floating-point tab arithmetic after the integer domain.
					let value = f64::from(indent);
					wide_indent = Some(if unit == 32 {
						value + 1.0
					} else {
						value - value % tab_size + tab_size
					});
				}
			}
			offset += 1;
		}
		chunk = TextChunk::Latin1(&[]);
	}
	-1.0
}

#[cfg(test)]
mod tests {
	use std::convert::Infallible;

	use super::*;

	#[test]
	fn off_side_whitespace_and_matched_markers_keep_existing_endpoints() {
		let buffer = TextBuffer::from_text("root\n  child\n\nroot\n  child\n\n");
		let mut marker = |_| Ok::<_, Infallible>(0);
		for (off_side, ends) in [(false, vec![3, 7]), (true, vec![2, 5])] {
			assert_eq!(
				compute_indentation_folding(&buffer, 4.0, off_side, 5000, &mut marker).unwrap(),
				Some(IndentationFoldingRanges {
					starts: vec![1, 4],
					ends,
					computed: 2
				})
			);
		}
		let marked = TextBuffer::from_text("#region\n  body\n#endregion");
		assert_eq!(
			compute_indentation_folding(
				&marked,
				4.0,
				false,
				5000,
				&mut |line| Ok::<_, Infallible>(match line {
					1 => 1,
					3 => 2,
					_ => 0,
				})
			)
			.unwrap(),
			Some(IndentationFoldingRanges {
				starts: vec![1],
				ends: vec![3],
				computed: 1
			})
		);
	}

	#[test]
	fn reverse_lines_keep_split_crlf_shared_prefixes_and_empty_terminal_lines() {
		let text = " \tvalue\r\n".repeat(1024);
		let mut buffer = TextBuffer::from_text(&text);
		buffer.replace(510..511, &[0xD800]).unwrap();
		buffer.replace(1023..1024, &[13, 10]).unwrap();
		let mut lines = ReverseLines::new(&buffer);
		for line in (1..=buffer.line_count()).rev() {
			let (start, end, _) = lines.next_line();
			assert_eq!(
				buffer.slice(start..end).unwrap(),
				buffer.line_content(line).unwrap()
			);
		}
	}

	#[test]
	fn large_tab_sizes_switch_to_the_existing_floating_point_indent_arithmetic() {
		let buffer = TextBuffer::from_text("\t\t \tvalue");
		assert_eq!(
			indent_level(
				&buffer,
				0,
				buffer.len(),
				buffer.chunk_at(0),
				u32::MAX as f64
			),
			u32::MAX as f64 * 3.0
		);
	}
}
