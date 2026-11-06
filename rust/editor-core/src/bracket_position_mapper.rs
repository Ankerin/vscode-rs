/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Incremental bracket edit mapping retains live caches and ordered cursor-state transitions.

/// Original mapper capabilities preserve field reads, virtual translations, and partial writes.
pub trait BracketPositionMapperHost {
	type Value;
	type Coordinate;
	type Edit;
	type Error;

	fn number(&self, value: &Self::Value) -> Option<f64>;
	fn value(&self, number: f64) -> Self::Value;
	fn add(&self, first: &Self::Value, second: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn subtract(
		&self,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn equal(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
	fn component(
		&self,
		coordinate: &Self::Coordinate,
		column: bool,
	) -> Result<Self::Value, Self::Error>;
	fn delta(&self, field: u32) -> Result<Self::Value, Self::Error>;
	fn set_delta(&self, field: u32, value: &Self::Value) -> Result<(), Self::Error>;
	fn pack(&self, line: &Self::Value, column: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn parts(&self, offset: &Self::Value) -> Result<Self::Coordinate, Self::Error>;
	fn has_next_edit(&self) -> Result<bool, Self::Error>;
	fn next_edit(&self) -> Result<Self::Edit, Self::Error>;
	fn edit_exists(&self, edit: &Self::Edit) -> Result<bool, Self::Error>;
	fn edit_coordinate(
		&self,
		edit: &Self::Edit,
		field: u32,
	) -> Result<Self::Coordinate, Self::Error>;
	fn translate_edit(&self, edit: &Self::Edit, field: u32) -> Result<Self::Value, Self::Error>;
	fn increment_edit(&self) -> Result<(), Self::Error>;
	fn less_equal(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
	fn is_null(&self, offset: &Self::Value) -> Result<bool, Self::Error>;
	fn distance(
		&self,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
}

/// Translates an original coordinate using the existing same-line column affinity.
pub fn translate_bracket_old_offset<H: BracketPositionMapperHost>(
	host: &H,
	coordinate: &H::Coordinate,
) -> Result<H::Value, H::Error> {
	let line = host.component(coordinate, false)?;
	let delta_line = host.delta(2)?;
	let same_line = equal(host, &line, &delta_line)?;
	let line = host.component(coordinate, false)?;
	let delta = host.delta(0)?;
	let line = add(host, &line, &delta)?;
	let column = host.component(coordinate, true)?;
	let column = if same_line {
		let delta = host.delta(1)?;
		add(host, &column, &delta)?
	} else {
		column
	};
	host.pack(&line, &column)
}

/// Translates a current offset without reusing reads that may invoke original accessors.
pub fn translate_bracket_current_offset<H: BracketPositionMapperHost>(
	host: &H,
	offset: &H::Value,
) -> Result<H::Value, H::Error> {
	let coordinate = host.parts(offset)?;
	let line = host.component(&coordinate, false)?;
	let delta = host.delta(0)?;
	let original_line = subtract(host, &line, &delta)?;
	let delta_line = host.delta(2)?;
	let same_line = equal(host, &original_line, &delta_line)?;
	let line = host.component(&coordinate, false)?;
	let delta = host.delta(0)?;
	let line = subtract(host, &line, &delta)?;
	let column = host.component(&coordinate, true)?;
	let column = if same_line {
		let delta = host.delta(1)?;
		subtract(host, &column, &delta)?
	} else {
		column
	};
	host.pack(&line, &column)
}

/// Advances complete edits in order, committing each state field at its original assignment site.
pub fn adjust_bracket_position_mapper<H: BracketPositionMapperHost>(
	host: &H,
	offset: &H::Value,
) -> Result<(), H::Error> {
	while host.has_next_edit()? {
		let edit = host.next_edit()?;
		let current_end = host.translate_edit(&edit, 2)?;
		if !host.less_equal(&current_end, offset)? {
			break;
		}
		host.increment_edit()?;
		let after = host.parts(&current_end)?;
		let previous_end = host.translate_edit(&edit, 1)?;
		let before = host.parts(&previous_end)?;
		let after_line = host.component(&after, false)?;
		let before_line = host.component(&before, false)?;
		let line_delta = subtract(host, &after_line, &before_line)?;
		let previous_delta = host.delta(0)?;
		let line_delta = add(host, &previous_delta, &line_delta)?;
		host.set_delta(0, &line_delta)?;
		let delta_line = host.delta(2)?;
		let end = host.edit_coordinate(&edit, 1)?;
		let before_line = host.component(&end, false)?;
		let previous_column_delta = if equal(host, &delta_line, &before_line)? {
			host.delta(1)?
		} else {
			host.value(0.0)
		};
		let after_column = host.component(&after, true)?;
		let before_column = host.component(&before, true)?;
		let column_delta = subtract(host, &after_column, &before_column)?;
		let column_delta = add(host, &previous_column_delta, &column_delta)?;
		host.set_delta(1, &column_delta)?;
		let end = host.edit_coordinate(&edit, 1)?;
		let before_line = host.component(&end, false)?;
		host.set_delta(2, &before_line)?;
	}
	Ok(())
}

/// Resolves the next change after the public method's original overridable adjustment dispatch.
pub fn distance_to_bracket_change<H: BracketPositionMapperHost>(
	host: &H,
	offset: &H::Value,
) -> Result<Option<H::Value>, H::Error> {
	let edit = host.next_edit()?;
	if !host.edit_exists(&edit)? {
		return Ok(None);
	}
	let next = host.translate_edit(&edit, 0)?;
	if host.is_null(&next)? {
		return Ok(None);
	}
	Ok(Some(host.distance(offset, &next)?))
}

fn add<H: BracketPositionMapperHost>(
	host: &H,
	first: &H::Value,
	second: &H::Value,
) -> Result<H::Value, H::Error> {
	if let (Some(first), Some(second)) = (host.number(first), host.number(second)) {
		Ok(host.value(first + second))
	} else {
		host.add(first, second)
	}
}

fn subtract<H: BracketPositionMapperHost>(
	host: &H,
	first: &H::Value,
	second: &H::Value,
) -> Result<H::Value, H::Error> {
	if let (Some(first), Some(second)) = (host.number(first), host.number(second)) {
		Ok(host.value(first - second))
	} else {
		host.subtract(first, second)
	}
}

fn equal<H: BracketPositionMapperHost>(
	host: &H,
	first: &H::Value,
	second: &H::Value,
) -> Result<bool, H::Error> {
	if let (Some(first), Some(second)) = (host.number(first), host.number(second)) {
		Ok(first == second)
	} else {
		host.equal(first, second)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::bracket_lengths::{bracket_length, bracket_length_parts, length_diff};
	use std::cell::RefCell;

	struct Host {
		index: RefCell<usize>,
		deltas: RefCell<[f64; 3]>,
		edits: Vec<[[f64; 2]; 3]>,
	}

	impl BracketPositionMapperHost for Host {
		type Value = f64;
		type Coordinate = [f64; 2];
		type Edit = usize;
		type Error = ();

		fn number(&self, value: &f64) -> Option<f64> {
			Some(*value)
		}
		fn value(&self, number: f64) -> f64 {
			number
		}
		fn add(&self, _: &f64, _: &f64) -> Result<f64, ()> {
			unreachable!("Numeric additions execute in the native mapper")
		}
		fn subtract(&self, _: &f64, _: &f64) -> Result<f64, ()> {
			unreachable!("Numeric subtractions execute in the native mapper")
		}
		fn equal(&self, _: &f64, _: &f64) -> Result<bool, ()> {
			unreachable!("Numeric comparisons execute in the native mapper")
		}
		fn component(&self, coordinate: &[f64; 2], column: bool) -> Result<f64, ()> {
			Ok(coordinate[usize::from(column)])
		}
		fn delta(&self, field: u32) -> Result<f64, ()> {
			Ok(self.deltas.borrow()[field as usize])
		}
		fn set_delta(&self, field: u32, value: &f64) -> Result<(), ()> {
			self.deltas.borrow_mut()[field as usize] = *value;
			Ok(())
		}
		fn pack(&self, line: &f64, column: &f64) -> Result<f64, ()> {
			Ok(bracket_length(0, *line, *column, 0.0, 0.0).unwrap())
		}
		fn parts(&self, offset: &f64) -> Result<[f64; 2], ()> {
			Ok(bracket_length_parts(*offset))
		}
		fn has_next_edit(&self) -> Result<bool, ()> {
			Ok(*self.index.borrow() < self.edits.len())
		}
		fn next_edit(&self) -> Result<usize, ()> {
			Ok(*self.index.borrow())
		}
		fn edit_exists(&self, edit: &usize) -> Result<bool, ()> {
			Ok(*edit < self.edits.len())
		}
		fn edit_coordinate(&self, edit: &usize, field: u32) -> Result<[f64; 2], ()> {
			Ok(self.edits[*edit][field as usize])
		}
		fn translate_edit(&self, edit: &usize, field: u32) -> Result<f64, ()> {
			translate_bracket_old_offset(self, &self.edits[*edit][field as usize])
		}
		fn increment_edit(&self) -> Result<(), ()> {
			*self.index.borrow_mut() += 1;
			Ok(())
		}
		fn less_equal(&self, first: &f64, second: &f64) -> Result<bool, ()> {
			Ok(first <= second)
		}
		fn is_null(&self, _: &f64) -> Result<bool, ()> {
			Ok(false)
		}
		fn distance(&self, first: &f64, second: &f64) -> Result<f64, ()> {
			Ok(length_diff(*first, *second))
		}
	}

	#[test]
	fn mapping_advances_multiline_edits_and_accumulates_only_same_line_columns() {
		let host = Host {
			index: RefCell::new(0),
			deltas: RefCell::new([0.0, 0.0, -1.0]),
			edits: vec![
				[[0.0, 3.0], [0.0, 5.0], [1.0, 1.0]],
				[[0.0, 7.0], [0.0, 8.0], [0.0, 9.0]],
			],
		};
		let pack = |line, column| bracket_length(0, line, column, 0.0, 0.0).unwrap();
		assert_eq!(distance_to_bracket_change(&host, &2.0), Ok(Some(1.0)));
		adjust_bracket_position_mapper(&host, &pack(1.0, 2.0)).unwrap();
		assert_eq!(
			distance_to_bracket_change(&host, &pack(1.0, 2.0)),
			Ok(Some(1.0))
		);
		adjust_bracket_position_mapper(&host, &pack(1.0, 5.0)).unwrap();
		assert_eq!(
			(
				*host.index.borrow(),
				*host.deltas.borrow(),
				translate_bracket_current_offset(&host, &pack(1.0, 6.0)),
				translate_bracket_current_offset(&host, &pack(2.0, 4.0)),
				distance_to_bracket_change(&host, &pack(1.0, 6.0)),
			),
			(2, [1.0, -3.0, 0.0], Ok(9.0), Ok(pack(1.0, 4.0)), Ok(None))
		);
	}
}
