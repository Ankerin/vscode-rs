/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Model edit preparation, inverse coordinates, and automatic whitespace tracking.

use std::{
	borrow::Cow,
	collections::{BTreeMap, HashMap},
};

use crate::{BufferError, Position, TextBuffer, TextEdit, TextRange};

pub const MAX_MODEL_EDIT_UNITS: usize = 4 * 1024 * 1024;
pub const MAX_MODEL_EDITS: usize = 262_144;

/// Sticky text properties used by the existing model's rendering and line-ending consumers.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ModelTextFlags {
	pub non_basic_ascii: bool,
	pub rtl: bool,
	pub unusual_line_terminators: bool,
}

/// A model-validated range and its original input text. Coordinates remain one-based UTF-16.
pub struct ModelEdit<'a> {
	pub range: TextRange,
	pub text: &'a [u16],
	pub force_move_markers: bool,
	pub auto_whitespace: bool,
	pub tracked: bool,
}

#[derive(Clone, Copy, Default)]
pub struct ModelEditOptions {
	pub crlf: bool,
	pub flags: ModelTextFlags,
	pub record_trim_auto_whitespace: bool,
	pub compute_undo_edits: bool,
}

/// Metadata and text needed to construct existing content and reverse edit objects.
pub struct PreparedModelEdit<'a> {
	pub input_index: usize,
	pub sort_index: usize,
	pub range: TextRange,
	pub range_offset: usize,
	pub range_length: usize,
	pub text: Cow<'a, [u16]>,
	pub force_move_markers: bool,
	pub reverse_range: TextRange,
	pub reverse_offset: usize,
	pub old_text_range: Option<std::ops::Range<usize>>,
	auto_whitespace: bool,
	statistics: TextStatistics,
}

/// Retains the next immutable buffer until the bridge has allocated a complete result.
pub struct PreparedModelEdits<'a> {
	pub buffer: TextBuffer,
	pub operations: Vec<PreparedModelEdit<'a>>,
	pub flags: ModelTextFlags,
	pub has_touching_ranges: bool,
	pub trim_auto_whitespace_lines: Option<Vec<usize>>,
}

#[derive(Clone, Copy, Default)]
struct TextStatistics {
	line_breaks: usize,
	first_line_length: usize,
	last_line_length: usize,
	endings: u8,
	flags: ModelTextFlags,
}

impl TextStatistics {
	fn scan(text: &[u16]) -> Self {
		let mut result = Self::default();
		let mut last_line_start = 0;
		let mut offset = 0;
		while offset < text.len() {
			let unit = text[offset];
			result.flags.non_basic_ascii |= !matches!(unit, 9 | 10 | 13 | 0x20..=0x7E);
			result.flags.rtl |= is_rtl(unit, text.get(offset + 1).copied());
			result.flags.unusual_line_terminators |= matches!(unit, 0x2028 | 0x2029);
			if unit == 13 || unit == 10 {
				if result.line_breaks == 0 {
					result.first_line_length = offset;
				}
				result.line_breaks += 1;
				if unit == 13 {
					if text.get(offset + 1) == Some(&10) {
						result.endings |= 2;
						offset += 1;
					} else {
						result.endings |= 3;
					}
				} else {
					result.endings |= 1;
				}
				last_line_start = offset + 1;
			}
			offset += 1;
		}
		if result.line_breaks == 0 {
			result.first_line_length = text.len();
		}
		result.last_line_length = text.len() - last_line_start;
		result
	}
}

/// Reuses the model's exact UTF-16 line-ending classification for existing string consumers.
pub fn count_eol(text: &[u16]) -> [usize; 4] {
	let statistics = TextStatistics::scan(text);
	[
		statistics.line_breaks,
		statistics.first_line_length,
		statistics.last_line_length,
		usize::from(statistics.endings),
	]
}

