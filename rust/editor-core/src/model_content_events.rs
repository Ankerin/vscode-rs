/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Deferred content events retain nesting, merge order, selection assignment, and reentrancy.

/// Complete content emitter entry points.
#[derive(Clone, Copy)]
pub enum ModelContentEventsOperation {
	HasListeners,
	Begin,
	End,
	Fire,
}

/// Live fields and original event/selection/merge capabilities stay borrowed and caught.
pub trait ModelContentEventsHost {
	type Value;
	type Error;
	fn null(&self) -> Self::Value;
	fn undefined(&self) -> Self::Value;
	fn number(&self, value: f64) -> Self::Value;
	fn numeric(&self, value: &Self::Value) -> Option<f64>;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn is_null(&self, value: &Self::Value) -> bool;
	fn get(&self, index: u32) -> Result<Self::Value, Self::Error>;
	fn set(&self, index: u32, value: &Self::Value) -> Result<(), Self::Error>;
	fn increment(&self, value: &Self::Value, increase: bool) -> Result<Self::Value, Self::Error>;
	fn above_zero(&self, value: &Self::Value) -> Result<bool, Self::Error>;
	fn has_listeners(&self) -> Result<Self::Value, Self::Error>;
	fn assign_selection(
		&self,
		event: &Self::Value,
		selection: &Self::Value,
	) -> Result<(), Self::Error>;
	fn merge(
		&self,
		previous: &Self::Value,
		current: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn fire(&self, event: &Self::Value) -> Result<(), Self::Error>;
}

fn change_count<H: ModelContentEventsHost>(host: &H, increase: bool) -> Result<(), H::Error> {
	let value = host.get(0)?;
	let value = if let Some(value) = host.numeric(&value) {
		host.number(value + if increase { 1.0 } else { -1.0 })
	} else {
		host.increment(&value, increase)?
	};
	host.set(0, &value)
}

/// Executes complete content-emitter control, preserving repeated field observations and failures.
pub fn run_model_content_events<H: ModelContentEventsHost>(
	host: &H,
	operation: ModelContentEventsOperation,
	input: &H::Value,
) -> Result<H::Value, H::Error> {
	use ModelContentEventsOperation as O;
	match operation {
		O::HasListeners => return host.has_listeners(),
		O::Begin => change_count(host, true)?,
		O::End => {
			change_count(host, false)?;
			if host.numeric(&host.get(0)?) == Some(0.0) && !host.is_null(&host.get(1)?) {
				host.assign_selection(&host.get(1)?, input)?;
				let event = host.get(1)?;
				host.set(1, &host.null())?;
				host.fire(&event)?;
			}
		}
		O::Fire => {
			let count = host.get(0)?;
			let deferred = if let Some(count) = host.numeric(&count) {
				count > 0.0
			} else {
				host.above_zero(&count)?
			};
			if deferred {
				let event = if host.truthy(&host.get(1)?) {
					host.merge(&host.get(1)?, input)?
				} else {
					// The input is borrowed: no clone bound or duplicate event representation is needed.
					host.set(1, input)?;
					return Ok(host.undefined());
				};
				host.set(1, &event)?;
			} else {
				host.fire(input)?;
			}
		}
	}
	Ok(host.undefined())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::RefCell;
	#[derive(Default)]
	struct Host {
		fields: RefCell<[f64; 2]>,
		selection: RefCell<f64>,
		fired: RefCell<Vec<[f64; 3]>>,
		failure: Option<&'static str>,
	}
	impl ModelContentEventsHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn null(&self) -> f64 {
			0.0
		}
		fn undefined(&self) -> f64 {
			f64::NAN
		}
		fn number(&self, value: f64) -> f64 {
			value
		}
		fn numeric(&self, value: &f64) -> Option<f64> {
			Some(*value)
		}
		fn truthy(&self, value: &f64) -> bool {
			*value != 0.0 && !value.is_nan()
		}
		fn is_null(&self, value: &f64) -> bool {
			*value == 0.0
		}
		fn get(&self, index: u32) -> Result<f64, Self::Error> {
			Ok(self.fields.borrow()[index as usize])
		}
		fn set(&self, index: u32, value: &f64) -> Result<(), Self::Error> {
			self.fields.borrow_mut()[index as usize] = *value;
			Ok(())
		}
		fn increment(&self, value: &f64, increase: bool) -> Result<f64, Self::Error> {
			Ok(value + if increase { 1.0 } else { -1.0 })
		}
		fn above_zero(&self, value: &f64) -> Result<bool, Self::Error> {
			Ok(*value > 0.0)
		}
		fn has_listeners(&self) -> Result<f64, Self::Error> {
			Ok(7.0)
		}
		fn assign_selection(&self, _event: &f64, selection: &f64) -> Result<(), Self::Error> {
			if self.failure == Some("selection") {
				return Err("selection");
			}
			*self.selection.borrow_mut() = *selection;
			Ok(())
		}
		fn merge(&self, previous: &f64, current: &f64) -> Result<f64, Self::Error> {
			if self.failure == Some("merge") {
				return Err("merge");
			}
			Ok(previous * 100.0 + current)
		}
		fn fire(&self, event: &f64) -> Result<(), Self::Error> {
			if self.failure == Some("fire") {
				return Err("fire");
			}
			let fields = self.fields.borrow();
			self.fired.borrow_mut().push([*event, fields[0], fields[1]]);
			Ok(())
		}
	}
	#[test]
	fn nested_batches_merge_and_clear_before_reentrant_delivery() {
		use ModelContentEventsOperation as O;
		let host = Host::default();
		for (operation, input) in [
			(O::Begin, 0.0),
			(O::Begin, 0.0),
			(O::Fire, 7.0),
			(O::Fire, 8.0),
			(O::End, 1.0),
		] {
			run_model_content_events(&host, operation, &input).unwrap();
		}
		assert!(host.fired.borrow().is_empty());
		run_model_content_events(&host, O::End, &2.0).unwrap();
		assert_eq!(
			(*host.selection.borrow(), host.fired.borrow().clone()),
			(2.0, vec![[708.0, 0.0, 0.0]])
		);
		run_model_content_events(&host, O::Fire, &9.0).unwrap();
		assert_eq!(host.fired.borrow().last(), Some(&[9.0, 0.0, 0.0]));
	}
	#[test]
	fn callback_failures_retain_original_partial_state() {
		use ModelContentEventsOperation as O;
		for (failure, expected) in [
			("merge", [1.0, 7.0]),
			("selection", [0.0, 7.0]),
			("fire", [0.0, 0.0]),
		] {
			let host = Host {
				failure: Some(failure),
				..Host::default()
			};
			run_model_content_events(&host, O::Begin, &0.0).unwrap();
			run_model_content_events(&host, O::Fire, &7.0).unwrap();
			let operation = if failure == "merge" { O::Fire } else { O::End };
			assert_eq!(
				run_model_content_events(&host, operation, &8.0),
				Err(failure)
			);
			assert_eq!(*host.fields.borrow(), expected);
		}
	}
}
