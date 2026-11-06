/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Decoration endpoints preserve the historical two-marker editing semantics.

enum MarkerMove {
	Defined,
	ForceMove,
	ForceStay,
}

fn before(marker: f64, sticks_before: bool, check: f64, movement: &MarkerMove) -> bool {
	if marker < check {
		return true;
	}
	if marker > check {
		return false;
	}
	match movement {
		MarkerMove::ForceMove => false,
		MarkerMove::ForceStay => true,
		MarkerMove::Defined => sticks_before,
	}
}

/// Adjusts a decoration's endpoints without changing its metadata, range cache, or tree links.
pub fn decoration_accept_edit(
	metadata: u32,
	node_start: f64,
	node_end: f64,
	start: f64,
	end: f64,
	text_length: f64,
	force_move: bool,
) -> [f64; 2] {
	let stickiness = (metadata & 24) >> 3;
	let start_sticks = stickiness == 0 || stickiness == 2;
	let end_sticks = stickiness == 1 || stickiness == 2;
	let deleting = end - start;
	let common = if deleting.is_nan() || text_length.is_nan() {
		f64::NAN
	} else {
		deleting.min(text_length)
	};
	let mut result = [node_start, node_end];
	let mut done = [false; 2];
	if start <= node_start && node_end <= end && metadata & 32 != 0 {
		result = [start; 2];
		done = [true; 2];
	}
	let movement = if force_move {
		MarkerMove::ForceMove
	} else if deleting > 0.0 {
		MarkerMove::ForceStay
	} else {
		MarkerMove::Defined
	};
	let markers = [(node_start, start_sticks), (node_end, end_sticks)];
	for (index, &(marker, sticks)) in markers.iter().enumerate() {
		if !done[index] && before(marker, sticks, start, &movement) {
			done[index] = true;
		}
	}
	if common > 0.0 && !force_move {
		let movement = if deleting > text_length {
			MarkerMove::ForceStay
		} else {
			MarkerMove::Defined
		};
		for (index, &(marker, sticks)) in markers.iter().enumerate() {
			if !done[index] && before(marker, sticks, start + common, &movement) {
				done[index] = true;
			}
		}
	}
	let movement = if force_move {
		MarkerMove::ForceMove
	} else {
		MarkerMove::Defined
	};
	for (index, &(marker, sticks)) in markers.iter().enumerate() {
		if !done[index] && before(marker, sticks, end, &movement) {
			result[index] = start + text_length;
			done[index] = true;
		}
	}
	let delta = text_length - deleting;
	for (index, &(marker, _)) in markers.iter().enumerate() {
		if !done[index] {
			let shifted = marker + delta;
			result[index] = if shifted.is_nan() || shifted > 0.0 {
				shifted
			} else {
				0.0
			};
		}
	}
	if result[0] > result[1] {
		result[1] = result[0];
	}
	result
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn editing_keeps_edge_affinities_forced_moves_and_collapsed_replacements() {
		assert_eq!(
			[
				decoration_accept_edit(0, 4.0, 8.0, 4.0, 4.0, 2.0, false),
				decoration_accept_edit(8, 4.0, 8.0, 4.0, 4.0, 2.0, false),
				decoration_accept_edit(0, 4.0, 8.0, 4.0, 8.0, 2.0, true),
				decoration_accept_edit(32, 4.0, 8.0, 3.0, 9.0, 2.0, true),
			],
			[[4.0, 10.0], [6.0, 10.0], [6.0, 6.0], [3.0, 3.0]]
		);
		let collapsed = decoration_accept_edit(32, 0.0, 0.0, -0.0, 0.0, 1.0, false);
		assert!(collapsed.iter().all(|value| value.is_sign_negative()));
	}
}