/// Prepares and applies a complete batch to a shared version without mutating the source.
/// Unsupported allocation/coordinate domains return `None`, preserving the existing path.
pub fn prepare_model_edits<'a>(
	buffer: &TextBuffer,
	edits: &[ModelEdit<'a>],
	options: ModelEditOptions,
) -> Result<Option<PreparedModelEdits<'a>>, BufferError> {
	if edits.len() > MAX_MODEL_EDITS || buffer.len() > u32::MAX as usize {
		return Ok(None);
	}
	let mut flags = options.flags;
	let mut operations = Vec::with_capacity(edits.len());
	let mut text_units = 0_usize;
	let mut can_reduce = true;
	for (index, edit) in edits.iter().enumerate() {
		if position_key(edit.range.start) > position_key(edit.range.end) {
			return Err(BufferError::InvalidRange);
		}
		let start = buffer.offset_at(edit.range.start)?;
		let end = buffer.offset_at(edit.range.end)?;
		if end < start {
			return Err(BufferError::InvalidRange);
		}
		let statistics = TextStatistics::scan(edit.text);
		flags.non_basic_ascii |= statistics.flags.non_basic_ascii;
		flags.rtl |= statistics.flags.rtl;
		flags.unusual_line_terminators |= statistics.flags.unusual_line_terminators;
		let text = normalize_text(edit.text, statistics, options.crlf);
		text_units = text_units.saturating_add(text.len());
		if text_units > MAX_MODEL_EDIT_UNITS {
			return Ok(None);
		}
		can_reduce &= !edit.tracked;
		operations.push(PreparedModelEdit {
			input_index: index,
			sort_index: index,
			range: edit.range,
			range_offset: start,
			range_length: end - start,
			text,
			force_move_markers: edit.force_move_markers,
			auto_whitespace: edit.auto_whitespace,
			statistics,
			reverse_range: edit.range,
			reverse_offset: start,
			old_text_range: None,
		});
	}
	operations.sort_by_key(|operation| {
		(
			position_key(operation.range.end),
			position_key(operation.range.start),
			operation.sort_index,
		)
	});
	let mut has_touching_ranges = false;
	for pair in operations.windows(2) {
		match position_key(pair[1].range.start).cmp(&position_key(pair[0].range.end)) {
			std::cmp::Ordering::Less => return Err(BufferError::OverlappingEdits),
			std::cmp::Ordering::Equal => has_touching_ranges = true,
			std::cmp::Ordering::Greater => {}
		}
	}
	if can_reduce && operations.len() >= 1000 {
		let first = &operations[0];
		let last = operations.last().expect("A reducible batch is nonempty");
		let range = TextRange {
			start: first.range.start,
			end: last.range.end,
		};
		let start = first.range_offset;
		let end = last.range_offset + last.range_length;
		let removed = operations
			.iter()
			.map(|operation| operation.range_length)
			.sum::<usize>();
		let Some(length) = (end - start - removed).checked_add(text_units) else {
			return Ok(None);
		};
		if length > MAX_MODEL_EDIT_UNITS {
			return Ok(None);
		}
		let mut text = Vec::with_capacity(length);
		let mut offset = start;
		let mut force_move_markers = false;
		for operation in &operations {
			let mut snapshot = buffer.snapshot_range(offset..operation.range_offset)?;
			while let Some(chunk) = snapshot.read() {
				chunk.copy_to(&mut text);
			}
			text.extend_from_slice(&operation.text);
			offset = operation.range_offset + operation.range_length;
			force_move_markers |= operation.force_move_markers;
		}
		let input_index = first.input_index;
		let statistics = TextStatistics::scan(&text);
		operations = vec![PreparedModelEdit {
			input_index,
			sort_index: 0,
			range,
			range_offset: start,
			range_length: end - start,
			text: Cow::Owned(text),
			force_move_markers,
			auto_whitespace: false,
			statistics,
			reverse_range: range,
			reverse_offset: start,
			old_text_range: None,
		}];
	}
	let mut previous: Option<(TextRange, Position)> = None;
	let mut delta = 0_i64;
	let mut old_units = 0_usize;
	let mut candidates = BTreeMap::new();
	let mut whitespace_lines = HashMap::new();
	for operation in &mut operations {
		let mut start = operation.range.start;
		if let Some((range, end)) = previous {
			let Some(line) = end
				.line_number
				.checked_add(start.line_number - range.end.line_number)
			else {
				return Ok(None);
			};
			start.line_number = line;
			if range.end.line_number == operation.range.start.line_number {
				let Some(column) = end
					.column
					.checked_add(operation.range.start.column - range.end.column)
				else {
					return Ok(None);
				};
				start.column = column;
			}
		}
		let mut end = start;
		if !operation.text.is_empty() {
			if operation.statistics.line_breaks == 0 {
				let Some(column) = end
					.column
					.checked_add(operation.statistics.first_line_length)
				else {
					return Ok(None);
				};
				end.column = column;
			} else {
				let Some(line) = end
					.line_number
					.checked_add(operation.statistics.line_breaks)
				else {
					return Ok(None);
				};
				end.line_number = line;
				end.column = operation.statistics.last_line_length + 1;
			}
		}
		if [start.line_number, start.column, end.line_number, end.column]
			.iter()
			.any(|value| *value > u32::MAX as usize)
		{
			return Ok(None);
		}
		operation.reverse_range = TextRange { start, end };
		previous = Some((operation.range, end));
		let offset = operation.range_offset as i64 + delta;
		if !(0..=u32::MAX as i64).contains(&offset) {
			return Ok(None);
		}
		operation.reverse_offset = offset as usize;
		delta += operation.text.len() as i64 - operation.range_length as i64;
		if options.compute_undo_edits {
			old_units = old_units.saturating_add(operation.range_length);
			if old_units > MAX_MODEL_EDIT_UNITS {
				return Ok(None);
			}
			operation.old_text_range =
				Some(operation.range_offset..operation.range_offset + operation.range_length);
		}
		if options.record_trim_auto_whitespace
			&& operation.auto_whitespace
			&& operation.range.start == operation.range.end
		{
			for line in start.line_number..=end.line_number {
				let old_line = if line == start.line_number {
					let old_line = operation.range.start.line_number;
					let whitespace = match whitespace_lines.get(&old_line) {
						Some(whitespace) => *whitespace,
						None => {
							let mut snapshot = line_snapshot(buffer, old_line)?;
							let mut whitespace = true;
							while let Some(chunk) = snapshot.read() {
								if !chunk.iter().all(|unit| matches!(unit, 9 | 32)) {
									whitespace = false;
									break;
								}
							}
							whitespace_lines.insert(old_line, whitespace);
							whitespace
						}
					};
					if !whitespace {
						continue;
					}
					Some(old_line)
				} else {
					None
				};
				if candidates.len() >= MAX_MODEL_EDITS && !candidates.contains_key(&line) {
					return Ok(None);
				}
				// Stable descending sorting in the original pipeline keeps the first candidate per line.
				candidates.entry(line).or_insert(old_line);
			}
		}
	}
	let length = buffer.len() as i64 + delta;
	if !(0..=u32::MAX as i64).contains(&length) {
		return Ok(None);
	}
	let mut updated = buffer.clone();
	if let [operation] = operations.as_slice() {
		updated.replace(
			operation.range_offset..operation.range_offset + operation.range_length,
			&operation.text,
		)?;
	} else {
		let replacements: Vec<_> = operations
			.iter()
			.map(|operation| TextEdit {
				range: operation.range_offset..operation.range_offset + operation.range_length,
				text: &operation.text,
			})
			.collect();
		updated.apply_edits(&replacements)?;
	}
	let trim_auto_whitespace_lines = if candidates.is_empty() {
		None
	} else {
		let mut lines = Vec::new();
		for (line, old_line) in candidates.into_iter().rev() {
			if updated.line_length(line)? > MAX_MODEL_EDIT_UNITS {
				return Ok(None);
			}
			let text = updated.line_content(line)?;
			if !text.is_empty() && is_whitespace(&text) {
				let equal = if let Some(old_line) = old_line {
					line_equals(buffer, old_line, &text)?
				} else {
					false
				};
				if !equal {
					lines.push(line);
				}
			}
		}
		Some(lines)
	};
	Ok(Some(PreparedModelEdits {
		buffer: updated,
		operations,
		flags,
		has_touching_ranges,
		trim_auto_whitespace_lines,
	}))
}

