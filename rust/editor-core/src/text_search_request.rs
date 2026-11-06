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

/// Request fields and compatibility providers retain getter order and the original regex catch.
pub trait SearchRequestHost {
	type Value;
	type Error;
	fn null(&self) -> Self::Value;
	fn boolean(&self, value: bool) -> Self::Value;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn empty(&self, value: &Self::Value) -> bool;
	fn different(&self, first: &Self::Value, second: &Self::Value) -> bool;
	fn search_string(&self) -> Result<Self::Value, Self::Error>;
	fn is_regex(&self) -> Result<Self::Value, Self::Error>;
	fn multiline_regex(&self, source: &Self::Value) -> Result<bool, Self::Error>;
	fn newline_index(&self, source: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn nonnegative(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn create_regex(&self, multiline: bool) -> Result<Self::Value, Self::Error>;
	fn lowercase(&self, source: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn uppercase(&self, source: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn match_case(&self) -> Result<Self::Value, Self::Error>;
	fn word_separators(&self) -> Result<Self::Value, Self::Error>;
	fn word_map(&self, words: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn make_data(
		&self,
		regex: &Self::Value,
		words: &Self::Value,
		simple: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
}

/// Parses an existing request, catching only original regex-construction failures.
pub fn parse_text_search_request<H: SearchRequestHost>(host: &H) -> Result<H::Value, H::Error> {
	if host.empty(&host.search_string()?) {
		return Ok(host.null());
	}
	let multiline = if host.truthy(&host.is_regex()?) {
		host.multiline_regex(&host.search_string()?)?
	} else {
		host.nonnegative(&host.newline_index(&host.search_string()?)?)?
	};
	let Ok(regex) = host.create_regex(multiline) else {
		return Ok(host.null());
	};
	if !host.truthy(&regex) {
		return Ok(host.null());
	}
	let mut simple = host.boolean(!host.truthy(&host.is_regex()?) && !multiline);
	if host.truthy(&simple) {
		let lower = host.lowercase(&host.search_string()?)?;
		let upper = host.uppercase(&host.search_string()?)?;
		if host.different(&lower, &upper) {
			simple = host.match_case()?;
		}
	}
	let words = if host.truthy(&host.word_separators()?) {
		host.word_map(&host.word_separators()?)?
	} else {
		host.null()
	};
	let simple = if host.truthy(&simple) {
		host.search_string()?
	} else {
		host.null()
	};
	host.make_data(&regex, &words, &simple)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::RefCell;
	#[derive(Debug, PartialEq)]
	enum RequestValue {
		Null,
		Boolean(bool),
		Text(String),
		Number(f64),
	}
	struct Request {
		text: &'static str,
		regex: bool,
		match_case: bool,
		fail_source: bool,
		fail_regex: bool,
	}
	fn request_text(value: &RequestValue) -> &str {
		if let RequestValue::Text(value) = value {
			value
		} else {
			unreachable!()
		}
	}
	impl SearchRequestHost for Request {
		type Value = RequestValue;
		type Error = &'static str;
		fn null(&self) -> RequestValue {
			RequestValue::Null
		}
		fn boolean(&self, value: bool) -> RequestValue {
			RequestValue::Boolean(value)
		}
		fn truthy(&self, value: &RequestValue) -> bool {
			match value {
				RequestValue::Null => false,
				RequestValue::Boolean(value) => *value,
				RequestValue::Text(value) => !value.is_empty(),
				RequestValue::Number(value) => *value != 0.0 && !value.is_nan(),
			}
		}
		fn empty(&self, value: &RequestValue) -> bool {
			matches!(value, RequestValue::Text(value) if value.is_empty())
		}
		fn different(&self, first: &RequestValue, second: &RequestValue) -> bool {
			first != second
		}
		fn search_string(&self) -> Result<RequestValue, Self::Error> {
			if self.fail_source {
				Err("source")
			} else {
				Ok(RequestValue::Text(self.text.to_owned()))
			}
		}
		fn is_regex(&self) -> Result<RequestValue, Self::Error> {
			Ok(RequestValue::Boolean(self.regex))
		}
		fn multiline_regex(&self, source: &RequestValue) -> Result<bool, Self::Error> {
			Ok(request_text(source).contains('\n'))
		}
		fn newline_index(&self, source: &RequestValue) -> Result<RequestValue, Self::Error> {
			Ok(RequestValue::Number(
				request_text(source)
					.find('\n')
					.map_or(-1.0, |index| index as f64),
			))
		}
		fn nonnegative(&self, value: &RequestValue) -> Result<bool, Self::Error> {
			if let RequestValue::Number(value) = value {
				Ok(*value >= 0.0)
			} else {
				unreachable!()
			}
		}
		fn create_regex(&self, _: bool) -> Result<RequestValue, Self::Error> {
			if self.fail_regex {
				Err("regex")
			} else {
				Ok(RequestValue::Boolean(true))
			}
		}
		fn lowercase(&self, source: &RequestValue) -> Result<RequestValue, Self::Error> {
			Ok(RequestValue::Text(request_text(source).to_lowercase()))
		}
		fn uppercase(&self, source: &RequestValue) -> Result<RequestValue, Self::Error> {
			Ok(RequestValue::Text(request_text(source).to_uppercase()))
		}
		fn match_case(&self) -> Result<RequestValue, Self::Error> {
			Ok(RequestValue::Boolean(self.match_case))
		}
		fn word_separators(&self) -> Result<RequestValue, Self::Error> {
			Ok(RequestValue::Null)
		}
		fn word_map(&self, _: &RequestValue) -> Result<RequestValue, Self::Error> {
			unreachable!()
		}
		fn make_data(
			&self,
			regex: &RequestValue,
			words: &RequestValue,
			simple: &RequestValue,
		) -> Result<RequestValue, Self::Error> {
			assert_eq!(
				(regex, words),
				(&RequestValue::Boolean(true), &RequestValue::Null)
			);
			Ok(RequestValue::Boolean(matches!(
				simple,
				RequestValue::Text(_)
			)))
		}
	}
	#[test]
	fn request_modes_preserve_case_sensitive_literal_selection_and_multiline_rules() {
		for (text, regex, match_case, expected) in [
			("_", false, false, true),
			("Hello", false, false, false),
			("Hello", false, true, true),
			("Hello", true, true, false),
			("x\ny", false, true, false),
		] {
			let host = Request {
				text,
				regex,
				match_case,
				fail_source: false,
				fail_regex: false,
			};
			assert_eq!(
				parse_text_search_request(&host),
				Ok(RequestValue::Boolean(expected))
			);
		}
	}
	#[test]
	fn request_catches_only_regex_creation_failures_and_retains_empty_shortcut() {
		for (text, fail_source, fail_regex, expected) in [
			("", false, false, Ok(RequestValue::Null)),
			("x", false, true, Ok(RequestValue::Null)),
			("x", true, false, Err("source")),
		] {
			let host = Request {
				text,
				regex: false,
				match_case: false,
				fail_source,
				fail_regex,
			};
			assert_eq!(parse_text_search_request(&host), expected);
		}
	}
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
