/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use std::sync::Arc;

use crate::TextChunk;

const LEAF_CAPACITY: usize = 1024;
const CR: u16 = 13;
const LF: u16 = 10;

pub(crate) type Tree = Option<Arc<Node>>;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Summary {
	pub length: usize,
	pub line_breaks: usize,
	first: Option<u16>,
	last: Option<u16>,
}

impl Summary {
	#[cfg(test)]
	fn from_units(units: &[u16]) -> Self {
		let mut line_breaks = 0;
		let mut previous = None;
		for &unit in units {
			if unit == CR || (unit == LF && previous != Some(CR)) {
				line_breaks += 1;
			}
			previous = Some(unit);
		}
		Self {
			length: units.len(),
			line_breaks,
			first: units.first().copied(),
			last: units.last().copied(),
		}
	}

	fn joins_crlf(self, other: Self) -> bool {
		self.last == Some(CR) && other.first == Some(LF)
	}

	fn combine(self, other: Self) -> Self {
		Self {
			length: self.length + other.length,
			line_breaks: self.line_breaks + other.line_breaks - usize::from(self.joins_crlf(other)),
			first: self.first.or(other.first),
			last: other.last.or(self.last),
		}
	}
}

#[derive(Debug)]
enum LeafUnits {
	Latin1(Box<[u8]>),
	Utf16(Box<[u16]>),
}

#[derive(Debug)]
struct LeafData {
	units: LeafUnits,
	line_ends: Box<[u16]>,
}

impl LeafData {
	fn new(units: &[u16]) -> Arc<Self> {
		let units = if units.iter().all(|&unit| unit <= 255) {
			LeafUnits::Latin1(units.iter().map(|&unit| unit as u8).collect())
		} else {
			LeafUnits::Utf16(units.into())
		};
		Self::from_storage(units)
	}

	fn from_storage(units: LeafUnits) -> Arc<Self> {
		let mut data = Self {
			units,
			line_ends: Box::default(),
		};
		let content = data.chunk();
		let mut line_ends = Vec::new();
		let mut offset = 0;
		while offset < content.len() {
			let unit = content.get(offset).expect("The leaf offset exists");
			offset += 1;
			if unit == CR || unit == LF {
				if unit == CR && content.get(offset) == Some(LF) {
					offset += 1;
				}
				line_ends.push(offset as u16);
			}
		}
		data.line_ends = line_ends.into_boxed_slice();
		Arc::new(data)
	}

	fn chunk(&self) -> TextChunk<'_> {
		match &self.units {
			LeafUnits::Latin1(units) => TextChunk::Latin1(units),
			LeafUnits::Utf16(units) => TextChunk::Utf16(units),
		}
	}

	fn summary(&self, start: usize, end: usize) -> Summary {
		let content = self.chunk();
		let length = end - start;
		let last = if length == 0 {
			None
		} else {
			content.get(end - 1)
		};
		Summary {
			length,
			line_breaks: self
				.line_ends
				.partition_point(|&offset| usize::from(offset) <= end)
				- self
					.line_ends
					.partition_point(|&offset| usize::from(offset) <= start)
				+ usize::from(last == Some(CR) && content.get(end) == Some(LF)),
			first: if length == 0 {
				None
			} else {
				content.get(start)
			},
			last,
		}
	}
}

#[derive(Debug)]
enum Content {
	Leaf {
		data: Arc<LeafData>,
		start: usize,
		end: usize,
	},
	Branch {
		left: Arc<Node>,
		right: Arc<Node>,
	},
}

#[derive(Debug)]
pub(crate) struct Node {
	content: Content,
	pub summary: Summary,
	height: u32,
}

impl Node {
	fn leaf(data: Arc<LeafData>, start: usize, end: usize) -> Arc<Self> {
		Arc::new(Self {
			summary: data.summary(start, end),
			content: Content::Leaf { data, start, end },
			height: 1,
		})
	}

	fn branch(left: Arc<Self>, right: Arc<Self>) -> Arc<Self> {
		Arc::new(Self {
			summary: left.summary.combine(right.summary),
			height: 1 + left.height.max(right.height),
			content: Content::Branch { left, right },
		})
	}

