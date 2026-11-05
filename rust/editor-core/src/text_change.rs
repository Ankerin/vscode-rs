/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Composition of consecutive undo changes without copying split or concatenated source text.

use crate::{BufferError, TextChunk};

/// A change between two document versions in UTF-16 offsets.
#[derive(Clone, Copy, Debug)]
pub struct TextChange<'a> {
	pub old_position: usize,
	pub old_text: &'a [u16],
	pub new_position: usize,
	pub new_text: &'a [u16],
}

/// A composed change whose text fragments borrow the original batch payloads.
#[derive(Debug)]
pub struct CompressedTextChange<'a> {
	pub old_position: usize,
	pub new_position: usize,
	old_chunks: Vec<TextChunk<'a>>,
	new_chunks: Vec<TextChunk<'a>>,
	old_length: usize,
	new_length: usize,
}

impl CompressedTextChange<'_> {
	pub fn old_length(&self) -> usize {
		self.old_length
	}
	pub fn new_length(&self) -> usize {
		self.new_length
	}
	pub fn old_text(&self) -> impl Iterator<Item = u16> + '_ {
		self.old_chunks.iter().flat_map(|chunk| chunk.iter())
	}
	pub fn new_text(&self) -> impl Iterator<Item = u16> + '_ {
		self.new_chunks.iter().flat_map(|chunk| chunk.iter())
	}
}

impl<'a> From<TextChange<'a>> for CompressedTextChange<'a> {
	fn from(change: TextChange<'a>) -> Self {
		Self {
			old_position: change.old_position,
			new_position: change.new_position,
			old_chunks: vec![TextChunk::Utf16(change.old_text)],
			new_chunks: vec![TextChunk::Utf16(change.new_text)],
			old_length: change.old_text.len(),
			new_length: change.new_text.len(),
		}
	}
}

/// Preserves the existing split/rebase/merge order and removes no-ops only after joining changes.
pub fn compress_text_changes<'a>(
	previous: &[TextChange<'a>],
	current: &[TextChange<'a>],
) -> Result<Vec<CompressedTextChange<'a>>, BufferError> {
	for changes in [previous, current] {
		let (mut old_end, mut new_end) = (0, 0);
		for change in changes {
			if change.old_position < old_end || change.new_position < new_end {
				return Err(BufferError::InvalidRange);
			}
			old_end = change
				.old_position
				.checked_add(change.old_text.len())
				.ok_or(BufferError::InvalidRange)?;
			new_end = change
				.new_position
				.checked_add(change.new_text.len())
				.ok_or(BufferError::InvalidRange)?;
		}
	}
	if previous.is_empty() {
		return Ok(current
			.iter()
			.copied()
			.map(CompressedTextChange::from)
			.collect());
	}
	let mut first = previous.iter().copied();
	let mut second = current.iter().copied();
	let (mut previous, mut current) = (first.next(), second.next());
	let (mut previous_delta, mut current_delta) = (0_i64, 0_i64);
	let mut result = Vec::new();
	while previous.is_some() || current.is_some() {
		let accept_current = current.is_some_and(|current| {
			previous.is_none_or(|previous| {
				current.old_position + current.old_text.len() <= previous.new_position
			})
		});
		if accept_current {
			let mut change = current.take().expect("The current change exists");
			change.old_position = translate(change.old_position, -previous_delta)?;
			current_delta += delta(&change);
			result.push(change);
			current = second.next();
			continue;
		}
		let accept_previous = previous.is_some_and(|previous| {
			current.is_none_or(|current| {
				previous.new_position + previous.new_text.len() <= current.old_position
			})
		});
		if accept_previous {
			let mut change = previous.take().expect("The previous change exists");
			change.new_position = translate(change.new_position, current_delta)?;
			previous_delta += delta(&change);
			result.push(change);
			previous = first.next();
			continue;
		}
		let one = previous.expect("Overlapping changes exist");
		let two = current.expect("Overlapping changes exist");
		if two.old_position < one.new_position {
			let (mut prefix, suffix) = split_current(two, one.new_position - two.old_position);
			prefix.old_position = translate(prefix.old_position, -previous_delta)?;
			current_delta += delta(&prefix);
			result.push(prefix);
			current = Some(suffix);
			continue;
		}
		if one.new_position < two.old_position {
			let (mut prefix, suffix) = split_previous(one, two.old_position - one.new_position);
			prefix.new_position = translate(prefix.new_position, current_delta)?;
			previous_delta += delta(&prefix);
			result.push(prefix);
			previous = Some(suffix);
			continue;
		}
		let (merge_previous, merge_current) = match two.old_text.len().cmp(&one.new_text.len()) {
			std::cmp::Ordering::Equal => {
				previous = first.next();
				current = second.next();
				(one, two)
			}
			std::cmp::Ordering::Less => {
				let (prefix, suffix) = split_previous(one, two.old_text.len());
				previous = Some(suffix);
				current = second.next();
				(prefix, two)
			}
			std::cmp::Ordering::Greater => {
				let (prefix, suffix) = split_current(two, one.new_text.len());
				previous = first.next();
				current = Some(suffix);
				(one, prefix)
			}
		};
		result.push(TextChange {
			old_position: merge_previous.old_position,
			old_text: merge_previous.old_text,
			new_position: merge_current.new_position,
			new_text: merge_current.new_text,
		});
		previous_delta += delta(&merge_previous);
		current_delta += delta(&merge_current);
	}
	let mut merged: Vec<CompressedTextChange<'a>> = Vec::new();
	for change in result {
		if let Some(last) = merged.last_mut()
			&& last.old_position.checked_add(last.old_length) == Some(change.old_position)
		{
			last.old_length = last
				.old_length
				.checked_add(change.old_text.len())
				.ok_or(BufferError::InvalidRange)?;
			last.new_length = last
				.new_length
				.checked_add(change.new_text.len())
				.ok_or(BufferError::InvalidRange)?;
			last.old_chunks.push(TextChunk::Utf16(change.old_text));
			last.new_chunks.push(TextChunk::Utf16(change.new_text));
		} else {
			merged.push(change.into());
		}
	}
	merged.retain(|change| {
		change.old_length != change.new_length || !change.old_text().eq(change.new_text())
	});
	Ok(merged)
}

