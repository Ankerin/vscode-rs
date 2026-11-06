/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Model edit validation preserves annotated identity, live methods, lone-CR normalization, and flags.

/// Existing operation/text/range/array capabilities stay borrowed and caught.
pub trait ModelEditValidationHost {
	type Value;
	type Error;
	fn null(&self) -> Self::Value;
	fn boolean(&self, value: bool) -> Self::Value;
	fn number(&self, value: f64) -> Self::Value;
	fn crlf(&self) -> Self::Value;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn same(&self, first: &Self::Value, second: &Self::Value) -> bool;
	fn annotated(&self, operation: &Self::Value) -> Result<bool, Self::Error>;
	fn field(&self, operation: &Self::Value, index: u32) -> Result<Self::Value, Self::Error>;
	fn range_method(&self) -> Result<Self::Value, Self::Error>;
	fn validate_range(
		&self,
		method: &Self::Value,
		range: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn length(&self, text: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn above_zero(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn minus_one(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn char_method(&self, text: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn char_code(
		&self,
		method: &Self::Value,
		index: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn eol(&self) -> Result<Self::Value, Self::Error>;
	fn end_column(&self, range: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn max_method(&self) -> Result<Self::Value, Self::Error>;
	fn end_line(&self, range: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn max_column(
		&self,
		method: &Self::Value,
		line: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn substring_method(&self, text: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn substring(
		&self,
		method: &Self::Value,
		end: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn construct_method(&self) -> Result<Self::Value, Self::Error>;
	fn construct(
		&self,
		method: &Self::Value,
		values: &[Self::Value; 6],
	) -> Result<Self::Value, Self::Error>;
	fn result(&self) -> Result<Self::Value, Self::Error>;
	fn operation_length(&self, operations: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn less(&self, index: f64, length: &Self::Value) -> Result<bool, Self::Error>;
	fn edit_method(&self) -> Result<Self::Value, Self::Error>;
	fn operation(&self, operations: &Self::Value, index: f64) -> Result<Self::Value, Self::Error>;
	fn validate_edit(
		&self,
		method: &Self::Value,
		operation: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn write(
		&self,
		result: &Self::Value,
		index: f64,
		operation: &Self::Value,
	) -> Result<(), Self::Error>;
}

fn selected<H: ModelEditValidationHost>(
	host: &H,
	operation: &H::Value,
	index: u32,
) -> Result<H::Value, H::Error> {
	let value = host.field(operation, index)?;
	Ok(if host.truthy(&value) {
		value
	} else if index == 2 {
		host.null()
	} else {
		host.boolean(false)
	})
}

/// Validates one operation, preserving identity and every original method/getter short circuit.
pub fn validate_model_edit<H: ModelEditValidationHost>(
	host: &H,
	operation: H::Value,
) -> Result<H::Value, H::Error> {
	if host.annotated(&operation)? {
		return Ok(operation);
	}
	let method = host.range_method()?;
	let range = host.validate_range(&method, &host.field(&operation, 0)?)?;
	let mut text = host.field(&operation, 1)?;
	if host.truthy(&text) {
		let length = host.length(&text)?;
		let ends_cr = if host.above_zero(&length)? {
			let method = host.char_method(&text)?;
			let index = host.minus_one(&host.length(&text)?)?;
			host.same(&host.char_code(&method, &index)?, &host.number(13.0))
		} else {
			false
		};
		let remove = host.same(&host.eol()?, &host.crlf()) && ends_cr && {
			let column = host.end_column(&range)?;
			let method = host.max_method()?;
			let line = host.end_line(&range)?;
			host.same(&column, &host.max_column(&method, &line)?)
		};
		if remove {
			let method = host.substring_method(&text)?;
			let end = host.minus_one(&host.length(&text)?)?;
			text = host.substring(&method, &end)?;
		}
	}
	let method = host.construct_method()?;
	let identifier = selected(host, &operation, 2)?;
	let markers = selected(host, &operation, 3)?;
	let whitespace = selected(host, &operation, 4)?;
	let tracked = selected(host, &operation, 5)?;
	host.construct(
		&method,
		&[identifier, range, text, markers, whitespace, tracked],
	)
}

/// Retains initial batch length and virtual validation lookup before each input element read.
pub fn validate_model_edits<H: ModelEditValidationHost>(
	host: &H,
	operations: &H::Value,
) -> Result<H::Value, H::Error> {
	let result = host.result()?;
	let length = host.operation_length(operations)?;
	let mut index = 0.0;
	while host.less(index, &length)? {
		let method = host.edit_method()?;
		let operation = host.operation(operations, index)?;
		let operation = host.validate_edit(&method, &operation)?;
		host.write(&result, index, &operation)?;
		index += 1.0;
	}
	Ok(result)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::RefCell;

	#[derive(Default)]
	struct Host {
		annotated: bool,
		text: f64,
		eol: f64,
		end: f64,
		fail: Option<&'static str>,
		trace: RefCell<Vec<&'static str>>,
		constructed: RefCell<Vec<[f64; 6]>>,
	}
	impl Host {
		fn read(&self, name: &'static str, value: f64) -> Result<f64, &'static str> {
			self.trace.borrow_mut().push(name);
			if self.fail == Some(name) {
				Err(name)
			} else {
				Ok(value)
			}
		}
	}
	impl ModelEditValidationHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn null(&self) -> f64 {
			0.0
		}
		fn boolean(&self, value: bool) -> f64 {
			if value { 1.0 } else { 0.0 }
		}
		fn number(&self, value: f64) -> f64 {
			value
		}
		fn crlf(&self) -> f64 {
			2.0
		}
		fn truthy(&self, value: &f64) -> bool {
			*value != 0.0 && !value.is_nan()
		}
		fn same(&self, first: &f64, second: &f64) -> bool {
			first == second
		}
		fn annotated(&self, _operation: &f64) -> Result<bool, Self::Error> {
			self.read("annotated", 0.0)?;
			Ok(self.annotated)
		}
		fn field(&self, _operation: &f64, index: u32) -> Result<f64, Self::Error> {
			let names = [
				"range",
				"text",
				"identifier",
				"markers",
				"whitespace",
				"tracked",
			];
			self.read(
				names[index as usize],
				match index {
					0 => 7.0,
					1 => self.text,
					2 => 99.0,
					3 => 8.0,
					4 => 0.0,
					_ => f64::NAN,
				},
			)
		}
		fn range_method(&self) -> Result<f64, Self::Error> {
			self.read("rangeMethod", 1.0)
		}
		fn validate_range(&self, _method: &f64, range: &f64) -> Result<f64, Self::Error> {
			self.read("validateRange", *range)
		}
		fn length(&self, _text: &f64) -> Result<f64, Self::Error> {
			self.read("length", 2.0)
		}
		fn above_zero(&self, value: &f64) -> Result<bool, Self::Error> {
			Ok(*value > 0.0)
		}
		fn minus_one(&self, value: &f64) -> Result<f64, Self::Error> {
			Ok(*value - 1.0)
		}
		fn char_method(&self, _text: &f64) -> Result<f64, Self::Error> {
			self.read("charMethod", 1.0)
		}
		fn char_code(&self, _method: &f64, index: &f64) -> Result<f64, Self::Error> {
			assert_eq!(*index, 1.0);
			self.read("charCode", 13.0)
		}
		fn eol(&self) -> Result<f64, Self::Error> {
			self.read("eol", self.eol)
		}
		fn end_column(&self, _range: &f64) -> Result<f64, Self::Error> {
			self.read("endColumn", self.end)
		}
		fn max_method(&self) -> Result<f64, Self::Error> {
			self.read("maxMethod", 1.0)
		}
		fn end_line(&self, _range: &f64) -> Result<f64, Self::Error> {
			self.read("endLine", 1.0)
		}
		fn max_column(&self, _method: &f64, _line: &f64) -> Result<f64, Self::Error> {
			self.read("maxColumn", 3.0)
		}
		fn substring_method(&self, _text: &f64) -> Result<f64, Self::Error> {
			self.read("substringMethod", 1.0)
		}
		fn substring(&self, _method: &f64, end: &f64) -> Result<f64, Self::Error> {
			assert_eq!(*end, 1.0);
			self.read("substring", 42.0)
		}
		fn construct_method(&self) -> Result<f64, Self::Error> {
			self.read("constructMethod", 1.0)
		}
		fn construct(&self, _method: &f64, values: &[f64; 6]) -> Result<f64, Self::Error> {
			self.constructed.borrow_mut().push(*values);
			self.read("construct", 88.0)
		}
		fn result(&self) -> Result<f64, Self::Error> {
			self.read("result", 1.0)
		}
		fn operation_length(&self, _operations: &f64) -> Result<f64, Self::Error> {
			self.read("operationLength", 2.0)
		}
		fn less(&self, index: f64, length: &f64) -> Result<bool, Self::Error> {
			Ok(index < *length)
		}
		fn edit_method(&self) -> Result<f64, Self::Error> {
			self.read("editMethod", 1.0)
		}
		fn operation(&self, _operations: &f64, index: f64) -> Result<f64, Self::Error> {
			self.read("operation", index)
		}
		fn validate_edit(&self, _method: &f64, operation: &f64) -> Result<f64, Self::Error> {
			self.read("validateEdit", *operation)
		}
		fn write(&self, _result: &f64, _index: f64, _operation: &f64) -> Result<(), Self::Error> {
			self.read("write", 0.0).map(|_| ())
		}
	}

	#[test]
	fn annotated_identity_skips_all_validation_and_construction() {
		let host = Host {
			annotated: true,
			..Host::default()
		};
		assert_eq!(validate_model_edit(&host, 79.0), Ok(79.0));
		assert_eq!(*host.trace.borrow(), ["annotated"]);
	}
	#[test]
	fn trailing_cr_normalization_retains_lookup_order_and_raw_truthy_flags() {
		let host = Host {
			text: 9.0,
			eol: 2.0,
			end: 3.0,
			..Host::default()
		};
		assert_eq!(validate_model_edit(&host, 0.0), Ok(88.0));
		assert_eq!(
			*host.constructed.borrow(),
			[[99.0, 7.0, 42.0, 8.0, 0.0, 0.0]]
		);
		assert_eq!(
			*host.trace.borrow(),
			[
				"annotated",
				"rangeMethod",
				"range",
				"validateRange",
				"text",
				"length",
				"charMethod",
				"length",
				"charCode",
				"eol",
				"endColumn",
				"maxMethod",
				"endLine",
				"maxColumn",
				"substringMethod",
				"length",
				"substring",
				"constructMethod",
				"identifier",
				"markers",
				"whitespace",
				"tracked",
				"construct"
			]
		);
	}
	#[test]
	fn falsy_text_skips_normalization_and_failure_skips_construction() {
		let host = Host::default();
		validate_model_edit(&host, 0.0).unwrap();
		assert_eq!(
			*host.constructed.borrow(),
			[[99.0, 7.0, 0.0, 8.0, 0.0, 0.0]]
		);
		assert!(!host.trace.borrow().contains(&"eol"));
		let host = Host {
			text: 9.0,
			fail: Some("charCode"),
			..Host::default()
		};
		assert_eq!(validate_model_edit(&host, 0.0), Err("charCode"));
		assert!(!host.trace.borrow().contains(&"eol"));
		assert!(host.constructed.borrow().is_empty());
	}
	#[test]
	fn batch_captures_each_virtual_method_before_input_and_propagates_failure() {
		let host = Host::default();
		assert_eq!(validate_model_edits(&host, &0.0), Ok(1.0));
		assert_eq!(
			*host.trace.borrow(),
			[
				"result",
				"operationLength",
				"editMethod",
				"operation",
				"validateEdit",
				"write",
				"editMethod",
				"operation",
				"validateEdit",
				"write"
			]
		);
		let host = Host {
			fail: Some("operation"),
			..Host::default()
		};
		assert_eq!(validate_model_edits(&host, &0.0), Err("operation"));
		assert_eq!(
			*host.trace.borrow(),
			["result", "operationLength", "editMethod", "operation"]
		);
	}
}
