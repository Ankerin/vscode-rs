/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Deferred decoration events retain accumulated flags, affected sets, callback order, and reentrancy.

/// Public and private decoration-emitter entry points.
#[derive(Clone, Copy)]
pub enum ModelDecorationEventsOperation {
	HasListeners,
	Begin,
	End,
	Injected,
	Height,
	Font,
	Check,
	Fire,
	Try,
	Deliver,
}

/// Live fields and original set/event/callback capabilities stay borrowed and caught.
pub trait ModelDecorationEventsHost {
	type Value;
	type Error;
	fn number(&self, value: f64) -> Self::Value;
	fn boolean(&self, value: bool) -> Self::Value;
	fn null(&self) -> Self::Value;
	fn undefined(&self) -> Self::Value;
	fn numeric(&self, value: &Self::Value) -> Option<f64>;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn nullish(&self, value: &Self::Value) -> bool;
	fn get(&self, index: u32) -> Result<Self::Value, Self::Error>;
	fn set(&self, index: u32, value: &Self::Value) -> Result<(), Self::Error>;
	fn increment(&self, value: &Self::Value, increase: bool) -> Result<Self::Value, Self::Error>;
	fn has_listeners(&self) -> Result<Self::Value, Self::Error>;
	fn try_fire(&self) -> Result<(), Self::Error>;
	fn deliver(&self) -> Result<(), Self::Error>;
	fn clear(&self, set: &Self::Value) -> Result<(), Self::Error>;
	fn create_set(&self, index: u32) -> Result<Self::Value, Self::Error>;
	fn add(&self, index: u32, input: &Self::Value) -> Result<(), Self::Error>;
	fn option_flag(&self, input: &Self::Value, index: u32) -> Result<Self::Value, Self::Error>;
	fn before_method(&self) -> Result<Self::Value, Self::Error>;
	fn before(&self, method: &Self::Value, sets: &[Self::Value; 3]) -> Result<(), Self::Error>;
	fn event(&self, flags: &[Self::Value; 4]) -> Result<Self::Value, Self::Error>;
	fn fire_event(&self, event: &Self::Value) -> Result<(), Self::Error>;
}

fn change_count<H: ModelDecorationEventsHost>(host: &H, increase: bool) -> Result<(), H::Error> {
	let value = host.get(0)?;
	let value = if let Some(value) = host.numeric(&value) {
		host.number(value + if increase { 1.0 } else { -1.0 })
	} else {
		host.increment(&value, increase)?
	};
	host.set(0, &value)
}