	fn children(&self) -> (&Arc<Self>, &Arc<Self>) {
		match &self.content {
			Content::Branch { left, right } => (left, right),
			Content::Leaf { .. } => unreachable!("A rotated node must be a branch"),
		}
	}

	pub fn char_at(&self, offset: usize) -> Option<u16> {
		if offset >= self.summary.length {
			return None;
		}
		match &self.content {
			Content::Leaf { data, start, .. } => data.chunk().get(start + offset),
			Content::Branch { left, right } => {
				if offset < left.summary.length {
					left.char_at(offset)
				} else {
					right.char_at(offset - left.summary.length)
				}
			}
		}
	}

	pub fn chunk_at(&self, offset: usize) -> TextChunk<'_> {
		match &self.content {
			Content::Leaf {
				data, start, end, ..
			} => data.chunk().slice(start + offset..*end),
			Content::Branch { left, right } => {
				if offset < left.summary.length {
					left.chunk_at(offset)
				} else {
					right.chunk_at(offset - left.summary.length)
				}
			}
		}
	}

	/// Counts completed line endings before `offset`, including a CRLF spanning leaves.
	pub fn line_breaks_before(&self, offset: usize) -> usize {
		let prefix = self.prefix_summary(offset);
		prefix.line_breaks
			- usize::from(prefix.last == Some(CR) && self.char_at(offset) == Some(LF))
	}

	fn prefix_summary(&self, length: usize) -> Summary {
		if length >= self.summary.length {
			return self.summary;
		}
		match &self.content {
			Content::Leaf { data, start, .. } => data.summary(*start, start + length),
			Content::Branch { left, right } => {
				if length <= left.summary.length {
					left.prefix_summary(length)
				} else {
					left.summary
						.combine(right.prefix_summary(length - left.summary.length))
				}
			}
		}
	}

	/// Returns the offset immediately after the one-based line ending.
	pub fn line_break_end(&self, ordinal: usize) -> usize {
		debug_assert!(ordinal > 0 && ordinal <= self.summary.line_breaks);
		match &self.content {
			Content::Leaf { data, start, end } => {
				let before = data
					.line_ends
					.partition_point(|&offset| usize::from(offset) <= *start);
				data.line_ends
					.get(before + ordinal - 1)
					.map_or(*end, |&offset| usize::from(offset).min(*end))
					- start
			}
			Content::Branch { left, right } => {
				let joins_crlf = left.summary.joins_crlf(right.summary);
				if ordinal <= left.summary.line_breaks {
					if joins_crlf && ordinal == left.summary.line_breaks {
						left.summary.length + 1
					} else {
						left.line_break_end(ordinal)
					}
				} else {
					left.summary.length
						+ right.line_break_end(
							ordinal - left.summary.line_breaks + usize::from(joins_crlf),
						)
				}
			}
		}
	}

	pub fn copy_range(&self, start: usize, end: usize, output: &mut Vec<u16>) {
		if start >= end {
			return;
		}
		match &self.content {
			Content::Leaf {
				data, start: base, ..
			} => {
				data.chunk().slice(base + start..base + end).copy_to(output);
			}
			Content::Branch { left, right } => {
				let left_length = left.summary.length;
				if start < left_length {
					left.copy_range(start, end.min(left_length), output);
				}
				if end > left_length {
					right.copy_range(start.saturating_sub(left_length), end - left_length, output);
				}
			}
		}
	}
}

pub(crate) fn from_units(units: &[u16]) -> Tree {
	let leaves: Vec<_> = units
		.chunks(LEAF_CAPACITY)
		.map(|chunk| Node::leaf(LeafData::new(chunk), 0, chunk.len()))
		.collect();
	build(&leaves)
}

pub(crate) fn from_text(text: &str) -> Tree {
	if !text.is_ascii() {
		return from_units(&text.encode_utf16().collect::<Vec<_>>());
	}
	let leaves: Vec<_> = text
		.as_bytes()
		.chunks(LEAF_CAPACITY)
		.map(|chunk| {
			Node::leaf(
				LeafData::from_storage(LeafUnits::Latin1(chunk.into())),
				0,
				chunk.len(),
			)
		})
		.collect();
	build(&leaves)
}

