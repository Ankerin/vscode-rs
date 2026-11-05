/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Sequence alignment with the editor's existing tie-breaking and timeout contracts.

use std::{error::Error, fmt, ops::Range};

mod optimization;
pub use optimization::{OptimizationSequence, optimize_sequence_diffs};

/// Bounds the quadratic direction matrix before allocating it.
pub const MAX_DYNAMIC_DIFF_CELLS: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SequenceDiff {
	pub original: Range<usize>,
	pub modified: Range<usize>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct SequenceDiffResult {
	pub diffs: Vec<SequenceDiff>,
	pub hit_timeout: bool,
}

impl SequenceDiffResult {
	fn trivial(original_length: usize, modified_length: usize, hit_timeout: bool) -> Self {
		Self {
			diffs: vec![SequenceDiff {
				original: 0..original_length,
				modified: 0..modified_length,
			}],
			hit_timeout,
		}
	}
}

/// Exact line identities and scores computed with the existing JavaScript logarithm semantics.
pub struct LineEqualityScores<'a> {
	pub original: &'a [u32],
	pub modified: &'a [u32],
	pub scores: &'a [f64],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SequenceDiffError {
	InvalidScores,
	TooLarge,
	AllocationFailed,
	UnrepresentablePath,
	InvalidRanges,
}

impl fmt::Display for SequenceDiffError {
	fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
		formatter.write_str(match self {
			Self::InvalidScores => "Line equality scores do not match the sequences",
			Self::TooLarge => "The sequence diff exceeds its allocation budget",
			Self::AllocationFailed => "Unable to allocate the sequence diff state",
			Self::UnrepresentablePath => {
				"The sequence diff path requires the existing number semantics"
			}
			Self::InvalidRanges => "The sequence diff ranges are invalid or inconsistent",
		})
	}
}

impl Error for SequenceDiffError {}

/// Preserves diagonal and horizontal tie preference, including the consecutive-diagonal bonus.
/// Only directions occupy quadratic space; scores and run lengths use one rolling row.
pub fn dynamic_programming_diff(
	original: &[f64],
	modified: &[f64],
	line_scores: Option<LineEqualityScores<'_>>,
	mut is_valid: impl FnMut() -> bool,
) -> Result<SequenceDiffResult, SequenceDiffError> {
	if let Some(scores) = &line_scores
		&& (scores.original.len() != original.len()
			|| scores.modified.len() != modified.len()
			|| scores.scores.len() != modified.len()
			|| scores
				.scores
				.iter()
				.any(|score| !score.is_finite() || *score < 0.0))
	{
		return Err(SequenceDiffError::InvalidScores);
	}
	if original.is_empty() || modified.is_empty() {
		return Ok(SequenceDiffResult::trivial(
			original.len(),
			modified.len(),
			false,
		));
	}
	let cells = original
		.len()
		.checked_mul(modified.len())
		.filter(|&cells| cells <= MAX_DYNAMIC_DIFF_CELLS)
		.ok_or(SequenceDiffError::TooLarge)?;
	let mut directions = Vec::<u8>::new();
	directions
		.try_reserve_exact(cells)
		.map_err(|_| SequenceDiffError::AllocationFailed)?;
	directions.resize(cells, 0);
	let mut scores = vec![0.0_f64; modified.len()];
	let mut lengths = vec![0_usize; modified.len()];
	for (s1, &element1) in original.iter().enumerate() {
		let mut diagonal_score = 0.0;
		let mut diagonal_length = 0;
		let mut vertical_score = 0.0;
		for (s2, &element2) in modified.iter().enumerate() {
			if !is_valid() {
				return Ok(SequenceDiffResult::trivial(
					original.len(),
					modified.len(),
					true,
				));
			}
			let horizontal_score = scores[s2];
			let previous_length = lengths[s2];
			let extended_score = if element1 == element2 {
				let consecutive =
					s1 > 0 && s2 > 0 && directions[(s1 - 1) * modified.len() + s2 - 1] == 3;
				let equality_score = line_scores.as_ref().map_or(1.0, |weights| {
					if weights.original[s1] == weights.modified[s2] {
						weights.scores[s2]
					} else {
						0.99
					}
				});
				diagonal_score
					+ if consecutive {
						diagonal_length as f64
					} else {
						0.0
					} + equality_score
			} else {
				-1.0
			};
			let value = horizontal_score.max(vertical_score).max(extended_score);
			let index = s1 * modified.len() + s2;
			if value == extended_score {
				directions[index] = 3;
				lengths[s2] = diagonal_length + 1;
			} else {
				directions[index] = if value == horizontal_score { 1 } else { 2 };
				lengths[s2] = 0;
			}
			scores[s2] = value;
			vertical_score = value;
			diagonal_score = horizontal_score;
			diagonal_length = previous_length;
		}
	}
	let mut diffs = Vec::new();
	let (mut last1, mut last2) = (original.len(), modified.len());
	let (mut s1, mut s2) = (original.len(), modified.len());
	while s1 > 0 && s2 > 0 {
		match directions[(s1 - 1) * modified.len() + s2 - 1] {
			3 => {
				if s1 != last1 || s2 != last2 {
					diffs.push(SequenceDiff {
						original: s1..last1,
						modified: s2..last2,
					});
				}
				s1 -= 1;
				s2 -= 1;
				(last1, last2) = (s1, s2);
			}
			1 => s1 -= 1,
			_ => s2 -= 1,
		}
	}
	if last1 != 0 || last2 != 0 {
		diffs.push(SequenceDiff {
			original: 0..last1,
			modified: 0..last2,
		});
	}
	diffs.reverse();
	Ok(SequenceDiffResult {
		diffs,
		hit_timeout: false,
	})
}

