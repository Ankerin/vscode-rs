/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use super::{BufferError, Position, TextBuffer, TextEdit, TextSnapshot};

fn units(text: &str) -> Vec<u16> {
	text.encode_utf16().collect()
}

fn collect_snapshot(mut snapshot: TextSnapshot) -> Vec<u16> {
	let mut result = Vec::new();
	while let Some(chunk) = snapshot.read() {
		chunk.copy_to(&mut result);
	}
	result
}

fn reference_line_ranges(text: &[u16]) -> Vec<std::ops::Range<usize>> {
	let mut ranges = Vec::new();
	let mut start = 0;
	let mut offset = 0;
	while offset < text.len() {
		if text[offset] == 13 || text[offset] == 10 {
			ranges.push(start..offset);
			let is_crlf = text[offset] == 13 && text.get(offset + 1) == Some(&10);
			offset += if is_crlf { 2 } else { 1 };
			start = offset;
		} else {
			offset += 1;
		}
	}
	ranges.push(start..text.len());
	ranges
}

fn assert_matches(buffer: &TextBuffer, expected: &[u16]) {
	buffer.assert_invariants();
	assert_eq!(buffer.to_units(), expected);
	let ranges = reference_line_ranges(expected);
	assert_eq!(
		(buffer.len(), buffer.line_count()),
		(expected.len(), ranges.len())
	);
	for (index, range) in ranges.iter().enumerate() {
		let line_number = index + 1;
		let text = &expected[range.clone()];
		assert_eq!(
			(
				buffer.first_non_whitespace_column(line_number).unwrap(),
				buffer.last_non_whitespace_column(line_number).unwrap()
			),
			(
				text.iter()
					.position(|unit| !matches!(unit, 9 | 32))
					.map_or(0, |index| index + 1),
				text.iter()
					.rposition(|unit| !matches!(unit, 9 | 32))
					.map_or(0, |index| index + 2),
			)
		);
		assert_eq!(
			buffer.line_content(line_number).unwrap(),
			&expected[range.clone()]
		);
		assert_eq!(buffer.line_length(line_number).unwrap(), range.len());
		assert_eq!(
			buffer.offset_at(Position {
				line_number,
				column: 1
			}),
			Ok(range.start)
		);
	}
	for offset in (0..=expected.len()).step_by((expected.len() / 100).max(1)) {
		let line_index = ranges.partition_point(|range| range.start <= offset) - 1;
		let position = Position {
			line_number: line_index + 1,
			column: offset - ranges[line_index].start + 1,
		};
		assert_eq!(buffer.position_at(offset), position);
		assert_eq!(buffer.offset_at(position), Ok(offset));
		assert_eq!(buffer.char_at(offset), expected.get(offset).copied());
	}
	assert_eq!(collect_snapshot(buffer.snapshot()), expected);
}

#[test]
fn character_counts_preserve_unmatched_high_surrogates_and_reset_at_line_boundaries() {
	let buffer = TextBuffer::new(&[
		97, 0xD800, 98, 0xDC00, 13, 10, 0xD83D, 0xDE00, 0xD800, 10, 0xD800, 0xD801, 0xDC00,
	]);
	let start = Position {
		line_number: 1,
		column: 1,
	};
	let end = Position {
		line_number: 3,
		column: 4,
	};
	assert_eq!(
		(
			buffer.character_count(start, end, 1).unwrap(),
			buffer.character_count(start, end, 2).unwrap()
		),
		(9, 11)
	);
	assert_eq!(
		buffer
			.character_count(
				start,
				Position {
					line_number: 1,
					column: 3
				},
				1
			)
			.unwrap(),
		2
	);
	assert_eq!(
		buffer
			.character_count(
				Position {
					line_number: 2,
					column: 2
				},
				Position {
					line_number: 2,
					column: 4
				},
				1
			)
			.unwrap(),
		2
	);
	assert!(matches!(
		buffer.character_count(
			start,
			Position {
				line_number: 1,
				column: 6
			},
			1
		),
		Err(BufferError::InvalidPosition)
	));
}

#[test]
fn whitespace_queries_scan_both_directions_across_shared_leaf_splits() {
	let mut text = vec![32; 1023];
	text.extend([0xD83D, 0xDE00]);
	text.extend(vec![9; 4096]);
	text.extend([13, 10, 32, 9, 10]);
	let mut buffer = TextBuffer::new(&text);
	assert_eq!(
		(
			buffer.first_non_whitespace_column(1).unwrap(),
			buffer.last_non_whitespace_column(1).unwrap(),
			buffer.first_non_whitespace_column(2).unwrap(),
			buffer.last_non_whitespace_column(2).unwrap()
		),
		(1024, 1026, 0, 0)
	);
	buffer.replace(0..512, &[]).unwrap();
	assert_eq!(
		(
			buffer.first_non_whitespace_column(1).unwrap(),
			buffer.last_non_whitespace_column(1).unwrap()
		),
		(512, 514)
	);
	assert_matches(&buffer, &text[512..]);
}

