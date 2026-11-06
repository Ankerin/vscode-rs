/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Cursor columns preserve the existing approximate widths and stateless grapheme boundary rules.

use crate::unicode_grapheme_data::GRAPHEME_DATA;

/// Coordinate conversion using the original model/view column contracts.
pub enum CursorColumnOperation {
	VisibleFromColumn,
	StatusbarColumn,
	ColumnFromVisible,
}

/// Computes columns over borrowed UTF-16 units, requesting only the text that the traversal needs.
pub fn cursor_column<E>(
	text_length: usize,
	column: f64,
	tab_size: f64,
	operation: CursorColumnOperation,
	mut unit: impl FnMut(usize) -> Result<u16, E>,
) -> Result<f64, E> {
	let inverse = matches!(operation, CursorColumnOperation::ColumnFromVisible);
	let statusbar = matches!(operation, CursorColumnOperation::StatusbarColumn);
	if inverse && column <= 0.0 {
		return Ok(1.0);
	}
	let length = if inverse {
		text_length
	} else if column.is_nan() || column <= 1.0 {
		0
	} else {
		(column - 1.0).min(text_length as f64) as usize
	};
	let mut offset = 0;
	let mut visible = 0.0;
	while offset < length {
		let (point, mut after_offset) = next_code_point(length, offset, &mut unit)?;
		if !statusbar {
			after_offset = grapheme_end(length, point, after_offset, &mut unit)?;
		}
		let after_visible = if point == 9 {
			next_cursor_tab_stop(visible, tab_size)
		} else if !statusbar && wide(point) {
			visible + 2.0
		} else {
			visible + 1.0
		};
		if inverse && after_visible >= column {
			let before_delta = column - visible;
			let after_delta = after_visible - column;
			return Ok(if after_delta < before_delta {
				(after_offset + 1) as f64
			} else {
				(offset + 1) as f64
			});
		}
		visible = after_visible;
		offset = after_offset;
	}
	Ok(if inverse {
		(text_length + 1) as f64
	} else if statusbar {
		visible + 1.0
	} else {
		visible
	})
}

/// Retains JavaScript remainder, arithmetic order, negative sizes, and exceptional numbers.
pub fn next_cursor_tab_stop(column: f64, size: f64) -> f64 {
	column + size - column % size
}

/// Retains Math.max's NaN propagation and positive zero result.
pub fn previous_cursor_tab_stop(column: f64, size: f64) -> f64 {
	let value = column - 1.0 - (column - 1.0) % size;
	if value.is_nan() || value > 0.0 {
		value
	} else {
		0.0
	}
}

/// Looks up the exact original indexed table, including its missing final-node result.
pub fn grapheme_break_type(point: u32) -> Option<u32> {
	if point < 32 {
		return Some(match point {
			10 => 3,
			13 => 2,
			_ => 4,
		});
	}
	if point < 127 {
		return Some(0);
	}
	let mut node = 1;
	while node <= GRAPHEME_DATA.len() {
		let &[start, end, class] = GRAPHEME_DATA.get(node)?;
		if point < start {
			node *= 2;
		} else if point > end {
			node = node * 2 + 1;
		} else {
			return Some(class);
		}
	}
	Some(0)
}

/// Reads a forward or backward code point while retaining surrogate-interior coordinates.
/// Callers must provide an in-bounds forward unit or a backward offset in `1..=length`.
pub fn unicode_code_point<E>(
	length: usize,
	offset: usize,
	previous: bool,
	mut unit: impl FnMut(usize) -> Result<u16, E>,
) -> Result<(u32, usize), E> {
	if previous {
		previous_code_point(offset, &mut unit)
	} else {
		next_code_point(length, offset, &mut unit)
	}
}

/// Computes one original stateless grapheme step over borrowed units without retaining text.
/// Callers must provide an in-bounds forward unit or a backward offset in `1..=length`.
pub fn unicode_grapheme_offset<E>(
	length: usize,
	offset: usize,
	previous: bool,
	mut unit: impl FnMut(usize) -> Result<u16, E>,
) -> Result<usize, E> {
	if !previous {
		let (point, after) = next_code_point(length, offset, &mut unit)?;
		return grapheme_end(length, point, after, &mut unit);
	}
	let (point, mut before) = previous_code_point(offset, &mut unit)?;
	let mut class = grapheme_break_type(point);
	while before > 0 {
		let (point, next) = previous_code_point(before, &mut unit)?;
		let previous_class = grapheme_break_type(point);
		if break_between(previous_class, class) {
			break;
		}
		before = next;
		class = previous_class;
	}
	Ok(before)
}

fn grapheme_end<E>(
	length: usize,
	point: u32,
	mut after: usize,
	unit: &mut impl FnMut(usize) -> Result<u16, E>,
) -> Result<usize, E> {
	let mut class = grapheme_break_type(point);
	while after < length {
		let (point, next) = next_code_point(length, after, unit)?;
		let next_class = grapheme_break_type(point);
		if break_between(class, next_class) {
			break;
		}
		after = next;
		class = next_class;
	}
	Ok(after)
}