const MAX_MYERS_PATHS: usize = 262_144;
const MAX_MYERS_DIAGONALS: usize = 1_048_576;

struct SnakePath {
	previous: Option<usize>,
	x: usize,
	y: usize,
	length: usize,
	valid: bool,
}

struct DiagonalSide {
	x: Vec<isize>,
	paths: Vec<Option<usize>>,
}

impl Default for DiagonalSide {
	fn default() -> Self {
		Self {
			x: vec![0; 10],
			paths: vec![None; 10],
		}
	}
}

#[derive(Default)]
struct Frontier {
	positive: DiagonalSide,
	negative: DiagonalSide,
}

impl Frontier {
	fn side(&self, diagonal: isize) -> (&DiagonalSide, usize) {
		if diagonal >= 0 {
			(&self.positive, diagonal as usize)
		} else {
			(&self.negative, diagonal.unsigned_abs() - 1)
		}
	}

	fn x(&self, diagonal: isize) -> Option<isize> {
		let (side, index) = self.side(diagonal);
		side.x.get(index).copied()
	}

	fn path(&self, diagonal: isize) -> Option<usize> {
		let (side, index) = self.side(diagonal);
		side.paths.get(index).copied().flatten()
	}

	fn set(
		&mut self,
		diagonal: isize,
		x: isize,
		path: Option<usize>,
	) -> Result<(), SequenceDiffError> {
		let (side, index) = if diagonal >= 0 {
			(&mut self.positive, diagonal as usize)
		} else {
			(&mut self.negative, diagonal.unsigned_abs() - 1)
		};
		if index >= MAX_MYERS_DIAGONALS / 2 {
			return Err(SequenceDiffError::TooLarge);
		}
		if index >= side.x.len() {
			let length = (index + 1)
				.max(side.x.len() * 2)
				.min(MAX_MYERS_DIAGONALS / 2);
			side.x
				.try_reserve_exact(length - side.x.len())
				.map_err(|_| SequenceDiffError::AllocationFailed)?;
			side.paths
				.try_reserve_exact(length - side.paths.len())
				.map_err(|_| SequenceDiffError::AllocationFailed)?;
			side.x.resize(length, 0);
			side.paths.resize(length, None);
		}
		side.x[index] = x;
		side.paths[index] = path;
		Ok(())
	}
}