#[test]
fn preserves_all_utf16_units_and_line_endings() {
	for text in [
		vec![],
		units("one\r\ntwo\rthree\nfour\r\n"),
		vec![
			0, 0xD800, 0xDC00, 0xDFFF, 13, 10, 0xD800, 10, 0x2028, 0x2029, 0x85,
		],
		units("\r\n\r\n\r\r\n\n\n"),
	] {
		assert_matches(&TextBuffer::new(&text), &text);
	}
}

#[test]
fn unicode_string_construction_and_edits_keep_utf16_coordinates() {
	let multiline = "ASCII\r\n".repeat(2048);
	for text in [
		"",
		multiline.as_str(),
		"\0\u{80}\u{9F}\u{FF}\u{FEFF}\u{1F600}\r\n",
	] {
		let mut buffer = TextBuffer::from_text(text);
		let mut expected = units(text);
		assert_matches(&buffer, &expected);
		let inserted = "new\u{1F600}\r\n";
		buffer.replace_text(0..0, inserted).unwrap();
		expected.splice(0..0, units(inserted));
		assert_matches(&buffer, &expected);
	}
}

#[test]
fn bounded_line_batches_preserve_mixed_endings_empty_lines_and_long_lines() {
	let buffer = TextBuffer::new(&units("one\r\n\rtwo\nthree\r\n"));
	let observations: Vec<_> = [
		(1, 64, 0),
		(1, 64, 5),
		(1, 2, 100),
		(2, 64, 100),
		(3, 1, 100),
		(5, 64, 100),
	]
	.into_iter()
	.map(|(line, count, budget)| buffer.line_batch(line, count, budget).unwrap())
	.collect();
	assert_eq!(
		observations,
		["one", "one\r\n", "one\r\n", "\rtwo\nthree\r\n", "two", ""].map(units)
	);
	assert_eq!(
		buffer.line_batch(1, 0, 100),
		Err(BufferError::InvalidPosition)
	);
	let text = format!("short\n{}\nlast", "x".repeat(40000));
	let long = TextBuffer::from_text(&text);
	assert_eq!(long.line_batch(1, 64, 32768).unwrap(), units("short"));
	assert_eq!(long.line_batch(2, 64, 32768).unwrap(), vec![120; 40000]);
	assert_eq!(
		long.line_batch(2, usize::MAX, usize::MAX).unwrap(),
		units(&text[6..])
	);
}

#[test]
fn range_snapshots_start_and_stop_inside_compact_wide_and_split_surrogate_leaves() {
	let mut text = vec![65; 8192];
	for offset in [1023, 3071, 6143] {
		text[offset] = 0xD800;
		text[offset + 1] = 0xDC00;
	}
	let mut buffer = TextBuffer::new(&text);
	let ranges = [0..0, 0..1, 1000..1024, 1024..2049, 3071..7000, 8192..8192];
	let snapshots: Vec<_> = ranges
		.iter()
		.map(|range| buffer.snapshot_range(range.clone()).unwrap())
		.collect();
	buffer.replace_text(0..buffer.len(), "changed").unwrap();
	drop(buffer);
	for (range, snapshot) in ranges.into_iter().zip(snapshots) {
		assert_eq!(collect_snapshot(snapshot), text[range]);
	}
}

#[test]
fn handles_crlf_spanning_leaves_and_edit_boundaries() {
	let mut text = vec![65; 8192];
	for offset in [1023, 2047, 4095, 6143] {
		text[offset] = 13;
		text[offset + 1] = 10;
	}
	let mut buffer = TextBuffer::new(&text);
	assert_matches(&buffer, &text);
	for offset in [1024, 4096, 6144] {
		buffer.replace(offset..offset, &[66, 13]).unwrap();
		text.splice(offset..offset, [66, 13]);
		assert_matches(&buffer, &text);
		buffer.replace(offset..offset + 2, &[]).unwrap();
		text.drain(offset..offset + 2);
		assert_matches(&buffer, &text);
	}
}

#[test]
fn snapshots_and_clones_survive_edits_normalization_and_source_drop() {
	let text = units(&"one\r\ntwo\rthree\n".repeat(1024));
	let mut buffer = TextBuffer::new(&text);
	let snapshot = buffer.snapshot();
	let original = buffer.clone();
	buffer.replace(0..4, &units("replacement")).unwrap();
	buffer.normalize_eol(false);
	buffer.replace(0..buffer.len(), &[]).unwrap();
	drop(buffer);
	assert_eq!(collect_snapshot(snapshot), text);
	assert_matches(&original, &text);
}

#[test]
fn normalizes_mixed_endings_without_changing_surrogates() {
	let original = [0xD800, 13, 10, 0xDC00, 13, 65, 10, 0xDFFF, 13];
	let mut buffer = TextBuffer::new(&original);
	buffer.normalize_eol(false);
	assert_matches(&buffer, &[0xD800, 10, 0xDC00, 10, 65, 10, 0xDFFF, 10]);
	buffer.normalize_eol(true);
	assert_matches(
		&buffer,
		&[0xD800, 13, 10, 0xDC00, 13, 10, 65, 13, 10, 0xDFFF, 13, 10],
	);
}

