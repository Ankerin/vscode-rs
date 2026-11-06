/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Model reads retain original virtual providers and their evaluation order.

use crate::{ModelComparison, ModelCoordinate};

/// Retains Math.min(length, Math.max(0, offset)), including NaN and signed zero.
pub fn bound_model_offset(length: f64, offset: f64) -> f64 {
	if length.is_nan() || offset.is_nan() {
		return f64::NAN;
	}
	let offset = if offset > 0.0 { offset } else { 0.0 };
	if length < offset || (length == 0.0 && length.is_sign_negative()) {
		length
	} else {
		offset
	}
}

/// Public model read entry points.
#[derive(Clone, Copy)]
pub enum ModelQueryOperation {
	Offset,
	Position,
	Value,
	ValueLength,
	RangeValue,
	RangeLength,
	CharacterCount,
	LineCount,
	LineContent,
	LineLength,
	Lines,
	Eol,
	EndSequence,
	MinColumn,
	MaxColumn,
	FirstNonWhitespace,
	LastNonWhitespace,
	ModifyPosition,
	FullRange,
	DominatedByLongLines,
	Snapshot,
	Version,
	AlternativeVersion,
	InitialSnapshot,
	Rtl,
	UnusualTerminators,
	NonBasicAscii,
}

/// Captured providers retain their original receiver, method, and call arity.
#[derive(Clone, Copy)]
pub enum ModelQueryMethod {
	FullRange,
	ValueRange,
	LengthRange,
	LineCount,
	Offset,
	Position,
	ValidateRange,
	ValidatePosition,
	TooLargeHeap,
	TooLargeTokens,
	MaxColumn,
	BufferLength,
	BufferOffset,
	BufferPosition,
	BufferBom,
	BufferValueRange,
	BufferLengthRange,
	BufferCharacterCount,
	BufferLineCount,
	BufferLineContent,
	BufferLineLength,
	BufferLines,
	BufferEol,
	BufferFirstWhitespace,
	BufferLastWhitespace,
	BufferSnapshot,
	BufferRtl,
	BufferUnusualTerminators,
	BufferNonBasicAscii,
}