/// Executes every decoration batching/recording/delivery path with original partially changed state.
pub fn run_model_decoration_events<H: ModelDecorationEventsHost>(
	host: &H,
	operation: ModelDecorationEventsOperation,
	input: &H::Value,
) -> Result<H::Value, H::Error> {
	use ModelDecorationEventsOperation as O;
	match operation {
		O::HasListeners => return host.has_listeners(),
		O::Begin => change_count(host, true)?,
		O::End => {
			change_count(host, false)?;
			if host.numeric(&host.get(0)?) == Some(0.0) {
				if host.truthy(&host.get(1)?) {
					host.deliver()?;
				}
				for index in 6..9 {
					let set = host.get(index)?;
					if !host.nullish(&set) {
						host.clear(&set)?;
					}
					host.set(index, &host.null())?;
				}
			}
		}
		O::Injected | O::Height | O::Font => {
			let index = match operation {
				O::Injected => 6,
				O::Height => 7,
				_ => 8,
			};
			if !host.truthy(&host.get(index)?) {
				host.set(index, &host.create_set(index)?)?;
			}
			host.add(index, input)?;
		}
		O::Check => {
			for index in 2..6 {
				if !host.truthy(&host.get(index)?) {
					let value = host.option_flag(input, index - 2)?;
					host.set(index, &host.boolean(host.truthy(&value)))?;
				}
			}
			host.try_fire()?;
		}
		O::Fire => {
			for index in 2..5 {
				host.set(index, &host.boolean(true))?;
			}
			host.try_fire()?;
		}
		O::Try => {
			if host.numeric(&host.get(0)?) == Some(0.0) {
				host.deliver()?;
			} else {
				host.set(1, &host.boolean(true))?;
			}
		}
		O::Deliver => {
			let method = host.before_method()?;
			let injected = host.get(6)?;
			let heights = host.get(7)?;
			let fonts = host.get(8)?;
			host.before(&method, &[injected, heights, fonts])?;
			let mini = host.get(2)?;
			let overview = host.get(3)?;
			let glyph = host.get(4)?;
			let line = host.get(5)?;
			let event = host.event(&[mini, overview, glyph, line])?;
			for index in 1..5 {
				host.set(index, &host.boolean(false))?;
			}
			// The historical line-number flag remains sticky after delivery.
			host.fire_event(&event)?;
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
		fields: RefCell<[f64; 9]>,
		cleared: RefCell<Vec<f64>>,
		flags: RefCell<Vec<[f64; 4]>>,
		options: RefCell<Vec<u32>>,
		failure: bool,
	}
	impl ModelDecorationEventsHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn number(&self, value: f64) -> f64 {
			value
		}
		fn boolean(&self, value: bool) -> f64 {
			if value { 1.0 } else { 0.0 }
		}
		fn null(&self) -> f64 {
			0.0
		}
		fn undefined(&self) -> f64 {
			f64::NAN
		}
		fn numeric(&self, value: &f64) -> Option<f64> {
			Some(*value)
		}
		fn truthy(&self, value: &f64) -> bool {
			*value != 0.0 && !value.is_nan()
		}
		fn nullish(&self, value: &f64) -> bool {
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
		fn has_listeners(&self) -> Result<f64, Self::Error> {
			Ok(7.0)
		}
		fn try_fire(&self) -> Result<(), Self::Error> {
			run_model_decoration_events(self, ModelDecorationEventsOperation::Try, &0.0).map(|_| ())
		}
		fn deliver(&self) -> Result<(), Self::Error> {
			run_model_decoration_events(self, ModelDecorationEventsOperation::Deliver, &0.0)
				.map(|_| ())
		}
		fn clear(&self, set: &f64) -> Result<(), Self::Error> {
			self.cleared.borrow_mut().push(*set);
			Ok(())
		}
		fn create_set(&self, index: u32) -> Result<f64, Self::Error> {
			Ok(100.0 + f64::from(index))
		}
		fn add(&self, _index: u32, _input: &f64) -> Result<(), Self::Error> {
			Ok(())
		}
		fn option_flag(&self, _input: &f64, index: u32) -> Result<f64, Self::Error> {
			self.options.borrow_mut().push(index);
			Ok(1.0)
		}
		fn before_method(&self) -> Result<f64, Self::Error> {
			Ok(1.0)
		}
		fn before(&self, _method: &f64, _sets: &[f64; 3]) -> Result<(), Self::Error> {
			if self.failure {
				Err("original before failure")
			} else {
				Ok(())
			}
		}
		fn event(&self, flags: &[f64; 4]) -> Result<f64, Self::Error> {
			self.flags.borrow_mut().push(*flags);
			Ok(99.0)
		}
		fn fire_event(&self, _event: &f64) -> Result<(), Self::Error> {
			assert_eq!(&self.fields.borrow()[1..5], &[0.0; 4]);
			Ok(())
		}
	}
	#[test]
	fn deferred_delivery_clears_sets_in_order_and_retains_line_number_flag() {
		use ModelDecorationEventsOperation as O;
		let host = Host::default();
		for operation in [O::Begin, O::Injected, O::Height, O::Font, O::Check, O::End] {
			run_model_decoration_events(&host, operation, &1.0).unwrap();
		}
		assert_eq!(*host.flags.borrow(), [[1.0; 4]]);
		assert_eq!(*host.cleared.borrow(), [106.0, 107.0, 108.0]);
		assert_eq!(
			*host.fields.borrow(),
			[0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0]
		);
		run_model_decoration_events(&host, O::Fire, &0.0).unwrap();
		assert_eq!(*host.flags.borrow(), [[1.0; 4], [1.0; 4]]);
	}
	#[test]
	fn before_failure_keeps_pending_flags_and_affected_sets_after_counter_change() {
		use ModelDecorationEventsOperation as O;
		let host = Host {
			failure: true,
			..Host::default()
		};
		for operation in [O::Begin, O::Injected, O::Fire] {
			run_model_decoration_events(&host, operation, &1.0).unwrap();
		}
		assert_eq!(
			run_model_decoration_events(&host, O::End, &0.0),
			Err("original before failure")
		);
		assert_eq!(
			*host.fields.borrow(),
			[0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 106.0, 0.0, 0.0]
		);
		assert!(host.cleared.borrow().is_empty());
	}
	#[test]
	fn flag_accumulation_skips_already_truthy_option_reads() {
		use ModelDecorationEventsOperation as O;
		let host = Host::default();
		host.fields.borrow_mut()[2] = 8.0;
		run_model_decoration_events(&host, O::Begin, &0.0).unwrap();
		run_model_decoration_events(&host, O::Check, &0.0).unwrap();
		assert_eq!(*host.options.borrow(), [1, 2, 3]);
		assert_eq!(&host.fields.borrow()[2..6], &[8.0, 1.0, 1.0, 1.0]);
	}
}