fn build(leaves: &[Arc<Node>]) -> Tree {
	match leaves.len() {
		0 => None,
		1 => Some(Arc::clone(&leaves[0])),
		length => concat(build(&leaves[..length / 2]), build(&leaves[length / 2..])),
	}
}

fn balance(left: Arc<Node>, right: Arc<Node>) -> Arc<Node> {
	if left.height > right.height + 1 {
		let (left_left, left_right) = left.children();
		if left_left.height >= left_right.height {
			Node::branch(
				Arc::clone(left_left),
				Node::branch(Arc::clone(left_right), right),
			)
		} else {
			let (middle_left, middle_right) = left_right.children();
			Node::branch(
				Node::branch(Arc::clone(left_left), Arc::clone(middle_left)),
				Node::branch(Arc::clone(middle_right), right),
			)
		}
	} else if right.height > left.height + 1 {
		let (right_left, right_right) = right.children();
		if right_right.height >= right_left.height {
			Node::branch(
				Node::branch(left, Arc::clone(right_left)),
				Arc::clone(right_right),
			)
		} else {
			let (middle_left, middle_right) = right_left.children();
			Node::branch(
				Node::branch(left, Arc::clone(middle_left)),
				Node::branch(Arc::clone(middle_right), Arc::clone(right_right)),
			)
		}
	} else {
		Node::branch(left, right)
	}
}

pub(crate) fn concat(left: Tree, right: Tree) -> Tree {
	let (left, right) = match (left, right) {
		(None, right) => return right,
		(left, None) => return left,
		(Some(left), Some(right)) => (left, right),
	};
	if let (
		Content::Leaf {
			data: left_data,
			start: left_start,
			end: left_end,
			..
		},
		Content::Leaf {
			data: right_data,
			start: right_start,
			end: right_end,
			..
		},
	) = (&left.content, &right.content)
		&& left.summary.length + right.summary.length <= LEAF_CAPACITY
	{
		if Arc::ptr_eq(left_data, right_data) && left_end == right_start {
			return Some(Node::leaf(Arc::clone(left_data), *left_start, *right_end));
		}
		let length = left.summary.length + right.summary.length;
		let data = match (left_data.chunk(), right_data.chunk()) {
			(TextChunk::Latin1(left_units), TextChunk::Latin1(right_units)) => {
				let mut units = Vec::with_capacity(length);
				units.extend_from_slice(&left_units[*left_start..*left_end]);
				units.extend_from_slice(&right_units[*right_start..*right_end]);
				LeafData::from_storage(LeafUnits::Latin1(units.into_boxed_slice()))
			}
			(left_units, right_units) => {
				let mut units = Vec::with_capacity(length);
				left_units.slice(*left_start..*left_end).copy_to(&mut units);
				right_units
					.slice(*right_start..*right_end)
					.copy_to(&mut units);
				LeafData::new(&units)
			}
		};
		return Some(Node::leaf(data, 0, length));
	}
	if left.height > right.height + 1 {
		let (left_left, left_right) = left.children();
		Some(balance(
			Arc::clone(left_left),
			concat(Some(Arc::clone(left_right)), Some(right)).expect("Both trees are nonempty"),
		))
	} else if right.height > left.height + 1 {
		let (right_left, right_right) = right.children();
		Some(balance(
			concat(Some(left), Some(Arc::clone(right_left))).expect("Both trees are nonempty"),
			Arc::clone(right_right),
		))
	} else {
		Some(Node::branch(left, right))
	}
}

pub(crate) fn split(tree: Tree, offset: usize) -> (Tree, Tree) {
	let Some(node) = tree else {
		return (None, None);
	};
	if offset == 0 {
		return (None, Some(node));
	}
	if offset >= node.summary.length {
		return (Some(node), None);
	}
	match &node.content {
		Content::Leaf {
			data, start, end, ..
		} => (
			Some(Node::leaf(Arc::clone(data), *start, start + offset)),
			Some(Node::leaf(Arc::clone(data), start + offset, *end)),
		),
		Content::Branch { left, right } => {
			if offset < left.summary.length {
				let (before, after) = split(Some(Arc::clone(left)), offset);
				(before, concat(after, Some(Arc::clone(right))))
			} else {
				let (before, after) = split(Some(Arc::clone(right)), offset - left.summary.length);
				(concat(Some(Arc::clone(left)), before), after)
			}
		}
	}
}

