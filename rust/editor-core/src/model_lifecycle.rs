/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Model lifecycle transitions retain original events, service calls, and partial failure state.

use crate::ModelComparison;

/// Public/private lifecycle entry points.
#[derive(Clone, Copy)]
pub enum ModelLifecycleOperation {
	Dispose,
	HasListeners,
	AssertAlive,
	Attach,
	Detach,
	IsAttached,
	AttachedCount,
	TooLargeSync,
	TooLargeTokens,
	TooLargeHeap,
	Disposed,
	Disposing,
	IncreaseVersion,
	OverwriteVersion,
	OverwriteAlternative,
	OverwriteInitial,
}

/// Original live fields remain visible to existing model owners.
#[derive(Clone, Copy)]
pub enum ModelLifecycleField {
	Version,
	AlternativeVersion,
	InitialSnapshot,
	AttachedCount,
	Disposed,
	Disposing,
	TooLargeSync,
	TooLargeTokens,
	TooLargeHeap,
}

/// Original service, event, factory, and disposal capabilities.
#[derive(Clone, Copy)]
pub enum ModelLifecycleAction {
	FireWillDispose,
	ReleaseCommands,
	DisposeTokens,
	DisposeBase,
	DisposeBuffer,
	CreateEmptyBuffer,
	DisposeEmptyBuffer,
	SetBuffer,
	ClearBufferDisposable,
	NotifyAttachedTokens,
	FireAttached,
	AttachView,
	DetachView,
	FailDisposed,
}

