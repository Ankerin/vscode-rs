/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Callback traversal retains live host iterators, provider reads, and abrupt-completion behavior.

use js_sys::{Array, Function, Reflect};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	type IterationResult;
	#[wasm_bindgen(method, getter, catch)]
	fn done(this: &IterationResult) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, getter, catch)]
	fn value(this: &IterationResult) -> Result<JsValue, JsValue>;
	type Results;
	#[wasm_bindgen(method, catch, js_name = push)]
	fn push_result(this: &Results, value: &JsValue) -> Result<u32, JsValue>;
}

/// Traverses the original iterator and retains post-callback length reads and original error values.
#[wasm_bindgen]
pub fn walk_token_array(
	iterator: JsValue,
	next: Function,
	read_length: Function,
	visit: Function,
	coercing_add: Function,
	mapping: bool,
) -> Result<JsValue, JsValue> {
	let results = mapping.then(Array::new);
	let mut offset = JsValue::from(0);
	loop {
		// Iterator-step errors do not close the iterator, unlike errors in its consumer body.
		let step = next.call0(&iterator)?;
		if !step.is_object() && !step.is_function() {
			return Err(
				js_sys::TypeError::new("The token iterator result must be an object").into(),
			);
		}
		let step = step.unchecked_ref::<IterationResult>();
		if !step.done()?.is_falsy() {
			break;
		}
		let token = step.value()?;
		let visited = (|| {
			let length = read_length.call1(&JsValue::UNDEFINED, &token)?;
			let end = add(&offset, &length, &coercing_add)?;
			let result = visit.call3(&JsValue::UNDEFINED, &offset, &end, &token)?;
			if let Some(results) = &results {
				results.unchecked_ref::<Results>().push_result(&result)?;
			}
			let length = read_length.call1(&JsValue::UNDEFINED, &token)?;
			add(&offset, &length, &coercing_add)
		})();
		match visited {
			Ok(next_offset) => offset = next_offset,
			Err(error) => {
				close_after_error(&iterator);
				return Err(error);
			}
		}
	}
	Ok(results.map_or(JsValue::TRUE, JsValue::from))
}

fn add(first: &JsValue, second: &JsValue, coercing_add: &Function) -> Result<JsValue, JsValue> {
	if let (Some(first), Some(second)) = (first.as_f64(), second.as_f64()) {
		Ok(JsValue::from(first + second))
	} else {
		// A callback may replace a declared numeric field with any JavaScript value.
		coercing_add.call2(&JsValue::UNDEFINED, first, second)
	}
}

fn close_after_error(iterator: &JsValue) {
	if let Ok(method) = Reflect::get(iterator, &JsValue::from_str("return"))
		&& let Ok(method) = method.dyn_into::<Function>()
	{
		// The original thrown completion wins over a failing return getter, method, or result.
		let _ = method.call0(iterator);
	}
}
