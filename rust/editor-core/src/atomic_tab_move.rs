/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Atomic indentation movement retains the original full-tab and partial-indentation rules.

use crate::next_cursor_tab_stop;

/// Returns the previous indentation stop and current visible column, or three negative ones.
pub fn whitespace_visible_column<E>(
	length: usize,
	position: f64,
	tab_size: f64,
	mut unit: impl FnMut(usize) -> Result<u16, E>,
) -> Result<[f64; 3], E> {
	let mut visible = 0.0;
	let mut previous_position = -1.0;
	let mut previous_visible = -1.0;
	for offset in 0..length {
		if offset as f64 == position {
			return Ok([previous_position, previous_visible, visible]);
		}
		if visible % tab_size == 0.0 {
			previous_position = offset as f64;
			previous_visible = visible;
		}
		visible = match unit(offset)? {
			32 => visible + 1.0,
			9 => next_cursor_tab_stop(visible, tab_size),
			_ => return Ok([-1.0; 3]),
		};
	}
	Ok(if position == length as f64 {
		[previous_position, previous_visible, visible]
	} else {
		[-1.0; 3]
	})
}

/// Moves left, right, or nearest only when the initial whitespace contains a full stop.
pub fn atomic_tab_position<E>(
	length: usize,
	position: f64,
	tab_size: f64,
	direction: f64,
	mut unit: impl FnMut(usize) -> Result<u16, E>,
) -> Result<f64, E> {
	let [previous_position, previous_visible, visible] =
		whitespace_visible_column(length, position, tab_size, &mut unit)?;
	if visible == -1.0 {
		return Ok(-1.0);
	}
	let left = if direction == 0.0 {
		true
	} else if direction == 2.0 {
		if visible % tab_size == 0.0 {
			return Ok(position);
		}
		visible % tab_size <= tab_size / 2.0
	} else {
		// The original unset direction also takes the right-hand branch.
		false
	};
	if left && previous_position == -1.0 {
		return Ok(-1.0);
	}
	let target = if left {
		previous_visible + tab_size
	} else {
		next_cursor_tab_stop(visible, tab_size)
	};
	let mut current = if left { previous_visible } else { visible };
	let start = if left { previous_position } else { position };
	for offset in start as usize..length {
		if current == target {
			return Ok(if left {
				previous_position
			} else {
				offset as f64
			});
		}
		current = match unit(offset)? {
			32 => current + 1.0,
			9 => next_cursor_tab_stop(current, tab_size),
			_ => return Ok(-1.0),
		};
	}
	Ok(if current == target {
		if left {
			previous_position
		} else {
			length as f64
		}
	} else {
		-1.0
	})
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::convert::Infallible;

	#[test]
	fn movement_requires_complete_indentation_and_prefers_left_at_midpoints() {
		let run = |text: &str, position, direction| {
			atomic_tab_position(text.len(), position, 4.0, direction, |offset| {
				Ok::<_, Infallible>(u16::from(text.as_bytes()[offset]))
			})
			.unwrap()
		};
		assert_eq!(
			[
				run("      foo", 6.0, 0.0),
				run("        foo", 6.0, 0.0),
				run("    ", 2.0, 2.0),
				run("    ", 3.0, 2.0),
				run("\tfoo", 0.0, 1.0),
				run("", 0.0, 0.0),
				run("    ", 0.5, 1.0),
				run("    ", 1.0, f64::NAN),
			],
			[-1.0, 4.0, 0.0, 4.0, 1.0, -1.0, -1.0, 4.0]
		);
		assert!(run("", -0.0, 2.0).is_sign_negative());
	}

	#[test]
	fn movement_reads_only_the_required_prefix_and_propagates_reader_errors() {
		let mut reads = Vec::new();
		let result = atomic_tab_position(1_000_000, 2.0, 4.0, 0.0, |offset| {
			reads.push(offset);
			Ok::<_, Infallible>(32)
		})
		.unwrap();
		assert_eq!((result, reads), (0.0, vec![0, 1, 0, 1, 2, 3]));
		let mut reads = Vec::new();
		let result = atomic_tab_position(100, 2.0, 4.0, 1.0, |offset| {
			reads.push(offset);
			Err::<u16, _>(19)
		});
		assert_eq!((result, reads), (Err(19), vec![0]));
	}
}