/// Lazily walks one immutable version. Creation only retains the root; reads visit each node once.
#[derive(Debug)]
pub(crate) struct Chunks {
	next: Tree,
	offset: usize,
	pending: Vec<Arc<Node>>,
	current: Tree,
}

impl Chunks {
	pub fn new(root: Tree, offset: usize) -> Self {
		Self {
			next: root.filter(|node| offset < node.summary.length),
			offset,
			pending: Vec::new(),
			current: None,
		}
	}

	pub fn read(&mut self) -> Option<TextChunk<'_>> {
		self.current = None;
		let mut node = self.next.take().or_else(|| self.pending.pop())?;
		let mut offset = std::mem::take(&mut self.offset);
		loop {
			match &node.content {
				Content::Branch { left, right } => {
					if offset < left.summary.length {
						self.pending.push(Arc::clone(right));
						node = Arc::clone(left);
					} else {
						offset -= left.summary.length;
						node = Arc::clone(right);
					}
				}
				Content::Leaf { .. } => {
					self.current = Some(node);
					return self.current.as_ref().map(|node| node.chunk_at(offset));
				}
			}
		}
	}
}

#[cfg(test)]
pub(crate) fn assert_invariants(tree: &Tree) -> (u32, Summary) {
	let Some(node) = tree else {
		return (0, Summary::default());
	};
	let (height, summary) = match &node.content {
		Content::Leaf {
			data, start, end, ..
		} => {
			assert!(*start < *end && end - start <= LEAF_CAPACITY);
			let units: Vec<_> = data.chunk().slice(*start..*end).iter().collect();
			(1, Summary::from_units(&units))
		}
		Content::Branch { left, right } => {
			let (left_height, left_summary) = assert_invariants(&Some(Arc::clone(left)));
			let (right_height, right_summary) = assert_invariants(&Some(Arc::clone(right)));
			assert!(left_height.abs_diff(right_height) <= 1);
			(
				1 + left_height.max(right_height),
				left_summary.combine(right_summary),
			)
		}
	};
	assert_eq!((node.height, node.summary), (height, summary));
	(height, summary)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn compact_storage_preserves_the_entire_latin1_alphabet() {
		let units: Vec<_> = (0..=255).cycle().take(LEAF_CAPACITY).collect();
		let data = LeafData::new(&units);
		assert!(matches!(&data.units, LeafUnits::Latin1(bytes) if bytes.len() == units.len()));
		assert_eq!(data.chunk().iter().collect::<Vec<_>>(), units);
		let mut wide = units.clone();
		wide[511] = 0xD800;
		let wide_data = LeafData::new(&wide);
		assert!(matches!(&wide_data.units, LeafUnits::Utf16(text) if text.len() == wide.len()));
		assert_eq!(wide_data.chunk().iter().collect::<Vec<_>>(), wide);
	}

	#[test]
	fn splits_share_backing_and_line_index_even_inside_crlf() {
		let units: Vec<_> = [65, CR, LF, 0xD800]
			.into_iter()
			.cycle()
			.take(1024)
			.collect();
		let original = from_units(&units);
		for offset in 1..units.len() {
			let (left, right) = split(original.clone(), offset);
			assert_invariants(&left);
			assert_invariants(&right);
			let (Some(left_node), Some(right_node)) = (&left, &right) else {
				panic!("Both split ranges contain text");
			};
			let (
				Content::Leaf {
					data: left_data, ..
				},
				Content::Leaf {
					data: right_data, ..
				},
			) = (&left_node.content, &right_node.content)
			else {
				panic!("Splitting a leaf produces leaf views");
			};
			assert!(Arc::ptr_eq(left_data, right_data));
			let original_data = Arc::clone(left_data);
			let joined = concat(left, right).unwrap();
			let Content::Leaf { data, .. } = &joined.content else {
				panic!("Adjacent shared views coalesce");
			};
			assert!(Arc::ptr_eq(data, &original_data));
		}
	}
}