fn position_key(position: Position) -> (usize, usize) {
	(position.line_number, position.column)
}

fn is_whitespace(text: &[u16]) -> bool {
	text.iter().all(|unit| matches!(unit, 9 | 32))
}

fn line_snapshot(buffer: &TextBuffer, line: usize) -> Result<crate::TextSnapshot, BufferError> {
	let start = buffer.offset_at(Position {
		line_number: line,
		column: 1,
	})?;
	buffer.snapshot_range(start..start + buffer.line_length(line)?)
}

fn line_equals(buffer: &TextBuffer, line: usize, text: &[u16]) -> Result<bool, BufferError> {
	if buffer.line_length(line)? != text.len() {
		return Ok(false);
	}
	let mut snapshot = line_snapshot(buffer, line)?;
	let mut offset = 0;
	while let Some(chunk) = snapshot.read() {
		if !chunk
			.iter()
			.eq(text[offset..offset + chunk.len()].iter().copied())
		{
			return Ok(false);
		}
		offset += chunk.len();
	}
	Ok(true)
}

fn normalize_text(text: &[u16], statistics: TextStatistics, crlf: bool) -> Cow<'_, [u16]> {
	if statistics.endings == 0 || statistics.endings == if crlf { 2 } else { 1 } {
		return Cow::Borrowed(text);
	}
	let mut units = Vec::with_capacity(text.len() + if crlf { statistics.line_breaks } else { 0 });
	let mut offset = 0;
	while offset < text.len() {
		let unit = text[offset];
		if unit == 13 || unit == 10 {
			if crlf {
				units.push(13);
			}
			units.push(10);
			if unit == 13 && text.get(offset + 1) == Some(&10) {
				offset += 1;
			}
		} else {
			units.push(unit);
		}
		offset += 1;
	}
	Cow::Owned(units)
}

