/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Bracket-tree construction retains the original ordered in-place grouping of equal-height nodes.

/// One original list construction; intermediate groups replace an input slot and the final group returns.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BracketTreeGroup {
	pub target: Option<usize>,
	pub first: usize,
	pub second: usize,
	pub third: Option<usize>,
}

/// Constructs a complete equal-height tree through the existing node factory without a second node index.
pub fn concat_bracket_trees_same_height<N, E, F>(
	length: usize,
	mut create: F,
) -> Result<Option<N>, E>
where
	F: FnMut(BracketTreeGroup) -> Result<N, E>,
{
	if !(2..=262_144).contains(&length) {
		return Ok(None);
	}
	let mut length = length;
	while length > 3 {
		let next_length = length >> 1;
		for index in 0..next_length {
			let first = index << 1;
			create(BracketTreeGroup {
				target: Some(index),
				first,
				second: first + 1,
				third: (first + 3 == length).then_some(first + 2),
			})?;
		}
		length = next_length;
	}
	create(BracketTreeGroup {
		target: None,
		first: 0,
		second: 1,
		third: (length >= 3).then_some(2),
	})
	.map(Some)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn construction_keeps_group_order_odd_tail_and_callback_failures() {
		let mut groups = Vec::new();
		let result = concat_bracket_trees_same_height(7, |group| {
			groups.push(group);
			Ok::<_, ()>(group.target)
		})
		.unwrap();
		assert_eq!(result, Some(None));
		assert_eq!(
			groups,
			vec![
				BracketTreeGroup {
					target: Some(0),
					first: 0,
					second: 1,
					third: None
				},
				BracketTreeGroup {
					target: Some(1),
					first: 2,
					second: 3,
					third: None
				},
				BracketTreeGroup {
					target: Some(2),
					first: 4,
					second: 5,
					third: Some(6)
				},
				BracketTreeGroup {
					target: None,
					first: 0,
					second: 1,
					third: Some(2)
				},
			]
		);
		let mut calls = 0;
		assert_eq!(
			concat_bracket_trees_same_height(8, |_| {
				calls += 1;
				if calls == 2 {
					Err("factory failure")
				} else {
					Ok(())
				}
			}),
			Err("factory failure")
		);
		assert_eq!(calls, 2);
		assert_eq!(
			concat_bracket_trees_same_height(262_145, |_| Ok::<_, ()>(())),
			Ok(None)
		);
	}
}