/// Caught capabilities expose borrowed text, existing factories, and live model state.
pub trait ModelQueryHost {
	type Value;
	type Error;
	fn number(&self, value: f64) -> Self::Value;
	fn boolean(&self, value: bool) -> Self::Value;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn line_feed(&self, value: &Self::Value) -> bool;
	fn assert_alive(&self) -> Result<(), Self::Error>;
	fn fail(&self, heap: bool) -> Result<Self::Value, Self::Error>;
	fn method(&self, method: ModelQueryMethod) -> Result<Self::Value, Self::Error>;
	fn call0(&self, method: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn call1(&self, method: &Self::Value, first: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn call2(
		&self,
		method: &Self::Value,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn call3(
		&self,
		method: &Self::Value,
		first: &Self::Value,
		second: &Self::Value,
		third: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
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
	fn add(&self, first: &Self::Value, second: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn bound_offset(
		&self,
		length: &Self::Value,
		offset: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn length(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn state(&self, index: u32) -> Result<Self::Value, Self::Error>;
	fn snapshot(&self, source: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn range(
		&self,
		count: &Self::Value,
		max_column: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
}

fn call0<H: ModelQueryHost>(host: &H, method: ModelQueryMethod) -> Result<H::Value, H::Error> {
	host.call0(&host.method(method)?)
}

fn call1<H: ModelQueryHost>(
	host: &H,
	method: ModelQueryMethod,
	first: &H::Value,
) -> Result<H::Value, H::Error> {
	host.call1(&host.method(method)?, first)
}

fn checked_line<H: ModelQueryHost>(
	host: &H,
	line: &H::Value,
	method: ModelQueryMethod,
	max_column: bool,
) -> Result<H::Value, H::Error> {
	if host.compare(ModelComparison::Below, line, &host.number(1.0))?
		|| host.compare(
			ModelComparison::Above,
			line,
			&call0(host, ModelQueryMethod::LineCount)?,
		)? {
		return host.fail(false);
	}
	let result = call1(host, method, line)?;
	if max_column {
		host.add(&result, &host.number(1.0))
	} else {
		Ok(result)
	}
}

fn offset<H: ModelQueryHost>(host: &H, raw: &H::Value) -> Result<H::Value, H::Error> {
	let validate = host.method(ModelQueryMethod::ValidatePosition)?;
	let line = host.coordinate(raw, ModelCoordinate::PositionLine)?;
	let column = host.coordinate(raw, ModelCoordinate::PositionColumn)?;
	let position = host.call3(&validate, &line, &column, &host.number(0.0))?;
	let buffer_offset = host.method(ModelQueryMethod::BufferOffset)?;
	let line = host.coordinate(&position, ModelCoordinate::PositionLine)?;
	let column = host.coordinate(&position, ModelCoordinate::PositionColumn)?;
	host.call2(&buffer_offset, &line, &column)
}

/// Executes complete model read control without copying text or replacing public objects.
pub fn query_model<H: ModelQueryHost>(
	host: &H,
	operation: ModelQueryOperation,
	first: &H::Value,
	second: &H::Value,
	preserve_bom: bool,
) -> Result<H::Value, H::Error> {
	use ModelQueryMethod as M;
	use ModelQueryOperation as Q;
	if !matches!(
		operation,
		Q::Snapshot | Q::Rtl | Q::UnusualTerminators | Q::NonBasicAscii
	) {
		host.assert_alive()?;
	}
	match operation {
		Q::Offset => offset(host, first),
		Q::Position => {
			let length = call0(host, M::BufferLength)?;
			let offset = host.bound_offset(&length, first)?;
			call1(host, M::BufferPosition, &offset)
		}
		Q::Value | Q::ValueLength => {
			let length = matches!(operation, Q::ValueLength);
			if !length && host.truthy(&call0(host, M::TooLargeHeap)?) {
				return host.fail(true);
			}
			let range = call0(host, M::FullRange)?;
			let method = host.method(if length {
				M::LengthRange
			} else {
				M::ValueRange
			})?;
			let value = host.call2(&method, &range, first)?;
			if preserve_bom {
				let bom = call0(host, M::BufferBom)?;
				let prefix = if length { host.length(&bom)? } else { bom };
				host.add(&prefix, &value)
			} else {
				Ok(value)
			}
		}
		Q::RangeValue | Q::RangeLength | Q::CharacterCount => {
			let method = host.method(match operation {
				Q::RangeValue => M::BufferValueRange,
				Q::RangeLength => M::BufferLengthRange,
				_ => M::BufferCharacterCount,
			})?;
			let range = call1(host, M::ValidateRange, first)?;
			host.call2(&method, &range, second)
		}
		Q::LineCount => call0(host, M::BufferLineCount),
		Q::LineContent => checked_line(host, first, M::BufferLineContent, false),
		Q::LineLength => checked_line(host, first, M::BufferLineLength, false),
		Q::MaxColumn => checked_line(host, first, M::BufferLineLength, true),
		Q::FirstNonWhitespace => checked_line(host, first, M::BufferFirstWhitespace, false),
		Q::LastNonWhitespace => checked_line(host, first, M::BufferLastWhitespace, false),
		Q::Lines => {
			if host.truthy(&call0(host, M::TooLargeHeap)?) {
				return host.fail(true);
			}
			call0(host, M::BufferLines)
		}
		Q::Eol => call0(host, M::BufferEol),
		Q::EndSequence => {
			let eol = call0(host, M::BufferEol)?;
			Ok(host.number(if host.line_feed(&eol) { 0.0 } else { 1.0 }))
		}
		Q::MinColumn => Ok(host.number(1.0)),
		Q::ModifyPosition => {
			let candidate = host.add(&call1(host, M::Offset, first)?, second)?;
			// Capture getPositionAt before evaluating its inline buffer/math argument.
			let method = host.method(M::Position)?;
			let length = call0(host, M::BufferLength)?;
			let offset = host.bound_offset(&length, &candidate)?;
			host.call1(&method, &offset)
		}
		Q::FullRange => {
			let count = call0(host, M::LineCount)?;
			let max = call1(host, M::MaxColumn, &count)?;
			host.range(&count, &max)
		}
		Q::DominatedByLongLines => {
			if host.truthy(&call0(host, M::TooLargeTokens)?) {
				return Ok(host.boolean(false));
			}
			let mut small = host.number(0.0);
			let mut long = host.number(0.0);
			let count = call0(host, M::BufferLineCount)?;
			let mut line = 1.0;
			while host.compare(ModelComparison::AtMost, &host.number(line), &count)? {
				let length = call1(host, M::BufferLineLength, &host.number(line))?;
				if host.compare(ModelComparison::AtLeast, &length, &host.number(10_000.0))? {
					long = host.add(&long, &length)?;
				} else {
					small = host.add(&small, &length)?;
				}
				line += 1.0;
			}
			Ok(host.boolean(host.compare(ModelComparison::Above, &long, &small)?))
		}
		Q::Snapshot => {
			let source = call1(host, M::BufferSnapshot, first)?;
			host.snapshot(&source)
		}
		Q::Version => host.state(0),
		Q::AlternativeVersion => host.state(1),
		Q::InitialSnapshot => host.state(2),
		Q::Rtl => call0(host, M::BufferRtl),
		Q::UnusualTerminators => call0(host, M::BufferUnusualTerminators),
		Q::NonBasicAscii => call0(host, M::BufferNonBasicAscii),
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::RefCell;

	#[derive(Default)]
	struct Host {
		calls: RefCell<Vec<String>>,
	}
	impl ModelQueryHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn number(&self, value: f64) -> f64 {
			value
		}
		fn boolean(&self, value: bool) -> f64 {
			if value { 1.0 } else { 0.0 }
		}
		fn truthy(&self, value: &f64) -> bool {
			*value != 0.0 && !value.is_nan()
		}
		fn line_feed(&self, value: &f64) -> bool {
			*value == 0.0
		}
		fn assert_alive(&self) -> Result<(), Self::Error> {
			self.calls.borrow_mut().push("assert".into());
			Ok(())
		}
		fn fail(&self, heap: bool) -> Result<f64, Self::Error> {
			Err(if heap { "heap" } else { "line" })
		}
		fn method(&self, method: ModelQueryMethod) -> Result<f64, Self::Error> {
			self.calls
				.borrow_mut()
				.push(format!("method:{}", method as u32));
			Ok(method as u32 as f64)
		}
		fn call0(&self, method: &f64) -> Result<f64, Self::Error> {
			self.calls.borrow_mut().push(format!("call0:{method}"));
			Ok(
				if *method == ModelQueryMethod::TooLargeHeap as u32 as f64
					|| *method == ModelQueryMethod::TooLargeTokens as u32 as f64
				{
					0.0
				} else {
					3.0
				},
			)
		}
		fn call1(&self, method: &f64, first: &f64) -> Result<f64, Self::Error> {
			self.calls
				.borrow_mut()
				.push(format!("call1:{method}:{first}"));
			Ok(
				if *method == ModelQueryMethod::BufferLineLength as u32 as f64 && *first == 1.0 {
					10_000.0
				} else {
					*first
				},
			)
		}
		fn call2(&self, method: &f64, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			self.calls
				.borrow_mut()
				.push(format!("call2:{method}:{first}:{second}"));
			Ok(first + second)
		}
		fn call3(
			&self,
			method: &f64,
			first: &f64,
			second: &f64,
			third: &f64,
		) -> Result<f64, Self::Error> {
			self.calls
				.borrow_mut()
				.push(format!("call3:{method}:{first}:{second}:{third}"));
			Ok(first + second)
		}
		fn coordinate(&self, _value: &f64, field: ModelCoordinate) -> Result<f64, Self::Error> {
			self.calls
				.borrow_mut()
				.push(format!("coordinate:{}", field as u32));
			Ok(field as u32 as f64 + 1.0)
		}
		fn compare(
			&self,
			operation: ModelComparison,
			first: &f64,
			second: &f64,
		) -> Result<bool, Self::Error> {
			Ok(match operation {
				ModelComparison::Equal => first == second,
				ModelComparison::Below => first < second,
				ModelComparison::Above => first > second,
				ModelComparison::AtMost => first <= second,
				ModelComparison::AtLeast => first >= second,
			})
		}
		fn add(&self, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			Ok(first + second)
		}
		fn bound_offset(&self, length: &f64, offset: &f64) -> Result<f64, Self::Error> {
			Ok(bound_model_offset(*length, *offset))
		}
		fn length(&self, value: &f64) -> Result<f64, Self::Error> {
			Ok(*value)
		}
		fn state(&self, index: u32) -> Result<f64, Self::Error> {
			Ok(index as f64)
		}
		fn snapshot(&self, source: &f64) -> Result<f64, Self::Error> {
			Ok(*source)
		}
		fn range(&self, count: &f64, max: &f64) -> Result<f64, Self::Error> {
			Ok(count + max)
		}
	}

	#[test]
	fn offset_queries_capture_methods_before_coordinate_arguments() {
		let host = Host::default();
		assert_eq!(
			query_model(&host, ModelQueryOperation::Offset, &0.0, &0.0, false).unwrap(),
			3.0
		);
		assert_eq!(
			*host.calls.borrow(),
			[
				"assert",
				"method:7",
				"coordinate:0",
				"coordinate:1",
				"call3:7:1:2:0",
				"method:12",
				"coordinate:0",
				"coordinate:1",
				"call2:12:1:2"
			]
		);
	}

	#[test]
	fn range_queries_capture_buffer_before_virtual_validation() {
		let host = Host::default();
		assert_eq!(
			query_model(&host, ModelQueryOperation::RangeValue, &1.0, &2.0, false).unwrap(),
			3.0
		);
		assert_eq!(
			*host.calls.borrow(),
			[
				"assert",
				"method:15",
				"method:6",
				"call1:6:1",
				"call2:15:1:2"
			]
		);
	}

	#[test]
	fn line_queries_short_circuit_invalid_bounds_and_accumulate_long_lines() {
		let host = Host::default();
		assert_eq!(
			query_model(&host, ModelQueryOperation::LineContent, &0.0, &0.0, false),
			Err("line")
		);
		assert_eq!(*host.calls.borrow(), ["assert"]);
		assert_eq!(
			query_model(
				&host,
				ModelQueryOperation::DominatedByLongLines,
				&0.0,
				&0.0,
				false
			)
			.unwrap(),
			1.0
		);
	}

	#[test]
	fn offset_bounds_preserve_nan_infinity_and_signed_zero() {
		assert!(bound_model_offset(8.0, f64::NAN).is_nan());
		assert!(bound_model_offset(f64::NAN, 1.0).is_nan());
		let cases: [(f64, f64, f64); 6] = [
			(8.0, -1.0, 0.0),
			(8.0, -0.0, 0.0),
			(-0.0, 1.0, -0.0),
			(8.0, 2.5, 2.5),
			(8.0, f64::INFINITY, 8.0),
			(8.0, f64::NEG_INFINITY, 0.0),
		];
		for (length, offset, expected) in cases {
			assert_eq!(
				bound_model_offset(length, offset).to_bits(),
				expected.to_bits()
			);
		}
	}
}