/// Aligns large sequences with the existing Myers frontier and snake preference.
/// An indexed arena owns paths; allocation limits return an error instead of exhausting memory.
pub fn myers_diff(
	original: &[f64],
	modified: &[f64],
	mut is_valid: impl FnMut() -> bool,
) -> Result<SequenceDiffResult, SequenceDiffError> {
	if original.is_empty() || modified.is_empty() {
		return Ok(SequenceDiffResult::trivial(
			original.len(),
			modified.len(),
			false,
		));
	}
	let original_length =
		isize::try_from(original.len()).map_err(|_| SequenceDiffError::TooLarge)?;
	let modified_length =
		isize::try_from(modified.len()).map_err(|_| SequenceDiffError::TooLarge)?;
	let snake_end = |mut x: usize, mut y: usize| {
		while x < original.len() && y < modified.len() && original[x] == modified[y] {
			x += 1;
			y += 1;
		}
		x
	};
	let initial_end = snake_end(0, 0);
	let mut frontier = Frontier::default();
	let mut arena = Vec::<SnakePath>::new();
	if initial_end > 0 {
		arena.push(SnakePath {
			previous: None,
			x: 0,
			y: 0,
			length: initial_end,
			valid: true,
		});
	}
	frontier.set(
		0,
		initial_end as isize,
		if initial_end > 0 { Some(0) } else { None },
	)?;
	let mut distance = 0_isize;
	let final_path = 'search: loop {
		distance += 1;
		if !is_valid() {
			return Ok(SequenceDiffResult::trivial(
				original.len(),
				modified.len(),
				true,
			));
		}
		let lower = -distance.min(modified_length + distance % 2);
		let upper = distance.min(original_length + distance % 2);
		let mut diagonal = lower;
		while diagonal <= upper {
			let top = if diagonal == upper {
				Some(-1)
			} else {
				frontier.x(diagonal + 1)
			};
			let left = if diagonal == lower {
				Some(-1)
			} else {
				frontier.x(diagonal - 1).map(|x| x + 1)
			};
			// A read beyond either typed frontier is undefined in JavaScript. Math.max
			// then yields NaN, and writing that value to Int32Array stores zero.
			let Some((top, left)) = top.zip(left) else {
				if arena.len() >= MAX_MYERS_PATHS {
					return Err(SequenceDiffError::TooLarge);
				}
				arena
					.try_reserve(1)
					.map_err(|_| SequenceDiffError::AllocationFailed)?;
				arena.push(SnakePath {
					previous: frontier.path(diagonal - 1),
					x: 0,
					y: 0,
					length: 0,
					valid: false,
				});
				frontier.set(diagonal, 0, Some(arena.len() - 1))?;
				diagonal += 2;
				continue;
			};
			let x = top.max(left).min(original_length);
			let y = x - diagonal;
			if x >= 0 && y >= 0 && y <= modified_length {
				let end = snake_end(x as usize, y as usize);
				let previous = frontier.path(if x == top { diagonal + 1 } else { diagonal - 1 });
				let path = if end != x as usize {
					if arena.len() >= MAX_MYERS_PATHS {
						return Err(SequenceDiffError::TooLarge);
					}
					arena
						.try_reserve(1)
						.map_err(|_| SequenceDiffError::AllocationFailed)?;
					arena.push(SnakePath {
						previous,
						x: x as usize,
						y: y as usize,
						length: end - x as usize,
						valid: true,
					});
					Some(arena.len() - 1)
				} else {
					previous
				};
				frontier.set(diagonal, end as isize, path)?;
				if end == original.len() && end as isize - diagonal == modified_length {
					break 'search path;
				}
			}
			diagonal += 2;
		}
	};
	let mut path = final_path;
	let (mut last1, mut last2) = (original.len(), modified.len());
	let mut diffs = Vec::new();
	loop {
		let snake = path.map(|index| &arena[index]);
		if snake.is_some_and(|snake| !snake.valid) {
			return Err(SequenceDiffError::UnrepresentablePath);
		}
		let end1 = snake.map_or(0, |snake| snake.x + snake.length);
		let end2 = snake.map_or(0, |snake| snake.y + snake.length);
		if end1 != last1 || end2 != last2 {
			diffs.push(SequenceDiff {
				original: end1..last1,
				modified: end2..last2,
			});
		}
		let Some(snake) = snake else { break };
		(last1, last2) = (snake.x, snake.y);
		path = snake.previous;
	}
	diffs.reverse();
	Ok(SequenceDiffResult {
		diffs,
		hit_timeout: false,
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn sequence_diffs_reconstruct_seeded_inputs_with_javascript_number_equality() {
		let mut seed = 42_u32;
		let mut random = |limit| {
			seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
			seed as usize % limit
		};
		for _ in 0..512 {
			let alphabet = [0.0, -0.0, 1.5, f64::INFINITY, 0xD800 as f64, 0xDC00 as f64];
			let original: Vec<_> = (0..random(64))
				.map(|_| alphabet[random(alphabet.len())])
				.collect();
			let modified: Vec<_> = (0..random(64))
				.map(|_| alphabet[random(alphabet.len())])
				.collect();
			let results = [
				dynamic_programming_diff(&original, &modified, None, || true).unwrap(),
				myers_diff(&original, &modified, || true).unwrap(),
			];
			for result in results {
				let mut updated = Vec::new();
				let mut offset = 0;
				for diff in &result.diffs {
					updated.extend_from_slice(&original[offset..diff.original.start]);
					updated.extend_from_slice(&modified[diff.modified.clone()]);
					offset = diff.original.end;
				}
				updated.extend_from_slice(&original[offset..]);
				assert_eq!(updated, modified);
			}
		}
		let result = dynamic_programming_diff(&[f64::NAN], &[f64::NAN], None, || true).unwrap();
		assert_eq!(
			result.diffs,
			vec![SequenceDiff {
				original: 0..1,
				modified: 0..1
			}]
		);
	}

	#[test]
	fn timeout_checks_follow_the_original_cell_order_and_empty_input_contract() {
		let mut checks = 0;
		let result = dynamic_programming_diff(&[1.0; 4], &[1.0; 3], None, || {
			checks += 1;
			checks < 5
		})
		.unwrap();
		assert_eq!(
			(checks, result),
			(5, SequenceDiffResult::trivial(4, 3, true))
		);
		assert_eq!(
			dynamic_programming_diff(&[], &[], None, || panic!(
				"Empty inputs do not check timeouts"
			))
			.unwrap(),
			SequenceDiffResult::trivial(0, 0, false)
		);
	}

	#[test]
	fn invalid_scores_and_quadratic_budgets_are_rejected_before_computation() {
		let weights = LineEqualityScores {
			original: &[0],
			modified: &[0],
			scores: &[f64::NAN],
		};
		assert_eq!(
			dynamic_programming_diff(&[1.0], &[1.0], Some(weights), || true),
			Err(SequenceDiffError::InvalidScores)
		);
		assert_eq!(
			dynamic_programming_diff(&[1.0; 2049], &[1.0; 2049], None, || true),
			Err(SequenceDiffError::TooLarge)
		);
	}

	#[test]
	fn myers_preserves_empty_equal_and_timed_out_sequences_and_bounds_frontier_storage() {
		for length in 1..5 {
			let mut checks = 0;
			let result = myers_diff(&vec![1.0; length], &vec![1.0; length], || {
				checks += 1;
				true
			})
			.unwrap();
			assert_eq!(
				(result.diffs, checks),
				(Vec::new(), if length == 1 { 3 } else { 2 })
			);
		}
		let mut checks = 0;
		let result = myers_diff(&[1.0; 6], &[2.0; 5], || {
			checks += 1;
			checks < 5
		})
		.unwrap();
		assert_eq!(
			(checks, result),
			(5, SequenceDiffResult::trivial(6, 5, true))
		);
		let mut frontier = Frontier::default();
		assert_eq!(
			frontier.set(MAX_MYERS_DIAGONALS as isize, 0, None),
			Err(SequenceDiffError::TooLarge)
		);
		assert_eq!(frontier.positive.x.len(), 10);
	}
}
