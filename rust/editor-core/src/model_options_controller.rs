/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Model option orchestration retains request getters, virtual updates, and event ordering.

/// Existing model/request/guess/factory capabilities remain borrowed and caught.
pub trait ModelOptionsControllerHost {
	type Value;
	type Error;
	fn undefined(&self) -> Self::Value;
	fn tab_size(&self) -> Self::Value;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn is_undefined(&self, value: &Self::Value) -> bool;
	fn assert_alive(&self) -> Result<(), Self::Error>;
	fn request(&self, index: u32) -> Result<Self::Value, Self::Error>;
	fn current(&self, index: u32) -> Result<Self::Value, Self::Error>;
	fn options(&self) -> Result<Self::Value, Self::Error>;
	fn resolve_source(&self) -> Result<Self::Value, Self::Error>;
	fn construct(&self, values: &[Self::Value; 6]) -> Result<Self::Value, Self::Error>;
	fn equal(&self, options: &Self::Value) -> Result<bool, Self::Error>;
	fn change_event(&self, options: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn assign(&self, options: &Self::Value) -> Result<(), Self::Error>;
	fn notify(&self, index: u32, event: &Self::Value) -> Result<(), Self::Error>;
	fn guess(
		&self,
		tab_size: &Self::Value,
		insert_spaces: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn guessed(&self, guess: &Self::Value, index: u32) -> Result<Self::Value, Self::Error>;
	fn update_method(&self) -> Result<Self::Value, Self::Error>;
	fn update(
		&self,
		method: &Self::Value,
		insert: &Self::Value,
		tab: &Self::Value,
		indent: &Self::Value,
	) -> Result<(), Self::Error>;
	fn format(&self, tab: &Self::Value, insert: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn normalize(
		&self,
		text: &Self::Value,
		indent: &Self::Value,
		insert: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
}

fn chosen<H: ModelOptionsControllerHost>(host: &H, index: u32) -> Result<H::Value, H::Error> {
	if host.is_undefined(&host.request(index)?) {
		host.current(index)
	} else {
		host.request(index)
	}
}

/// Applies resolved changes only after equality/event preparation, preserving partial callback state.
pub fn update_model_options<H: ModelOptionsControllerHost>(host: &H) -> Result<H::Value, H::Error> {
	host.assert_alive()?;
	let tab = chosen(host, 0)?;
	let indent = chosen(host, 1)?;
	let insert = chosen(host, 2)?;
	let trim = chosen(host, 3)?;
	let brackets = chosen(host, 4)?;
	let eol = host.current(5)?;
	let options = host.construct(&[tab, indent, insert, eol, trim, brackets])?;
	if host.equal(&options)? {
		return Ok(host.undefined());
	}
	let event = host.change_event(&options)?;
	host.assign(&options)?;
	for index in 0..3 {
		host.notify(index, &event)?;
	}
	Ok(host.undefined())
}

/// Preserves creation-time indentation detection and original constructor source identity.
pub fn resolve_model_options<H: ModelOptionsControllerHost>(
	host: &H,
) -> Result<H::Value, H::Error> {
	if !host.truthy(&host.request(6)?) {
		return host.resolve_source();
	}
	let tab = host.request(0)?;
	let insert = host.request(2)?;
	let guess = host.guess(&tab, &insert)?;
	let tab = host.guessed(&guess, 1)?;
	let indent = host.tab_size();
	let insert = host.guessed(&guess, 0)?;
	let trim = host.request(3)?;
	let eol = host.request(5)?;
	let brackets = host.request(4)?;
	host.construct(&[tab, indent, insert, eol, trim, brackets])
}

/// Returns options or formatting values with the original disposal assertion behavior.
pub fn read_model_options<H: ModelOptionsControllerHost>(
	host: &H,
	formatting: bool,
) -> Result<H::Value, H::Error> {
	if formatting {
		let indent = host.current(6)?;
		let insert = host.current(2)?;
		host.format(&indent, &insert)
	} else {
		host.assert_alive()?;
		host.options()
	}
}

/// Captures the virtual update method before observing guessed indentation fields.
pub fn detect_model_indentation<H: ModelOptionsControllerHost>(
	host: &H,
	insert: &H::Value,
	tab: &H::Value,
) -> Result<H::Value, H::Error> {
	host.assert_alive()?;
	let guess = host.guess(tab, insert)?;
	let method = host.update_method()?;
	let insert = host.guessed(&guess, 0)?;
	let tab = host.guessed(&guess, 1)?;
	let indent = host.guessed(&guess, 1)?;
	host.update(&method, &insert, &tab, &indent)?;
	Ok(host.undefined())
}

/// Uses existing native indentation kernels through original option reads.
pub fn normalize_model_indentation<H: ModelOptionsControllerHost>(
	host: &H,
	text: &H::Value,
) -> Result<H::Value, H::Error> {
	host.assert_alive()?;
	let indent = host.current(6)?;
	let insert = host.current(2)?;
	host.normalize(text, &indent, &insert)
}
