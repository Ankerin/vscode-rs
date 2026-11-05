/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use crate::{BufferError, Position, TextBuffer, TextChunk};

impl TextBuffer {
	/// Finds nonoverlapping, case-sensitive literals without copying lines or crossing line endings.
	/// The range limits match starts; a match may extend past the final column, as in the existing storage.
	pub fn find_literal(
		&self,
		start: Position,
		end: Position,
		needle: &[u16],
		limit: usize,
	) -> Result<Vec<Position>, BufferError> {
		let start_offset = self.offset_at(start)?;
		let end_offset = self.offset_at(end)?;
		if start_offset > end_offset {
			return Err(BufferError::InvalidRange);
		}
		if start_offset == end_offset
			|| needle.is_empty()
			|| needle.iter().any(|&unit| unit == 13 || unit == 10)
		{
			return Ok(Vec::new());
		}
		let scan_end = self.offset_at(Position {
			line_number: end.line_number,
			column: self.line_length(end.line_number)? + 1,
		})?;
		let mut remaining = scan_end.saturating_sub(start_offset);
		let mut prefixes = vec![0; needle.len()];
		let mut matched = 0;
		for index in 1..needle.len() {
			while matched > 0 && needle[index] != needle[matched] {
				matched = prefixes[matched - 1];
			}
			if needle[index] == needle[matched] {
				matched += 1;
			}
			prefixes[index] = matched;
		}
		matched = 0;
		let mut result = Vec::new();
		let mut chunk_offset = start_offset;
		let mut chunks = self.chunks_at(start_offset);
		while remaining > 0 {
			let Some(chunk) = chunks.read() else { break };
			let count = remaining.min(chunk.len());
			let mut offset = 0;
			while offset < count {
				if matched == 0 {
					let next = match chunk {
						TextChunk::Latin1(units) if needle[0] <= 255 => {
							memchr::memchr(needle[0] as u8, &units[offset..count])
						}
						TextChunk::Latin1(_) => None,
						TextChunk::Utf16(units) => units[offset..count]
							.iter()
							.position(|&unit| unit == needle[0]),
					};
					let Some(next) = next else { break };
					offset += next;
				}
				let unit = chunk.get(offset).expect("The search offset exists");
				while matched > 0 && unit != needle[matched] {
					matched = prefixes[matched - 1];
				}
				if unit == needle[matched] {
					matched += 1;
				}
				if matched == needle.len() {
					let match_offset = chunk_offset + offset + 1 - needle.len();
					if match_offset < end_offset {
						result.push(self.position_at(match_offset));
						if result.len() >= limit.max(1) {
							return Ok(result);
						}
					}
					matched = 0;
				}
				offset += 1;
			}
			remaining -= count;
			chunk_offset += count;
		}
		Ok(result)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn seeded_literal_queries_match_flat_line_search_with_scoped_ranges() {
		let mut seed = 42_u32;
		let mut random = |limit| {
			seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
			seed as usize % limit
		};
		let alphabet = [65, 66, 67, 0x80, 0xD800, 0xDC00];
		let lines: Vec<Vec<u16>> = (0..100)
			.map(|_| {
				let length = 1 + random(128);
				(0..length)
					.map(|_| alphabet[random(alphabet.len())])
					.collect()
			})
			.collect();
		let mut text = Vec::new();
		for (index, line) in lines.iter().enumerate() {
			if index > 0 {
				text.extend([13, 10]);
			}
			text.extend_from_slice(line);
		}
		let buffer = TextBuffer::new(&text);
		for _ in 0..512 {
			let first = random(lines.len());
			let last = first + random(lines.len() - first);
			let start_column = 1 + random(lines[first].len() + 1);
			let end_column = if first == last {
				start_column + random(lines[last].len() + 2 - start_column)
			} else {
				1 + random(lines[last].len() + 1)
			};
			let length = 1 + random(8);
			let needle: Vec<_> = (0..length)
				.map(|_| alphabet[random(alphabet.len())])
				.collect();
			let limit = 1 + random(16);
			let mut expected = Vec::new();
			for (index, line) in lines.iter().enumerate().take(last + 1).skip(first) {
				let mut offset = if index == first { start_column - 1 } else { 0 };
				let end = if index == last {
					end_column - 1
				} else {
					line.len()
				};
				while offset < end && expected.len() < limit {
					let Some(found) = line[offset..]
						.windows(needle.len())
						.position(|window| window == needle)
					else {
						break;
					};
					offset += found;
					if offset >= end {
						break;
					}
					expected.push(Position {
						line_number: index + 1,
						column: offset + 1,
					});
					offset += needle.len();
				}
			}
			let actual = buffer
				.find_literal(
					Position {
						line_number: first + 1,
						column: start_column,
					},
					Position {
						line_number: last + 1,
						column: end_column,
					},
					&needle,
					limit,
				)
				.unwrap();
			assert_eq!(actual, expected);
		}
	}

	#[test]
	fn literal_search_preserves_utf16_columns_nonoverlap_and_end_column_rules() {
		let mut text = vec![65; 1023];
		text.extend([0xD800, 0xDC00, 0xD800, 0xDC00, 13, 10]);
		text.extend("abababa\rababa\n".encode_utf16());
		let buffer = TextBuffer::new(&text);
		let start = Position {
			line_number: 1,
			column: 1,
		};
		let end = Position {
			line_number: 4,
			column: 1,
		};
		assert_eq!(
			buffer
				.find_literal(start, end, &[0xD800, 0xDC00], 100)
				.unwrap(),
			vec![
				Position {
					line_number: 1,
					column: 1024
				},
				Position {
					line_number: 1,
					column: 1026
				},
			]
		);
		let needle: Vec<_> = "aba".encode_utf16().collect();
		assert_eq!(
			buffer
				.find_literal(
					start,
					Position {
						line_number: 3,
						column: 2
					},
					&needle,
					100
				)
				.unwrap(),
			vec![
				Position {
					line_number: 2,
					column: 1
				},
				Position {
					line_number: 2,
					column: 5
				},
				Position {
					line_number: 3,
					column: 1
				},
			]
		);
		assert_eq!(
			buffer.find_literal(start, end, &needle, 1).unwrap(),
			vec![Position {
				line_number: 2,
				column: 1
			}]
		);
		assert!(
			buffer
				.find_literal(start, end, &[65, 13, 10], 100)
				.unwrap()
				.is_empty()
		);
	}
}
