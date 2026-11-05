/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use std::sync::Arc;

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
enum Content {
	Leaf {
		units: Arc<[u16]>,
		start: usize,
		end: usize,
		line_ends: Box<[u16]>,
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
	fn leaf(units: Arc<[u16]>, start: usize, end: usize) -> Arc<Self> {
		let content = &units[start..end];
		let mut line_ends = Vec::new();
		let mut offset = 0;
		while offset < content.len() {
			let unit = content[offset];
			offset += 1;
			if unit == CR || unit == LF {
				if unit == CR && content.get(offset) == Some(&LF) {
					offset += 1;
				}
				line_ends.push(offset as u16);
			}
		}
		Arc::new(Self {
			summary: Summary {
				length: content.len(),
				line_breaks: line_ends.len(),
				first: content.first().copied(),
				last: content.last().copied(),
			},
			content: Content::Leaf {
				units,
				start,
				end,
				line_ends: line_ends.into_boxed_slice(),
			},
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
			Content::Leaf { units, start, .. } => Some(units[start + offset]),
			Content::Branch { left, right } => {
				if offset < left.summary.length {
					left.char_at(offset)
				} else {
					right.char_at(offset - left.summary.length)
				}
			}
		}
	}

	pub fn chunk_at(&self, offset: usize) -> &[u16] {
		match &self.content {
			Content::Leaf {
				units, start, end, ..
			} => &units[start + offset..*end],
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
			Content::Leaf {
				units,
				start,
				line_ends,
				..
			} => {
				let content = &units[*start..start + length];
				Summary {
					length,
					line_breaks: line_ends.partition_point(|&end| usize::from(end) <= length)
						+ usize::from(
							content.last() == Some(&CR) && units.get(start + length) == Some(&LF),
						),
					first: content.first().copied(),
					last: content.last().copied(),
				}
			}
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
			Content::Leaf { line_ends, .. } => usize::from(line_ends[ordinal - 1]),
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
				units, start: base, ..
			} => {
				output.extend_from_slice(&units[base + start..base + end]);
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
		.map(|chunk| Node::leaf(Arc::from(chunk), 0, chunk.len()))
		.collect();
	fn build(leaves: &[Arc<Node>]) -> Tree {
		match leaves.len() {
			0 => None,
			1 => Some(Arc::clone(&leaves[0])),
			length => concat(build(&leaves[..length / 2]), build(&leaves[length / 2..])),
		}
	}
	build(&leaves)
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
			units: left_units,
			start: left_start,
			end: left_end,
			..
		},
		Content::Leaf {
			units: right_units,
			start: right_start,
			end: right_end,
			..
		},
	) = (&left.content, &right.content)
		&& left.summary.length + right.summary.length <= LEAF_CAPACITY
	{
		let mut units = Vec::with_capacity(left.summary.length + right.summary.length);
		units.extend_from_slice(&left_units[*left_start..*left_end]);
		units.extend_from_slice(&right_units[*right_start..*right_end]);
		let length = units.len();
		return Some(Node::leaf(Arc::from(units), 0, length));
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
			units, start, end, ..
		} => (
			Some(Node::leaf(Arc::clone(units), *start, start + offset)),
			Some(Node::leaf(Arc::clone(units), start + offset, *end)),
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

#[cfg(test)]
pub(crate) fn assert_invariants(tree: &Tree) -> (u32, Summary) {
	let Some(node) = tree else {
		return (0, Summary::default());
	};
	let (height, summary) = match &node.content {
		Content::Leaf {
			units, start, end, ..
		} => {
			assert!(*start < *end && end - start <= LEAF_CAPACITY);
			(1, Summary::from_units(&units[*start..*end]))
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
