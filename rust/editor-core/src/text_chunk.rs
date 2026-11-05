/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use std::{iter::FusedIterator, ops::Range, slice};

/// A borrowed, lossless leaf view. Latin-1 uses one byte per UTF-16 code unit.
#[derive(Clone, Copy, Debug)]
pub enum TextChunk<'a> {
	Latin1(&'a [u8]),
	Utf16(&'a [u16]),
}

impl<'a> TextChunk<'a> {
	pub fn len(self) -> usize {
		match self {
			Self::Latin1(units) => units.len(),
			Self::Utf16(units) => units.len(),
		}
	}

	pub fn is_empty(self) -> bool {
		self.len() == 0
	}

	pub fn get(self, offset: usize) -> Option<u16> {
		match self {
			Self::Latin1(units) => units.get(offset).copied().map(u16::from),
			Self::Utf16(units) => units.get(offset).copied(),
		}
	}

	pub fn iter(self) -> TextChunkIter<'a> {
		match self {
			Self::Latin1(units) => TextChunkIter::Latin1(units.iter()),
			Self::Utf16(units) => TextChunkIter::Utf16(units.iter()),
		}
	}

	pub fn copy_to(self, output: &mut Vec<u16>) {
		match self {
			Self::Latin1(units) => output.extend(units.iter().copied().map(u16::from)),
			Self::Utf16(units) => output.extend_from_slice(units),
		}
	}

	/// Borrows a subrange in code-unit coordinates without decoding or allocating.
	pub fn slice(self, range: Range<usize>) -> Self {
		match self {
			Self::Latin1(units) => Self::Latin1(&units[range]),
			Self::Utf16(units) => Self::Utf16(&units[range]),
		}
	}
}

/// Iterates UTF-16 code units without decoding or allocating a compact leaf.
#[derive(Clone, Debug)]
pub enum TextChunkIter<'a> {
	Latin1(slice::Iter<'a, u8>),
	Utf16(slice::Iter<'a, u16>),
}

impl Iterator for TextChunkIter<'_> {
	type Item = u16;

	fn next(&mut self) -> Option<Self::Item> {
		match self {
			Self::Latin1(units) => units.next().copied().map(u16::from),
			Self::Utf16(units) => units.next().copied(),
		}
	}

	fn size_hint(&self) -> (usize, Option<usize>) {
		match self {
			Self::Latin1(units) => units.size_hint(),
			Self::Utf16(units) => units.size_hint(),
		}
	}
}

impl ExactSizeIterator for TextChunkIter<'_> {}
impl FusedIterator for TextChunkIter<'_> {}
