/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Search-source classification and capture copying preserve original ECMAScript observations.

/// Borrowed source capabilities preserve cached lengths, strict code comparisons, and failures.
pub trait RegexSourceHost {
	type Value;
	type Error;
	fn source_truthy(&self) -> bool;
	fn length(&self) -> Result<Self::Value, Self::Error>;
	fn is_code(&self, value: &Self::Value, code: f64) -> bool;
	fn below(&self, index: f64, length: &Self::Value) -> Result<bool, Self::Error>;
	fn at_end(&self, index: f64, length: &Self::Value) -> Result<bool, Self::Error>;
	fn char_code(&self, index: f64) -> Result<Self::Value, Self::Error>;
}

/// Classifies the original LF and escaped n/r/W cases while skipping escaped backslashes.
pub fn is_multiline_search_source<H: RegexSourceHost>(host: &H) -> Result<bool, H::Error> {
	if !host.source_truthy() || host.is_code(&host.length()?, 0.0) {
		return Ok(false);
	}
	let length = host.length()?;
	let mut index = 0.0;
	while host.below(index, &length)? {
		let code = host.char_code(index)?;
		if host.is_code(&code, 10.0) {
			return Ok(true);
		}
		if host.is_code(&code, 92.0) {
			index += 1.0;
			if host.at_end(index, &length)? {
				break;
			}
			let next = host.char_code(index)?;
			if host.is_code(&next, 110.0) || host.is_code(&next, 114.0) || host.is_code(&next, 87.0)
			{
				return Ok(true);
			}
		}
		index += 1.0;
	}
	Ok(false)
}

/// Capture arrays retain original slots and result identities, including partial writes on error.
pub trait FindMatchHost {
	type Value;
	type Error;
	fn captures(&self) -> bool;
	fn create_values(&self) -> Result<Self::Value, Self::Error>;
	fn length(&self) -> Result<Self::Value, Self::Error>;
	fn below(&self, index: f64, length: &Self::Value) -> Result<bool, Self::Error>;
	fn read(&self, index: f64) -> Result<Self::Value, Self::Error>;
	fn write(
		&self,
		values: &Self::Value,
		index: f64,
		value: &Self::Value,
	) -> Result<(), Self::Error>;
	fn make(&self, values: Option<&Self::Value>) -> Result<Self::Value, Self::Error>;
}

/// Copies the original array-like capture slots in order without coercing their values.
pub fn create_search_find_match<H: FindMatchHost>(host: &H) -> Result<H::Value, H::Error> {
	if !host.captures() {
		return host.make(None);
	}
	let values = host.create_values()?;
	let length = host.length()?;
	let mut index = 0.0;
	while host.below(index, &length)? {
		host.write(&values, index, &host.read(index)?)?;
		index += 1.0;
	}
	host.make(Some(&values))
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::RefCell;
	struct Host {
		text: Vec<u16>,
		captures: bool,
		writes: RefCell<Vec<f64>>,
		fail: bool,
	}
	impl RegexSourceHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn source_truthy(&self) -> bool {
			!self.text.is_empty()
		}
		fn length(&self) -> Result<f64, Self::Error> {
			Ok(self.text.len() as f64)
		}
		fn is_code(&self, value: &f64, code: f64) -> bool {
			*value == code
		}
		fn below(&self, index: f64, length: &f64) -> Result<bool, Self::Error> {
			Ok(index < *length)
		}
		fn at_end(&self, index: f64, length: &f64) -> Result<bool, Self::Error> {
			Ok(index >= *length)
		}
		fn char_code(&self, index: f64) -> Result<f64, Self::Error> {
			Ok(f64::from(self.text[index as usize]))
		}
	}
	impl FindMatchHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn captures(&self) -> bool {
			self.captures
		}
		fn create_values(&self) -> Result<f64, Self::Error> {
			Ok(0.0)
		}
		fn length(&self) -> Result<f64, Self::Error> {
			Ok(self.text.len() as f64)
		}
		fn below(&self, index: f64, length: &f64) -> Result<bool, Self::Error> {
			Ok(index < *length)
		}
		fn read(&self, index: f64) -> Result<f64, Self::Error> {
			if self.fail && index == 1.0 {
				return Err("slot");
			}
			Ok(f64::from(self.text[index as usize]))
		}
		fn write(&self, _: &f64, _: f64, value: &f64) -> Result<(), Self::Error> {
			self.writes.borrow_mut().push(*value);
			Ok(())
		}
		fn make(&self, values: Option<&f64>) -> Result<f64, Self::Error> {
			Ok(if values.is_some() {
				self.writes.borrow().len() as f64
			} else {
				-1.0
			})
		}
	}
	#[test]
	fn source_classification_preserves_escapes_and_actual_lf() {
		for (text, expected) in [
			("", false),
			("x", false),
			("\r", false),
			("\n", true),
			("\\n", true),
			("\\r", true),
			("\\W", true),
			("\\w", false),
			("\\\\n", false),
			("\\", false),
		] {
			let host = Host {
				text: text.encode_utf16().collect(),
				captures: false,
				writes: RefCell::new(Vec::new()),
				fail: false,
			};
			assert_eq!(is_multiline_search_source(&host), Ok(expected));
		}
	}
	#[test]
	fn capture_copy_preserves_slot_order_and_no_capture_shortcut() {
		for (captures, fail, expected, writes) in [
			(false, true, Ok(-1.0), vec![]),
			(true, false, Ok(2.0), vec![120.0, 121.0]),
			(true, true, Err("slot"), vec![120.0]),
		] {
			let host = Host {
				text: vec![120, 121],
				captures,
				writes: RefCell::new(Vec::new()),
				fail,
			};
			assert_eq!(
				(create_search_find_match(&host), host.writes.into_inner()),
				(expected, writes)
			);
		}
	}
}