/// Caught capabilities retain live field descriptors, service receivers, and public view identities.
pub trait ModelLifecycleHost {
	type Value;
	type Error;
	fn number(&self, value: f64) -> Self::Value;
	fn boolean(&self, value: bool) -> Self::Value;
	fn undefined(&self) -> Self::Value;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn get(&self, field: ModelLifecycleField) -> Result<Self::Value, Self::Error>;
	fn set(&self, field: ModelLifecycleField, value: &Self::Value) -> Result<(), Self::Error>;
	fn action(
		&self,
		action: ModelLifecycleAction,
		value: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn listener(&self, index: u32) -> Result<Self::Value, Self::Error>;
	fn add(&self, first: &Self::Value, second: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn increment(&self, value: &Self::Value, increase: bool) -> Result<Self::Value, Self::Error>;
	fn compare(
		&self,
		operation: ModelComparison,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<bool, Self::Error>;
}

/// Executes original ordered transitions without replaying callbacks or maintaining duplicate state.
pub fn run_model_lifecycle<H: ModelLifecycleHost>(
	host: &H,
	operation: ModelLifecycleOperation,
	input: &H::Value,
) -> Result<H::Value, H::Error> {
	use ModelLifecycleAction as A;
	use ModelLifecycleField as F;
	use ModelLifecycleOperation as O;
	let undefined = host.undefined();
	match operation {
		O::Dispose => {
			host.set(F::Disposing, &host.boolean(true))?;
			host.action(A::FireWillDispose, &undefined)?;
			host.action(A::ReleaseCommands, &undefined)?;
			host.action(A::DisposeTokens, &undefined)?;
			host.set(F::Disposed, &host.boolean(true))?;
			host.action(A::DisposeBase, &undefined)?;
			host.action(A::DisposeBuffer, &undefined)?;
			host.set(F::Disposing, &host.boolean(false))?;
			let empty = host.action(A::CreateEmptyBuffer, &undefined)?;
			host.action(A::DisposeEmptyBuffer, &empty)?;
			host.action(A::SetBuffer, &empty)?;
			host.action(A::ClearBufferDisposable, &undefined)?;
			Ok(undefined)
		}
		O::HasListeners => {
			for index in 0..8 {
				let value = host.listener(index)?;
				if host.truthy(&value) || index == 7 {
					return Ok(value);
				}
			}
			Ok(undefined)
		}
		O::AssertAlive => {
			if host.truthy(&host.get(F::Disposed)?) {
				host.action(A::FailDisposed, &undefined)?;
			}
			Ok(undefined)
		}
		O::Attach | O::Detach => {
			let attached = host.get(F::AttachedCount)?;
			let next = host.increment(&attached, matches!(operation, O::Attach))?;
			host.set(F::AttachedCount, &next)?;
			if host.compare(
				ModelComparison::Equal,
				&host.get(F::AttachedCount)?,
				&host.number(if matches!(operation, O::Attach) {
					1.0
				} else {
					0.0
				}),
			)? {
				host.action(A::NotifyAttachedTokens, &undefined)?;
				host.action(A::FireAttached, &undefined)?;
			}
			if matches!(operation, O::Attach) {
				host.action(A::AttachView, &undefined)
			} else {
				host.action(A::DetachView, input)?;
				Ok(undefined)
			}
		}
		O::IsAttached => Ok(host.boolean(host.compare(
			ModelComparison::Above,
			&host.get(F::AttachedCount)?,
			&host.number(0.0),
		)?)),
		O::AttachedCount => host.get(F::AttachedCount),
		O::TooLargeSync => host.get(F::TooLargeSync),
		O::TooLargeTokens => host.get(F::TooLargeTokens),
		O::TooLargeHeap => host.get(F::TooLargeHeap),
		O::Disposed => host.get(F::Disposed),
		O::Disposing => host.get(F::Disposing),
		O::IncreaseVersion => {
			let next = host.add(&host.get(F::Version)?, &host.number(1.0))?;
			host.set(F::Version, &next)?;
			host.set(F::AlternativeVersion, &host.get(F::Version)?)?;
			Ok(undefined)
		}
		O::OverwriteVersion | O::OverwriteAlternative | O::OverwriteInitial => {
			host.set(
				match operation {
					O::OverwriteVersion => F::Version,
					O::OverwriteAlternative => F::AlternativeVersion,
					_ => F::InitialSnapshot,
				},
				input,
			)?;
			Ok(undefined)
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::RefCell;

	struct Host {
		fields: RefCell<[f64; 9]>,
		actions: RefCell<Vec<u32>>,
		failure: Option<u32>,
	}
	impl Host {
		fn new() -> Self {
			Self {
				fields: RefCell::new([1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
				actions: RefCell::new(Vec::new()),
				failure: None,
			}
		}
	}
	impl ModelLifecycleHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn number(&self, value: f64) -> f64 {
			value
		}
		fn boolean(&self, value: bool) -> f64 {
			if value { 1.0 } else { 0.0 }
		}
		fn undefined(&self) -> f64 {
			f64::NAN
		}
		fn truthy(&self, value: &f64) -> bool {
			*value != 0.0 && !value.is_nan()
		}
		fn get(&self, field: ModelLifecycleField) -> Result<f64, Self::Error> {
			Ok(self.fields.borrow()[field as usize])
		}
		fn set(&self, field: ModelLifecycleField, value: &f64) -> Result<(), Self::Error> {
			self.fields.borrow_mut()[field as usize] = *value;
			Ok(())
		}
		fn action(&self, action: ModelLifecycleAction, _value: &f64) -> Result<f64, Self::Error> {
			self.actions.borrow_mut().push(action as u32);
			if self.failure == Some(action as u32) {
				return Err("service");
			}
			Ok(99.0)
		}
		fn listener(&self, index: u32) -> Result<f64, Self::Error> {
			Ok(if index == 3 { 7.0 } else { 0.0 })
		}
		fn add(&self, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			Ok(first + second)
		}
		fn increment(&self, value: &f64, increase: bool) -> Result<f64, Self::Error> {
			Ok(value + if increase { 1.0 } else { -1.0 })
		}
		fn compare(
			&self,
			operation: ModelComparison,
			first: &f64,
			second: &f64,
		) -> Result<bool, Self::Error> {
			Ok(match operation {
				ModelComparison::Equal => first == second,
				ModelComparison::Above => first > second,
				_ => return Err("comparison"),
			})
		}
	}
	#[test]
	fn attach_and_detach_notify_only_boundary_transitions() {
		let host = Host::new();
		for operation in [
			ModelLifecycleOperation::Attach,
			ModelLifecycleOperation::Attach,
			ModelLifecycleOperation::Detach,
			ModelLifecycleOperation::Detach,
		] {
			run_model_lifecycle(&host, operation, &1.0).unwrap();
		}
		assert_eq!(*host.actions.borrow(), [9, 10, 11, 11, 12, 9, 10, 12]);
		assert_eq!(host.fields.borrow()[3], 0.0);
	}
	#[test]
	fn disposal_failure_keeps_exact_partial_state() {
		let mut host = Host::new();
		host.failure = Some(ModelLifecycleAction::DisposeBuffer as u32);
		assert_eq!(
			run_model_lifecycle(&host, ModelLifecycleOperation::Dispose, &0.0),
			Err("service")
		);
		assert_eq!(*host.actions.borrow(), [0, 1, 2, 3, 4]);
		assert_eq!(
			[host.fields.borrow()[4], host.fields.borrow()[5]],
			[1.0, 1.0]
		);
	}
	#[test]
	fn version_updates_and_listener_short_circuits_keep_original_values() {
		let host = Host::new();
		run_model_lifecycle(&host, ModelLifecycleOperation::IncreaseVersion, &0.0).unwrap();
		assert_eq!(
			[host.fields.borrow()[0], host.fields.borrow()[1]],
			[2.0, 2.0]
		);
		assert_eq!(
			run_model_lifecycle(&host, ModelLifecycleOperation::HasListeners, &0.0),
			Ok(7.0)
		);
	}
}
