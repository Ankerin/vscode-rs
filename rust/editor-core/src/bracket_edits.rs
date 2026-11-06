/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Composition of queued bracket-tree edits preserves the original packed two-dimensional lengths.

use std::collections::VecDeque;

const FACTOR: f64 = 67_108_864.0;

#[derive(Clone, Copy)]
struct Mapping {
	modified: bool,
	before: f64,
	after: f64,
}

/// Composes prepared length mappings and marks results that use the original merged-edit class.
pub fn combine_bracket_edits(first: &[[f64; 3]], second: &[[f64; 3]]) -> Option<Vec<[f64; 4]>> {
	if first.len().checked_add(second.len())? > 262_144 {
		return None;
	}
	let mut queue = VecDeque::new();
	queue.try_reserve_exact(first.len()).ok()?;
	for &record in first {
		queue.push_back(mapping(record)?);
	}
	for &record in second {
		mapping(record)?;
	}
	let mut result: Vec<[f64; 4]> = Vec::new();
	result.try_reserve_exact(first.len() + second.len()).ok()?;
	let mut offset = 0.0;
	for next in second
		.iter()
		.map(|&record| Some(mapping(record).expect("prevalidated mapping")))
		.chain(std::iter::once(None))
	{
		let mut remaining = next.map(|item| item.before);
		let mut before_sum = 0.0;
		while remaining != Some(0.0) {
			let item = if let Some(item) = queue.pop_front() {
				if let Some(length) = remaining {
					let rest = length_diff(length, item.after);
					if rest != 0.0 {
						queue.push_front(Mapping {
							modified: item.modified,
							before: if item.modified { 0.0 } else { rest },
							after: rest,
						});
						Mapping {
							modified: item.modified,
							before: if item.modified { item.before } else { length },
							after: length,
						}
					} else {
						item
					}
				} else {
					item
				}
			} else if let Some(length) = remaining {
				Mapping {
					modified: false,
					before: length,
					after: length,
				}
			} else {
				break;
			};
			if let Some(length) = remaining {
				remaining = Some(length_diff(item.after, length));
			}
			if next.is_some_and(|item| item.modified) {
				before_sum = length_add(before_sum, item.before);
			} else {
				let start = offset;
				offset = length_add(offset, item.before);
				if item.modified {
					push_edit(&mut result, start, offset, item.after)?;
				}
			}
		}
		if let Some(next) = next.filter(|item| item.modified) {
			let end = length_add(offset, before_sum);
			push_edit(&mut result, offset, end, next.after)?;
			offset = end;
		}
	}
	Some(result)
}

fn mapping([modified, before, after]: [f64; 3]) -> Option<Mapping> {
	if !matches!(modified, 0.0 | 1.0)
		|| [before, after].iter().any(|value| {
			!value.is_finite()
				|| *value < 0.0
				|| *value > 4_503_599_627_370_496.0
				|| value.fract() != 0.0
		}) || (modified == 0.0 && before != after)
	{
		return None;
	}
	Some(Mapping {
		modified: modified == 1.0,
		before,
		after,
	})
}

fn push_edit(result: &mut Vec<[f64; 4]>, start: f64, end: f64, length: f64) -> Option<()> {
	if let Some(last) = result.last_mut().filter(|last| last[1] == start) {
		*last = [last[0], end, length_add(last[2], length), 1.0];
	} else {
		if result.len() >= 262_144 {
			return None;
		}
		result.try_reserve(1).ok()?;
		result.push([start, end, length, 0.0]);
	}
	Some(())
}

fn length_add(first: f64, second: f64) -> f64 {
	let result = first + second;
	if second >= FACTOR {
		result - first % FACTOR
	} else {
		result
	}
}

fn length_diff(first: f64, second: f64) -> f64 {
	if second - first <= 0.0 {
		return 0.0;
	}
	let first_line = (first / FACTOR).floor();
	let second_line = (second / FACTOR).floor();
	let second_column = second - second_line * FACTOR;
	if first_line == second_line {
		second_column - (first - first_line * FACTOR)
	} else {
		(second_line - first_line) * FACTOR + second_column
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn composition_keeps_modified_splits_adjacent_joins_and_multiline_lengths() {
		assert_eq!(
			combine_bracket_edits(
				&[[0.0, 2.0, 2.0], [1.0, 3.0, 4.0]],
				&[[0.0, 3.0, 3.0], [1.0, 2.0, 1.0]]
			)
			.unwrap(),
			vec![[2.0, 5.0, 3.0, 1.0]]
		);
		assert_eq!(
			combine_bracket_edits(
				&[[1.0, FACTOR + 3.0, FACTOR + 4.0]],
				&[[1.0, FACTOR + 4.0, 2.0]]
			)
			.unwrap(),
			vec![[0.0, FACTOR + 3.0, 2.0, 0.0]]
		);
		assert!(combine_bracket_edits(&[[1.0, 0.0, f64::NAN]], &[]).is_none());
	}
}