#[test]
fn applies_batches_in_original_coordinates_and_preserves_insertion_order() {
	let mut buffer = TextBuffer::new(&units("abcdef"));
	buffer
		.apply_edits(&[
			TextEdit {
				range: 1..1,
				text: &units("first"),
			},
			TextEdit {
				range: 1..1,
				text: &units("second"),
			},
			TextEdit {
				range: 3..5,
				text: &units("last"),
			},
		])
		.unwrap();
	assert_matches(&buffer, &units("afirstsecondbclastf"));
}

#[test]
fn rejects_invalid_batches_without_partial_changes() {
	let original = units("abcdef");
	let mut buffer = TextBuffer::new(&original);
	for (edits, expected) in [
		(
			vec![
				TextEdit {
					range: 0..1,
					text: &[65],
				},
				TextEdit {
					range: 4..7,
					text: &[],
				},
			],
			BufferError::InvalidRange,
		),
		(
			vec![
				TextEdit {
					range: 1..4,
					text: &[],
				},
				TextEdit {
					range: 3..5,
					text: &[],
				},
			],
			BufferError::OverlappingEdits,
		),
		(
			vec![
				TextEdit {
					range: 4..4,
					text: &[],
				},
				TextEdit {
					range: 1..1,
					text: &[],
				},
			],
			BufferError::OverlappingEdits,
		),
	] {
		assert_eq!(buffer.apply_edits(&edits), Err(expected));
		assert_matches(&buffer, &original);
	}
	assert_eq!(buffer.slice(0..usize::MAX), Err(BufferError::InvalidRange));
	assert_eq!(
		buffer.offset_at(Position {
			line_number: 0,
			column: 1
		}),
		Err(BufferError::InvalidPosition)
	);
	assert_eq!(
		buffer.offset_at(Position {
			line_number: 1,
			column: 0
		}),
		Err(BufferError::InvalidPosition)
	);
	assert_eq!(
		buffer.position_at(usize::MAX),
		Position {
			line_number: 1,
			column: 7
		}
	);
}

struct Random(u64);

impl Random {
	fn next(&mut self, limit: usize) -> usize {
		self.0 = self
			.0
			.wrapping_mul(6364136223846793005)
			.wrapping_add(1442695040888963407);
		((self.0 >> 32) as usize) % limit
	}

	fn text(&mut self, length: usize) -> Vec<u16> {
		const ALPHABET: [u16; 12] = [
			65, 66, 67, 13, 10, 9, 0, 0xD800, 0xDC00, 0xDFFF, 0x2028, 0xFFFF,
		];
		(0..length)
			.map(|_| ALPHABET[self.next(ALPHABET.len())])
			.collect()
	}
}

#[test]
fn seeded_batches_match_flat_replacements_and_retain_original_snapshots() {
	let mut random = Random(42);
	for _ in 0..256 {
		let original = random.text(4096);
		let mut reference = original.clone();
		let mut buffer = TextBuffer::new(&original);
		let snapshot = buffer.snapshot();
		let mut replacements = Vec::new();
		let mut offset = 0;
		for _ in 0..16 {
			let start = (offset + random.next(129)).min(original.len());
			let end = (start + random.next(9)).min(original.len());
			let length = random.next(33);
			replacements.push((start..end, random.text(length)));
			offset = end;
		}
		for (range, text) in replacements.iter().rev() {
			reference.splice(range.clone(), text.iter().copied());
		}
		let edits: Vec<_> = replacements
			.iter()
			.map(|(range, text)| TextEdit {
				range: range.clone(),
				text,
			})
			.collect();
		buffer.apply_edits(&edits).unwrap();
		assert_matches(&buffer, &reference);
		assert_eq!(collect_snapshot(snapshot), original);
	}
}

#[test]
fn seeded_edits_match_a_flat_reference_and_keep_tree_balanced() {
	for seed in 1..=16 {
		let mut random = Random(seed);
		let mut reference = random.text(8192);
		let mut buffer = TextBuffer::new(&reference);
		for iteration in 0..512 {
			let start = random.next(reference.len() + 1);
			let length = random.next(65).min(reference.len() - start);
			let insert_length = random.next(65);
			let inserted = random.text(insert_length);
			let snapshot = buffer.snapshot();
			let previous = reference.clone();
			buffer.replace(start..start + length, &inserted).unwrap();
			reference.splice(start..start + length, inserted);
			buffer.assert_invariants();
			assert_eq!(collect_snapshot(snapshot), previous);
			if iteration % 32 == 0 {
				assert_matches(&buffer, &reference);
			}
		}
		assert_matches(&buffer, &reference);
	}
}

#[test]
fn repeated_typing_and_deletion_keep_tree_balanced() {
	let mut buffer = TextBuffer::default();
	for _ in 0..16384 {
		buffer.replace(buffer.len()..buffer.len(), &[65]).unwrap();
	}
	assert_matches(&buffer, &vec![65; 16384]);
	for _ in 0..8192 {
		let middle = buffer.len() / 2;
		buffer.replace(middle..middle + 1, &[]).unwrap();
	}
	assert_matches(&buffer, &vec![65; 8192]);
}
