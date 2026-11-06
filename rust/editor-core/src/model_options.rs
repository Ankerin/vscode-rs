/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Resolved model options preserve original coercions, field order, equality, and change flags.

/// Borrowed source/option/event capabilities preserve existing objects and getter observations.
pub trait ModelOptionsHost {
	type Value;
	type Error;
	fn number(&self, value: f64) -> Self::Value;
	fn boolean(&self, value: bool) -> Self::Value;
	fn undefined(&self) -> Self::Value;
	fn tab_size(&self) -> Self::Value;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn is_tab_size(&self, value: &Self::Value) -> bool;
	fn source(&self, index: u32) -> Result<Self::Value, Self::Error>;
	fn get(&self, other: bool, index: u32) -> Result<Self::Value, Self::Error>;
	fn set(&self, index: u32, value: &Self::Value) -> Result<(), Self::Error>;
	fn integer(&self, value: &Self::Value, minimum: bool) -> Result<Self::Value, Self::Error>;
	fn equal(&self, first: &Self::Value, second: &Self::Value) -> bool;
	fn brackets_equal(
		&self,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<bool, Self::Error>;
	fn create_event(&self) -> Result<Self::Value, Self::Error>;
	fn event_field(
		&self,
		event: &Self::Value,
		index: u32,
		changed: bool,
	) -> Result<(), Self::Error>;
}

/// Retains ToInt32 and the minimum-one rule for tab/indent sizes.
pub fn model_option_integer(value: f64, minimum: bool) -> f64 {
	let integer = crate::ecmascript::to_uint32(value) as i32;
	if minimum {
		integer.max(1) as f64
	} else {
		integer as f64
	}
}

/// Initializes each original field in constructor order, observing indentSize twice when numeric.
pub fn initialize_model_options<H: ModelOptionsHost>(host: &H) -> Result<H::Value, H::Error> {
	let tab = host.integer(&host.source(0)?, true)?;
	host.set(0, &tab)?;
	if host.is_tab_size(&host.source(1)?) {
		host.set(1, &host.get(false, 0)?)?;
		host.set(2, &host.boolean(true))?;
	} else {
		let indent = host.integer(&host.source(1)?, true)?;
		host.set(1, &indent)?;
		host.set(2, &host.boolean(false))?;
	}
	host.set(3, &host.boolean(host.truthy(&host.source(2)?)))?;
	let eol = host.integer(&host.source(3)?, false)?;
	host.set(4, &eol)?;
	host.set(5, &host.boolean(host.truthy(&host.source(4)?)))?;
	host.set(6, &host.source(5)?)?;
	Ok(host.undefined())
}

/// Returns the historical tabSize sentinel or the resolved indent value.
pub fn original_model_indent_size<H: ModelOptionsHost>(host: &H) -> Result<H::Value, H::Error> {
	if host.truthy(&host.get(false, 2)?) {
		Ok(host.tab_size())
	} else {
		host.get(false, 1)
	}
}

/// Retains scalar short circuits before the original deep bracket-option comparison.
pub fn model_options_equal<H: ModelOptionsHost>(host: &H) -> Result<H::Value, H::Error> {
	for index in [0, 2, 1, 3, 4, 5] {
		let first = host.get(false, index)?;
		let second = host.get(true, index)?;
		if !host.equal(&first, &second) {
			return Ok(host.boolean(false));
		}
	}
	let first = host.get(false, 6)?;
	let second = host.get(true, 6)?;
	Ok(host.boolean(host.brackets_equal(&first, &second)?))
}

/// Creates the existing event shape with flags evaluated in object-literal property order.
pub fn model_options_change_event<H: ModelOptionsHost>(host: &H) -> Result<H::Value, H::Error> {
	let event = host.create_event()?;
	for (event_index, field) in [0, 1, 3, 5].into_iter().enumerate() {
		let first = host.get(false, field)?;
		let second = host.get(true, field)?;
		host.event_field(&event, event_index as u32, !host.equal(&first, &second))?;
	}
	Ok(event)
}

#[cfg(test)]
mod tests {
	use super::*;
	#[test]
	fn option_integer_retains_signed_wrap_nan_fractions_and_minimum() {
		let cases = [
			(f64::NAN, 0.0),
			(f64::INFINITY, 0.0),
			(-1.7, -1.0),
			(4.9, 4.0),
			(4_294_967_300.0, 4.0),
			(2_147_483_648.0, -2_147_483_648.0),
		];
		for (input, expected) in cases {
			assert_eq!(model_option_integer(input, false), expected);
			assert_eq!(model_option_integer(input, true), expected.max(1.0));
		}
	}
}