fn translate(position: usize, delta: i64) -> Result<usize, BufferError> {
	let position = i64::try_from(position).map_err(|_| BufferError::InvalidRange)?;
	usize::try_from(
		position
			.checked_add(delta)
			.ok_or(BufferError::InvalidRange)?,
	)
	.map_err(|_| BufferError::InvalidRange)
}

fn delta(change: &TextChange<'_>) -> i64 {
	change.new_text.len() as i64 - change.old_text.len() as i64
}

fn split_previous(change: TextChange<'_>, offset: usize) -> (TextChange<'_>, TextChange<'_>) {
	let (prefix, suffix) = change.new_text.split_at(offset);
	(
		TextChange {
			new_text: prefix,
			..change
		},
		TextChange {
			old_position: change.old_position + change.old_text.len(),
			old_text: &[],
			new_position: change.new_position + offset,
			new_text: suffix,
		},
	)
}

fn split_current(change: TextChange<'_>, offset: usize) -> (TextChange<'_>, TextChange<'_>) {
	let (prefix, suffix) = change.old_text.split_at(offset);
	(
		TextChange {
			old_text: prefix,
			..change
		},
		TextChange {
			old_position: change.old_position + offset,
			old_text: suffix,
			new_position: change.new_position + change.new_text.len(),
			new_text: &[],
		},
	)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn composition_splits_intermediate_text_without_copying_payloads() {
		let inserted = [97, 0xD800, 0xDC00, 98];
		let previous = [TextChange {
			old_position: 0,
			old_text: &[],
			new_position: 0,
			new_text: &inserted,
		}];
		let current = [TextChange {
			old_position: 1,
			old_text: &inserted[1..3],
			new_position: 1,
			new_text: &[99],
		}];
		let changes = compress_text_changes(&previous, &current).unwrap();
		let change = &changes[0];
		assert_eq!(
			(
				changes.len(),
				change.old_position,
				change.new_position,
				change.old_length(),
				change.old_text().collect::<Vec<_>>(),
				change.new_text().collect::<Vec<_>>()
			),
			(1, 0, 0, 0, vec![], vec![97, 99, 98])
		);
		assert!(
			matches!(change.new_chunks[0], TextChunk::Utf16(slice) if std::ptr::eq(slice.as_ptr(), inserted.as_ptr()))
		);
	}

	#[test]
	fn composition_removes_reverted_text_after_merging_and_checks_ranges() {
		let previous = [TextChange {
			old_position: 2,
			old_text: &[0xD800],
			new_position: 2,
			new_text: &[0xFEFF],
		}];
		let current = [TextChange {
			old_position: 2,
			old_text: &[0xFEFF],
			new_position: 2,
			new_text: &[0xD800],
		}];
		assert!(
			compress_text_changes(&previous, &current)
				.unwrap()
				.is_empty()
		);
		let uncompressed = compress_text_changes(&[], &current).unwrap();
		assert_eq!(uncompressed[0].new_text().collect::<Vec<_>>(), vec![0xD800]);
		let overlapping = [previous[0], previous[0]];
		assert!(matches!(
			compress_text_changes(&overlapping, &current),
			Err(BufferError::InvalidRange)
		));
	}
}