// Matches the generated UTF-16 regular expression in base/common/strings.ts, including pairs.
fn is_rtl(unit: u16, next: Option<u16>) -> bool {
	if matches!(unit,
		0x05BE | 0x05C0 | 0x05C3 | 0x05C6 | 0x05D0..=0x05F4 |
		0x0608 | 0x060B | 0x060D | 0x061B..=0x064A | 0x066D..=0x066F | 0x0671..=0x06D5 |
		0x06E5 | 0x06E6 | 0x06EE | 0x06EF | 0x06FA..=0x0710 | 0x0712..=0x072F |
		0x074D..=0x07A5 | 0x07B1..=0x07EA | 0x07F4 | 0x07F5 | 0x07FA | 0x07FE..=0x0815 |
		0x081A | 0x0824 | 0x0828 | 0x0830..=0x0858 | 0x085E..=0x088E | 0x08A0..=0x08C9 |
		0x200F | 0xFB1D | 0xFB1F..=0xFB28 | 0xFB2A..=0xFD3D | 0xFD50..=0xFDC7 |
		0xFDF0..=0xFDFC | 0xFE70..=0xFEFC
	) {
		return true;
	}
	let Some(next) = next else {
		return false;
	};
	match unit {
		0xD802 => {
			matches!(next, 0xDC00..=0xDD1B | 0xDD20..=0xDE00 | 0xDE10..=0xDE35 | 0xDE40..=0xDEE4 | 0xDEEB..=0xDF35 | 0xDF40..=0xDFFF)
		}
		0xD803 => {
			matches!(next, 0xDC00..=0xDD23 | 0xDE80..=0xDEA9 | 0xDEAD..=0xDF45 | 0xDF51..=0xDF81 | 0xDF86..=0xDFF6)
		}
		0xD83A => matches!(next, 0xDC00..=0xDCCF | 0xDD00..=0xDD43 | 0xDD4B..=0xDFFF),
		0xD83B => matches!(next, 0xDC00..=0xDEBB),
		_ => false,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn eol_statistics_keep_mixed_endings_empty_lines_and_surrogate_coordinates() {
		assert_eq!(
			[
				count_eol(&[]),
				count_eol(&[65, 66]),
				count_eol(&[0xD800, 13, 10, 0xDC00, 10, 65]),
				count_eol(&[13, 13, 10, 10]),
			],
			[[0, 0, 0, 0], [0, 2, 2, 0], [2, 1, 1, 3], [3, 0, 0, 3]]
		);
	}

	fn range(start: usize, end: usize) -> TextRange {
		TextRange {
			start: Position {
				line_number: 1,
				column: start,
			},
			end: Position {
				line_number: 1,
				column: end,
			},
		}
	}

	#[test]
	fn preparation_preserves_input_order_at_touching_ranges_and_shared_source_versions() {
		let buffer = TextBuffer::from_text("abcdef");
		let snapshot = buffer.snapshot();
		let edits = [
			ModelEdit {
				range: range(2, 3),
				text: &[88],
				force_move_markers: true,
				auto_whitespace: false,
				tracked: false,
			},
			ModelEdit {
				range: range(2, 2),
				text: &[0xD800],
				force_move_markers: false,
				auto_whitespace: false,
				tracked: false,
			},
		];
		let prepared = prepare_model_edits(
			&buffer,
			&edits,
			ModelEditOptions {
				compute_undo_edits: true,
				..Default::default()
			},
		)
		.unwrap()
		.unwrap();
		assert_eq!(
			(
				prepared.has_touching_ranges,
				prepared.buffer.to_units(),
				buffer.to_units(),
				snapshot.remaining_len()
			),
			(
				true,
				vec![97, 0xD800, 88, 99, 100, 101, 102],
				vec![97, 98, 99, 100, 101, 102],
				6
			)
		);
		assert_eq!(
			(
				prepared.operations[0].input_index,
				prepared.operations[1].reverse_offset,
				buffer
					.slice(prepared.operations[1].old_text_range.clone().unwrap())
					.unwrap()
			),
			(1, 2, vec![98])
		);
		let overlapping = [
			ModelEdit {
				range: range(2, 4),
				..edits[0]
			},
			ModelEdit {
				range: range(3, 5),
				..edits[1]
			},
		];
		assert!(matches!(
			prepare_model_edits(&buffer, &overlapping, Default::default()),
			Err(BufferError::OverlappingEdits)
		));
	}

	#[test]
	fn normalization_and_flags_preserve_bom_surrogates_and_mixed_endings() {
		let text = [0xFEFF, 0xD800, 13, 10, 0xD802, 0xDC00, 13, 0x2028, 10];
		let statistics = TextStatistics::scan(&text);
		assert_eq!(
			(
				statistics.line_breaks,
				statistics.first_line_length,
				statistics.last_line_length,
				statistics.flags
			),
			(
				3,
				2,
				0,
				ModelTextFlags {
					non_basic_ascii: true,
					rtl: true,
					unusual_line_terminators: true
				}
			)
		);
		assert_eq!(
			normalize_text(&text, statistics, false).as_ref(),
			&[0xFEFF, 0xD800, 10, 0xD802, 0xDC00, 10, 0x2028, 10]
		);
		assert!(matches!(
			normalize_text(&[97, 10], TextStatistics::scan(&[97, 10]), false),
			Cow::Borrowed(_)
		));
	}

	#[test]
	fn whitespace_candidates_keep_empty_results_distinct_and_reject_large_payloads() {
		let buffer = TextBuffer::from_text(" \ntext");
		let edits = [ModelEdit {
			range: range(2, 2),
			text: &[9, 10, 32],
			force_move_markers: false,
			auto_whitespace: true,
			tracked: false,
		}];
		let prepared = prepare_model_edits(
			&buffer,
			&edits,
			ModelEditOptions {
				record_trim_auto_whitespace: true,
				..Default::default()
			},
		)
		.unwrap()
		.unwrap();
		assert_eq!(
			(
				prepared.buffer.to_units(),
				prepared.trim_auto_whitespace_lines
			),
			(
				vec![32, 9, 10, 32, 10, 116, 101, 120, 116],
				Some(vec![2, 1])
			)
		);
		let large = vec![97; MAX_MODEL_EDIT_UNITS + 1];
		assert!(
			prepare_model_edits(
				&buffer,
				&[ModelEdit {
					text: &large,
					..edits[0]
				}],
				Default::default()
			)
			.unwrap()
			.is_none()
		);
		assert_eq!(buffer.to_units(), vec![32, 10, 116, 101, 120, 116]);
	}
}
