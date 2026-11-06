/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Streaming model snapshots preserve source reads, chunk boundaries, and end-of-stream state.

use crate::ModelComparison;

/// Live source/result capabilities preserve original empty chunks, getters, joins, and failures.
pub trait ModelSnapshotHost {
	type Value;
	type Error;
	fn number(&self, value: f64) -> Self::Value;
	fn null(&self) -> Self::Value;
	fn truthy(&self, value: &Self::Value) -> bool;
	fn is_null(&self, value: &Self::Value) -> bool;
	fn eos(&self) -> Result<Self::Value, Self::Error>;
	fn create_result(&self) -> Result<Self::Value, Self::Error>;
	fn read(&self) -> Result<Self::Value, Self::Error>;
	fn set_eos(&self) -> Result<(), Self::Error>;
	fn length(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn compare(
		&self,
		operation: ModelComparison,
		first: &Self::Value,
		second: &Self::Value,
	) -> Result<bool, Self::Error>;
	fn add(&self, first: &Self::Value, second: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn write(
		&self,
		result: &Self::Value,
		index: f64,
		value: &Self::Value,
	) -> Result<(), Self::Error>;
	fn join(&self, result: &Self::Value) -> Result<Self::Value, Self::Error>;
}

/// Reads through the historical 64-KiB boundary without copying source text into Rust.
pub fn read_model_snapshot<H: ModelSnapshotHost>(host: &H) -> Result<H::Value, H::Error> {
	if host.truthy(&host.eos()?) {
		return Ok(host.null());
	}
	let result = host.create_result()?;
	let mut count = 0.0;
	let mut length = host.number(0.0);
	loop {
		let chunk = host.read()?;
		if host.is_null(&chunk) {
			host.set_eos()?;
			return if count == 0.0 {
				Ok(host.null())
			} else {
				host.join(&result)
			};
		}
		if host.compare(
			ModelComparison::Above,
			&host.length(&chunk)?,
			&host.number(0.0),
		)? {
			host.write(&result, count, &chunk)?;
			count += 1.0;
			// The second length observation may differ from the first on an overridden source.
			length = host.add(&length, &host.length(&chunk)?)?;
		}
		if host.compare(
			ModelComparison::AtLeast,
			&length,
			&host.number(64.0 * 1024.0),
		)? {
			return host.join(&result);
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::RefCell;
	use std::collections::VecDeque;

	struct Host {
		chunks: RefCell<VecDeque<f64>>,
		eos: RefCell<bool>,
		writes: RefCell<Vec<f64>>,
	}
	impl Host {
		fn new(chunks: &[f64]) -> Self {
			Self {
				chunks: RefCell::new(chunks.iter().copied().collect()),
				eos: RefCell::new(false),
				writes: RefCell::new(Vec::new()),
			}
		}
	}
	impl ModelSnapshotHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn number(&self, value: f64) -> f64 {
			value
		}
		fn null(&self) -> f64 {
			-1.0
		}
		fn truthy(&self, value: &f64) -> bool {
			*value != 0.0
		}
		fn is_null(&self, value: &f64) -> bool {
			*value == -1.0
		}
		fn eos(&self) -> Result<f64, Self::Error> {
			Ok(if *self.eos.borrow() { 1.0 } else { 0.0 })
		}
		fn create_result(&self) -> Result<f64, Self::Error> {
			Ok(0.0)
		}
		fn read(&self) -> Result<f64, Self::Error> {
			self.chunks.borrow_mut().pop_front().ok_or("source")
		}
		fn set_eos(&self) -> Result<(), Self::Error> {
			*self.eos.borrow_mut() = true;
			Ok(())
		}
		fn length(&self, value: &f64) -> Result<f64, Self::Error> {
			Ok(*value)
		}
		fn compare(
			&self,
			operation: ModelComparison,
			first: &f64,
			second: &f64,
		) -> Result<bool, Self::Error> {
			Ok(match operation {
				ModelComparison::Above => first > second,
				ModelComparison::AtLeast => first >= second,
				_ => return Err("comparison"),
			})
		}
		fn add(&self, first: &f64, second: &f64) -> Result<f64, Self::Error> {
			Ok(first + second)
		}
		fn write(&self, _result: &f64, _index: f64, value: &f64) -> Result<(), Self::Error> {
			self.writes.borrow_mut().push(*value);
			Ok(())
		}
		fn join(&self, _result: &f64) -> Result<f64, Self::Error> {
			Ok(self.writes.borrow().iter().sum())
		}
	}

	#[test]
	fn empty_chunks_and_terminal_reads_preserve_end_state() {
		let host = Host::new(&[0.0, 2.0, 0.0, 3.0, -1.0]);
		assert_eq!(read_model_snapshot(&host), Ok(5.0));
		assert_eq!(*host.writes.borrow(), [2.0, 3.0]);
		assert!(host.chunks.borrow().is_empty());
		assert_eq!(read_model_snapshot(&host), Ok(-1.0));
	}
	#[test]
	fn threshold_returns_without_consuming_the_following_chunk() {
		let host = Host::new(&[1.0, 65535.0, 7.0, -1.0]);
		assert_eq!(read_model_snapshot(&host), Ok(65536.0));
		assert!(!*host.eos.borrow());
		assert_eq!(host.chunks.borrow().len(), 2);
	}
	#[test]
	fn failed_source_keeps_snapshot_open_and_empty_stream_returns_null() {
		let host = Host::new(&[0.0]);
		assert_eq!(read_model_snapshot(&host), Err("source"));
		assert!(!*host.eos.borrow());
		assert_eq!(read_model_snapshot(&Host::new(&[-1.0])), Ok(-1.0));
	}
}