fn previous_code_point<E>(
	offset: usize,
	unit: &mut impl FnMut(usize) -> Result<u16, E>,
) -> Result<(u32, usize), E> {
	let first = unit(offset - 1)?;
	if (0xDC00..=0xDFFF).contains(&first) && offset > 1 {
		let second = unit(offset - 2)?;
		if (0xD800..=0xDBFF).contains(&second) {
			return Ok((
				0x10000 + ((u32::from(second) - 0xD800) << 10) + u32::from(first) - 0xDC00,
				offset - 2,
			));
		}
	}
	Ok((u32::from(first), offset - 1))
}

fn next_code_point<E>(
	length: usize,
	offset: usize,
	unit: &mut impl FnMut(usize) -> Result<u16, E>,
) -> Result<(u32, usize), E> {
	let first = unit(offset)?;
	if (0xD800..=0xDBFF).contains(&first) && offset + 1 < length {
		let second = unit(offset + 1)?;
		if (0xDC00..=0xDFFF).contains(&second) {
			return Ok((
				0x10000 + ((u32::from(first) - 0xD800) << 10) + u32::from(second) - 0xDC00,
				offset + 2,
			));
		}
	}
	Ok((u32::from(first), offset + 1))
}

fn break_between(before: Option<u32>, after: Option<u32>) -> bool {
	if before == Some(0) {
		return !matches!(after, Some(5 | 7));
	}
	if before == Some(2) && after == Some(3) {
		return false;
	}
	if matches!(before, Some(2..=4)) || matches!(after, Some(2..=4)) {
		return true;
	}
	if before == Some(8) && matches!(after, Some(8 | 9 | 11 | 12)) {
		return false;
	}
	if matches!(before, Some(9 | 11)) && matches!(after, Some(9 | 10)) {
		return false;
	}
	if matches!(before, Some(10 | 12)) && after == Some(10) {
		return false;
	}
	if matches!(after, Some(5 | 7 | 13)) || before == Some(1) {
		return false;
	}
	if (before == Some(13) && after == Some(14)) || (before == Some(6) && after == Some(6)) {
		return false;
	}
	true
}

fn wide(point: u32) -> bool {
	matches!(point, 0x2E80..=0xD7AF | 0xF900..=0xFAFF | 0xFF01..=0xFF5E | 0xFFE0..=0xFFE6)
		|| is_emoji_imprecise(point)
}

pub(crate) fn is_emoji_imprecise(point: u32) -> bool {
	matches!(point, 0x1F1E6..=0x1F1FF | 8986 | 8987 | 9200 | 9203 | 9728..=10175 | 11088 | 11093 | 127744..=128591 | 128640..=128764 | 128992..=129008 | 129280..=129535 | 129648..=129782)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::convert::Infallible;

	#[test]
	fn columns_keep_utf16_coordinates_and_midpoint_preference_without_full_line_reads() {
		let text = [9, 0xD83D, 0xDE00, 0x0301];
		let run = |column, operation| {
			cursor_column(text.len(), column, 4.0, operation, |index| {
				Ok::<_, Infallible>(text[index])
			})
			.unwrap()
		};
		assert_eq!(
			[
				run(5.0, CursorColumnOperation::VisibleFromColumn),
				run(5.0, CursorColumnOperation::StatusbarColumn),
				run(5.0, CursorColumnOperation::ColumnFromVisible),
				run(5.1, CursorColumnOperation::ColumnFromVisible)
			],
			[6.0, 7.0, 2.0, 5.0]
		);
		let mut reads = Vec::new();
		let result = cursor_column(
			1_000_000,
			1.0,
			4.0,
			CursorColumnOperation::ColumnFromVisible,
			|index| {
				reads.push(index);
				Ok::<_, Infallible>(97)
			},
		)
		.unwrap();
		assert_eq!((result, reads), (2.0, vec![0, 1]));
	}

	#[test]
	fn reader_failures_propagate_before_requesting_unrelated_units() {
		let mut reads = Vec::new();
		let result = cursor_column(
			100,
			2.0,
			4.0,
			CursorColumnOperation::VisibleFromColumn,
			|index| {
				reads.push(index);
				Err::<u16, _>(17)
			},
		);
		assert_eq!((result, reads), (Err(17), vec![0]));
	}

	#[test]
	fn unicode_steps_keep_reverse_graphemes_surrogate_interiors_and_bounded_reads() {
		let text = [0xD83D, 0xDE00, 0x0301, 97];
		let read = |index| Ok::<_, Infallible>(text[index]);
		assert_eq!(
			[
				unicode_grapheme_offset(text.len(), 0, false, read).unwrap(),
				unicode_grapheme_offset(text.len(), 3, true, read).unwrap(),
				unicode_grapheme_offset(text.len(), 1, false, read).unwrap(),
				unicode_grapheme_offset(text.len(), 1, true, read).unwrap(),
			],
			[3, 0, 3, 0]
		);
		assert_eq!(
			unicode_code_point(text.len(), 2, true, read).unwrap(),
			(0x1F600, 0)
		);
		let mut reads = Vec::new();
		let result = unicode_grapheme_offset(1_000_000, 0, false, |index| {
			reads.push(index);
			Ok::<_, Infallible>(97)
		})
		.unwrap();
		assert_eq!((result, reads), (1, vec![0, 1]));
	}
}
