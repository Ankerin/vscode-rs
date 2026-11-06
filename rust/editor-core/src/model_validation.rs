/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Model coordinate validation preserves UTF-16 boundaries and live provider ordering.

/// Coordinate fields on existing position and range objects.
#[derive(Clone, Copy)]
pub enum ModelCoordinate {
	PositionLine,
	PositionColumn,
	StartLine,
	StartColumn,
	EndLine,
	EndColumn,
}

/// Relational operations preserve exceptional ECMAScript provider values.
#[derive(Clone, Copy)]
pub enum ModelComparison {
	Equal,
	Below,
	Above,
	AtMost,
	AtLeast,
}

/// Borrowed objects, virtual model methods, and factories retain their existing identities.
pub trait ModelValidationHost {
	type Value;
	type Error;
	fn number(&self, value: f64) -> Self::Value;
	fn copy_value(&self, value: &Self::Value) -> Self::Value;
	fn numeric(&self, value: &Self::Value) -> Option<f64>;
	fn coordinate(
		&self,
		value: &Self::Value,
		field: ModelCoordinate,
	) -> Result<Self::Value, Self::Error>;
	fn compare(
		&self,
		operation: ModelComparison,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<bool, Self::Error>;
	fn add(&self, value: &Self::Value, amount: f64) -> Result<Self::Value, Self::Error>;
	fn subtract(&self, value: &Self::Value, amount: f64) -> Result<Self::Value, Self::Error>;
	fn line_count(&self) -> Result<Self::Value, Self::Error>;
	fn max_column(&self, line: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn line_length(&self, line: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn char_code(
		&self,
		line: &Self::Value,
		index: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn assert_alive(&self) -> Result<(), Self::Error>;
	fn position_method(&self, valid: bool) -> Result<Self::Value, Self::Error>;
	fn call_is_valid_position(
		&self,
		method: &Self::Value,
		line: &Self::Value,
		column: &Self::Value,
		surrogates: bool,
	) -> Result<bool, Self::Error>;
	fn call_validate_position(
		&self,
		method: &Self::Value,
		line: &Self::Value,
		column: &Self::Value,
		surrogates: bool,
	) -> Result<Self::Value, Self::Error>;
	fn char_code_method(&self) -> Result<Self::Value, Self::Error>;
	fn call_char_code(
		&self,
		method: &Self::Value,
		line: &Self::Value,
		index: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn reusable(&self, value: &Self::Value, range: bool) -> Result<bool, Self::Error>;
	fn is_valid_position(
		&self,
		line: &Self::Value,
		column: &Self::Value,
		surrogates: bool,
	) -> Result<bool, Self::Error>;
	fn validate_position(
		&self,
		line: &Self::Value,
		column: &Self::Value,
		surrogates: bool,
	) -> Result<Self::Value, Self::Error>;
	fn is_valid_range(&self, range: &Self::Value, surrogates: bool) -> Result<bool, Self::Error>;
	fn make_position(
		&self,
		line: &Self::Value,
		column: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn make_range(
		&self,
		start_line: &Self::Value,
		start_column: &Self::Value,
		end_line: &Self::Value,
		end_column: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
}

fn normalized<H: ModelValidationHost>(host: &H, value: &H::Value) -> H::Value {
	let number = host
		.numeric(value)
		.filter(|value| !value.is_nan())
		.unwrap_or(1.0);
	host.number(number.floor())
}

fn high_surrogate<H: ModelValidationHost>(host: &H, code: &H::Value) -> Result<bool, H::Error> {
	Ok(
		host.compare(ModelComparison::AtLeast, code, &host.number(0xD800 as f64))?
			&& host.compare(ModelComparison::AtMost, code, &host.number(0xDBFF as f64))?,
	)
}

fn clamp<H: ModelValidationHost>(
	host: &H,
	mut line: H::Value,
	mut column: H::Value,
	count: &H::Value,
) -> Result<(H::Value, H::Value), H::Error> {
	if host.compare(ModelComparison::Below, &line, &host.number(1.0))? {
		line = host.number(1.0);
		column = host.number(1.0);
	} else if host.compare(ModelComparison::Above, &line, count)? {
		// Preserve the original provider's value, including its exceptional coercions.
		line = host.copy_value(count);
		column = host.max_column(&line)?;
	} else if host.compare(ModelComparison::AtMost, &column, &host.number(1.0))? {
		column = host.number(1.0);
	} else {
		let max = host.max_column(&line)?;
		if host.compare(ModelComparison::AtLeast, &column, &max)? {
			column = max;
		}
	}
	Ok((line, column))
}

/// Normalizes a range without validating surrogates or allocating a replacement for valid ranges.
pub fn validate_relaxed_model_range<H: ModelValidationHost>(
	host: &H,
	range: &H::Value,
) -> Result<H::Value, H::Error> {
	let count = host.line_count()?;
	let initial_start_line = host.coordinate(range, ModelCoordinate::StartLine)?;
	let initial_start_column = host.coordinate(range, ModelCoordinate::StartColumn)?;
	let (start_line, start_column) = clamp(
		host,
		normalized(host, &initial_start_line),
		normalized(host, &initial_start_column),
		&count,
	)?;
	let initial_end_line = host.coordinate(range, ModelCoordinate::EndLine)?;
	let initial_end_column = host.coordinate(range, ModelCoordinate::EndColumn)?;
	let (end_line, end_column) = clamp(
		host,
		normalized(host, &initial_end_line),
		normalized(host, &initial_end_column),
		&count,
	)?;
	if host.compare(ModelComparison::Equal, &initial_start_line, &start_line)?
		&& host.compare(ModelComparison::Equal, &initial_start_column, &start_column)?
		&& host.compare(ModelComparison::Equal, &initial_end_line, &end_line)?
		&& host.compare(ModelComparison::Equal, &initial_end_column, &end_column)?
		&& host.reusable(range, true)?
	{
		return Ok(host.copy_value(range));
	}
	host.make_range(&start_line, &start_column, &end_line, &end_column)
}

/// Checks positive signed-32-bit coordinates before observing the buffer.
pub fn is_valid_model_position<H: ModelValidationHost>(
	host: &H,
	line: &H::Value,
	column: &H::Value,
	surrogates: bool,
) -> Result<bool, H::Error> {
	let (Some(line_number), Some(column_number)) = (host.numeric(line), host.numeric(column))
	else {
		return Ok(false);
	};
	let integer = |value: f64| value >= 1.0 && value <= i32::MAX as f64 && value.floor() == value;
	if !integer(line_number) || !integer(column_number) {
		return Ok(false);
	}
	let count = host.line_count()?;
	if host.compare(ModelComparison::Above, line, &count)? {
		return Ok(false);
	}
	if column_number == 1.0 {
		return Ok(true);
	}
	let max = host.max_column(line)?;
	if host.compare(ModelComparison::Above, column, &max)? {
		return Ok(false);
	}
	if surrogates {
		let method = host.char_code_method()?;
		let code = host.call_char_code(&method, line, &host.subtract(column, 2.0)?)?;
		if high_surrogate(host, &code)? {
			return Ok(false);
		}
	}
	Ok(true)
}

/// Clamps normalized coordinates and moves an interior surrogate boundary left.
pub fn clamp_model_position<H: ModelValidationHost>(
	host: &H,
	line: &H::Value,
	column: &H::Value,
	surrogates: bool,
) -> Result<H::Value, H::Error> {
	let line = normalized(host, line);
	let column = normalized(host, column);
	let count = host.line_count()?;
	if host.compare(ModelComparison::Below, &line, &host.number(1.0))? {
		return host.make_position(&host.number(1.0), &host.number(1.0));
	}
	if host.compare(ModelComparison::Above, &line, &count)? {
		return host.make_position(&count, &host.max_column(&count)?);
	}
	if host.compare(ModelComparison::AtMost, &column, &host.number(1.0))? {
		return host.make_position(&line, &host.number(1.0));
	}
	let max = host.max_column(&line)?;
	if host.compare(ModelComparison::AtLeast, &column, &max)? {
		return host.make_position(&line, &max);
	}
	if surrogates {
		let method = host.char_code_method()?;
		let code = host.call_char_code(&method, &line, &host.subtract(&column, 2.0)?)?;
		if high_surrogate(host, &code)? {
			return host.make_position(&line, &host.subtract(&column, 1.0)?);
		}
	}
	host.make_position(&line, &column)
}

/// Public validation preserves the original instance shortcut and virtual helper calls.
pub fn validate_model_position<H: ModelValidationHost>(
	host: &H,
	position: &H::Value,
) -> Result<H::Value, H::Error> {
	host.assert_alive()?;
	if host.reusable(position, false)? {
		let method = host.position_method(true)?;
		let line = host.coordinate(position, ModelCoordinate::PositionLine)?;
		let column = host.coordinate(position, ModelCoordinate::PositionColumn)?;
		if host.call_is_valid_position(&method, &line, &column, true)? {
			return Ok(host.copy_value(position));
		}
	}
	let method = host.position_method(false)?;
	let line = host.coordinate(position, ModelCoordinate::PositionLine)?;
	let column = host.coordinate(position, ModelCoordinate::PositionColumn)?;
	host.call_validate_position(&method, &line, &column, true)
}

fn surrogate_edges<H: ModelValidationHost>(
	host: &H,
	start_line: &H::Value,
	start_column: &H::Value,
	end_line: &H::Value,
	end_column: &H::Value,
) -> Result<(bool, bool), H::Error> {
	let start_code = if host.compare(ModelComparison::Above, start_column, &host.number(1.0))? {
		let method = host.char_code_method()?;
		host.call_char_code(&method, start_line, &host.subtract(start_column, 2.0)?)?
	} else {
		host.number(0.0)
	};
	let end_code = if host.compare(ModelComparison::Above, end_column, &host.number(1.0))?
		&& host.compare(
			ModelComparison::AtMost,
			end_column,
			&host.line_length(end_line)?,
		)? {
		let method = host.char_code_method()?;
		host.call_char_code(&method, end_line, &host.subtract(end_column, 2.0)?)?
	} else {
		host.number(0.0)
	};
	Ok((
		high_surrogate(host, &start_code)?,
		high_surrogate(host, &end_code)?,
	))
}

/// Range validity delegates relaxed position checks before inspecting either surrogate boundary.
pub fn is_valid_model_range<H: ModelValidationHost>(
	host: &H,
	range: &H::Value,
	surrogates: bool,
) -> Result<bool, H::Error> {
	let start_line = host.coordinate(range, ModelCoordinate::StartLine)?;
	let start_column = host.coordinate(range, ModelCoordinate::StartColumn)?;
	let end_line = host.coordinate(range, ModelCoordinate::EndLine)?;
	let end_column = host.coordinate(range, ModelCoordinate::EndColumn)?;
	if !host.is_valid_position(&start_line, &start_column, false)?
		|| !host.is_valid_position(&end_line, &end_column, false)?
	{
		return Ok(false);
	}
	if surrogates {
		let (start_inside, end_inside) =
			surrogate_edges(host, &start_line, &start_column, &end_line, &end_column)?;
		return Ok(!start_inside && !end_inside);
	}
	Ok(true)
}

/// Preserves Range identity, Selection allocation, and collapsed/expanded surrogate behavior.
pub fn validate_model_range<H: ModelValidationHost>(
	host: &H,
	range: &H::Value,
) -> Result<H::Value, H::Error> {
	host.assert_alive()?;
	if host.reusable(range, true)? && host.is_valid_range(range, true)? {
		return Ok(host.copy_value(range));
	}
	let start_method = host.position_method(false)?;
	let raw_start_line = host.coordinate(range, ModelCoordinate::StartLine)?;
	let raw_start_column = host.coordinate(range, ModelCoordinate::StartColumn)?;
	let start =
		host.call_validate_position(&start_method, &raw_start_line, &raw_start_column, false)?;
	let end_method = host.position_method(false)?;
	let raw_end_line = host.coordinate(range, ModelCoordinate::EndLine)?;
	let raw_end_column = host.coordinate(range, ModelCoordinate::EndColumn)?;
	let end = host.call_validate_position(&end_method, &raw_end_line, &raw_end_column, false)?;
	let start_line = host.coordinate(&start, ModelCoordinate::PositionLine)?;
	let mut start_column = host.coordinate(&start, ModelCoordinate::PositionColumn)?;
	let end_line = host.coordinate(&end, ModelCoordinate::PositionLine)?;
	let mut end_column = host.coordinate(&end, ModelCoordinate::PositionColumn)?;
	let (start_inside, end_inside) =
		surrogate_edges(host, &start_line, &start_column, &end_line, &end_column)?;
	if start_inside || end_inside {
		if host.compare(ModelComparison::Equal, &start_line, &end_line)?
			&& host.compare(ModelComparison::Equal, &start_column, &end_column)?
		{
			start_column = host.subtract(&start_column, 1.0)?;
			end_column = host.subtract(&end_column, 1.0)?;
		} else {
			if start_inside {
				start_column = host.subtract(&start_column, 1.0)?;
			}
			if end_inside {
				end_column = host.add(&end_column, 1.0)?;
			}
		}
	}
	host.make_range(&start_line, &start_column, &end_line, &end_column)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::RefCell;

	#[derive(Clone, Debug, PartialEq)]
	enum Value {
		Number(f64),
		Position(f64, f64),
		Range([f64; 4]),
		Invalid,
	}
	struct Host {
		lines: Vec<Vec<u16>>,
		calls: RefCell<Vec<String>>,
	}
	impl Host {
		fn new() -> Self {
			Self {
				lines: vec![vec![97, 0xD800, 120], vec![], vec![0xD800]],
				calls: RefCell::new(Vec::new()),
			}
		}
		fn num(value: &Value) -> f64 {
			if let Value::Number(value) = value {
				*value
			} else {
				f64::NAN
			}
		}
	}
	impl ModelValidationHost for Host {
		type Value = Value;
		type Error = &'static str;
		fn number(&self, value: f64) -> Value {
			Value::Number(value)
		}
		fn copy_value(&self, value: &Value) -> Value {
			value.clone()
		}
		fn numeric(&self, value: &Value) -> Option<f64> {
			if let Value::Number(value) = value {
				Some(*value)
			} else {
				None
			}
		}
		fn coordinate(&self, value: &Value, field: ModelCoordinate) -> Result<Value, Self::Error> {
			self.calls
				.borrow_mut()
				.push(format!("coordinate:{}", field as u32));
			Ok(Value::Number(match (value, field) {
				(Value::Position(line, _), ModelCoordinate::PositionLine) => *line,
				(Value::Position(_, column), ModelCoordinate::PositionColumn) => *column,
				(Value::Range(values), ModelCoordinate::StartLine) => values[0],
				(Value::Range(values), ModelCoordinate::StartColumn) => values[1],
				(Value::Range(values), ModelCoordinate::EndLine) => values[2],
				(Value::Range(values), ModelCoordinate::EndColumn) => values[3],
				_ => return Err("Invalid coordinate"),
			}))
		}
		fn compare(
			&self,
			operation: ModelComparison,
			first: &Value,
			second: &Value,
		) -> Result<bool, Self::Error> {
			let (first, second) = (Self::num(first), Self::num(second));
			Ok(match operation {
				ModelComparison::Equal => first == second,
				ModelComparison::Below => first < second,
				ModelComparison::Above => first > second,
				ModelComparison::AtMost => first <= second,
				ModelComparison::AtLeast => first >= second,
			})
		}
		fn add(&self, value: &Value, amount: f64) -> Result<Value, Self::Error> {
			Ok(Value::Number(Self::num(value) + amount))
		}
		fn subtract(&self, value: &Value, amount: f64) -> Result<Value, Self::Error> {
			Ok(Value::Number(Self::num(value) - amount))
		}
		fn line_count(&self) -> Result<Value, Self::Error> {
			self.calls.borrow_mut().push("count".into());
			Ok(Value::Number(self.lines.len() as f64))
		}
		fn max_column(&self, line: &Value) -> Result<Value, Self::Error> {
			self.calls
				.borrow_mut()
				.push(format!("max:{}", Self::num(line)));
			Ok(Value::Number(
				self.lines[Self::num(line) as usize - 1].len() as f64 + 1.0,
			))
		}
		fn line_length(&self, line: &Value) -> Result<Value, Self::Error> {
			Ok(Value::Number(
				self.lines[Self::num(line) as usize - 1].len() as f64,
			))
		}
		fn char_code(&self, line: &Value, index: &Value) -> Result<Value, Self::Error> {
			Ok(Value::Number(
				self.lines[Self::num(line) as usize - 1][Self::num(index) as usize] as f64,
			))
		}
		fn assert_alive(&self) -> Result<(), Self::Error> {
			Ok(())
		}
		fn position_method(&self, valid: bool) -> Result<Value, Self::Error> {
			Ok(Value::Number(if valid { 1.0 } else { 0.0 }))
		}
		fn call_is_valid_position(
			&self,
			_method: &Value,
			line: &Value,
			column: &Value,
			surrogates: bool,
		) -> Result<bool, Self::Error> {
			self.is_valid_position(line, column, surrogates)
		}
		fn call_validate_position(
			&self,
			_method: &Value,
			line: &Value,
			column: &Value,
			surrogates: bool,
		) -> Result<Value, Self::Error> {
			self.validate_position(line, column, surrogates)
		}
		fn char_code_method(&self) -> Result<Value, Self::Error> {
			Ok(Value::Invalid)
		}
		fn call_char_code(
			&self,
			_method: &Value,
			line: &Value,
			index: &Value,
		) -> Result<Value, Self::Error> {
			self.char_code(line, index)
		}
		fn reusable(&self, value: &Value, range: bool) -> Result<bool, Self::Error> {
			Ok(if range {
				matches!(value, Value::Range(_))
			} else {
				matches!(value, Value::Position(..))
			})
		}
		fn is_valid_position(
			&self,
			line: &Value,
			column: &Value,
			surrogates: bool,
		) -> Result<bool, Self::Error> {
			is_valid_model_position(self, line, column, surrogates)
		}
		fn validate_position(
			&self,
			line: &Value,
			column: &Value,
			surrogates: bool,
		) -> Result<Value, Self::Error> {
			clamp_model_position(self, line, column, surrogates)
		}
		fn is_valid_range(&self, range: &Value, surrogates: bool) -> Result<bool, Self::Error> {
			is_valid_model_range(self, range, surrogates)
		}
		fn make_position(&self, line: &Value, column: &Value) -> Result<Value, Self::Error> {
			Ok(Value::Position(Self::num(line), Self::num(column)))
		}
		fn make_range(
			&self,
			start_line: &Value,
			start_column: &Value,
			end_line: &Value,
			end_column: &Value,
		) -> Result<Value, Self::Error> {
			Ok(Value::Range([
				Self::num(start_line),
				Self::num(start_column),
				Self::num(end_line),
				Self::num(end_column),
			]))
		}
	}

	#[test]
	fn invalid_coordinates_do_not_observe_providers() {
		let host = Host::new();
		for value in [f64::NAN, f64::INFINITY, -1.0, 0.0, 1.5, 2_147_483_648.0] {
			assert!(
				!is_valid_model_position(&host, &Value::Number(value), &Value::Number(1.0), true)
					.unwrap()
			);
		}
		assert!(
			!is_valid_model_position(&host, &Value::Invalid, &Value::Number(1.0), true).unwrap()
		);
		assert!(host.calls.borrow().is_empty());
	}

	#[test]
	fn normalizes_before_clamping_and_preserves_high_surrogate_behavior() {
		let host = Host::new();
		let cases = [
			(
				Value::Invalid,
				Value::Number(f64::NAN),
				Value::Position(1.0, 1.0),
			),
			(
				Value::Number(-1.0),
				Value::Number(99.0),
				Value::Position(1.0, 1.0),
			),
			(
				Value::Number(f64::INFINITY),
				Value::Number(1.0),
				Value::Position(3.0, 2.0),
			),
			(
				Value::Number(1.9),
				Value::Number(3.9),
				Value::Position(1.0, 2.0),
			),
			(
				Value::Number(3.0),
				Value::Number(2.0),
				Value::Position(3.0, 2.0),
			),
		];
		for (line, column, expected) in cases {
			assert_eq!(
				clamp_model_position(&host, &line, &column, true).unwrap(),
				expected
			);
		}
		assert!(
			!is_valid_model_position(&host, &Value::Number(3.0), &Value::Number(2.0), true)
				.unwrap()
		);
		assert_eq!(
			validate_model_range(&host, &Value::Range([3.0, 2.0, 3.0, 2.0])).unwrap(),
			Value::Range([3.0, 1.0, 3.0, 1.0])
		);
	}

	#[test]
	fn relaxed_range_observes_count_and_start_before_end_properties() {
		let host = Host::new();
		assert_eq!(
			validate_relaxed_model_range(&host, &Value::Range([1.9, 9.0, 99.0, 0.0])).unwrap(),
			Value::Range([1.0, 4.0, 3.0, 2.0])
		);
		assert_eq!(
			*host.calls.borrow(),
			[
				"count",
				"coordinate:2",
				"coordinate:3",
				"max:1",
				"coordinate:4",
				"coordinate:5",
				"max:3"
			]
		);
	}

	#[test]
	fn collapsed_ranges_move_left_and_noncollapsed_ranges_expand() {
		let host = Host::new();
		let cases = [
			([1.0, 3.0, 1.0, 3.0], [1.0, 2.0, 1.0, 2.0]),
			([1.0, 3.0, 1.0, 4.0], [1.0, 2.0, 1.0, 4.0]),
			([1.0, 1.0, 1.0, 3.0], [1.0, 1.0, 1.0, 4.0]),
			([1.0, 1.0, 2.0, 1.0], [1.0, 1.0, 2.0, 1.0]),
		];
		for (input, expected) in cases {
			assert_eq!(
				validate_model_range(&host, &Value::Range(input)).unwrap(),
				Value::Range(expected)
			);
		}
	}
}
