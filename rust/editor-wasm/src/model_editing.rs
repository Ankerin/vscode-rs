/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Original public edit transitions and undo mapping use caught service and method capabilities.

use vscode_editor_core::{ModelEditingHost, ModelEditingOperation};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type EditingHost;
	#[wasm_bindgen(method, catch, js_name = beginDecorations)]
	fn begin_decorations(this: &EditingHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = beginContent)]
	fn begin_content(this: &EditingHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = endContent)]
	fn end_content(this: &EditingHost, selection: &JsValue, present: bool) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = endDecorations)]
	fn end_decorations(this: &EditingHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = eol)]
	fn eol(this: &EditingHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = snapshot)]
	fn snapshot(this: &EditingHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = createSnapshot)]
	fn create_snapshot(this: &EditingHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = storeSnapshot)]
	fn store_snapshot(this: &EditingHost, snapshot: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = commandEOL)]
	fn command_eol(this: &EditingHost, eol: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = pushMethod)]
	fn push_method(this: &EditingHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = validate)]
	fn validate(this: &EditingHost, operations: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = push)]
	fn push(
		this: &EditingHost,
		method: &JsValue,
		before: &JsValue,
		operations: &JsValue,
		cursor: &JsValue,
		group: &JsValue,
		reason: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = applyMethod)]
	fn apply_method(this: &EditingHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = source)]
	fn source(this: &EditingHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = apply)]
	fn apply(
		this: &EditingHost,
		method: &JsValue,
		operations: &JsValue,
		undo: &JsValue,
		reason: &JsValue,
		selection: &JsValue,
		present: bool,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = undoing)]
	fn undoing(this: &EditingHost, value: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = redoing)]
	fn redoing(this: &EditingHost, value: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = setEOL)]
	fn set_eol(this: &EditingHost, eol: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = alternative)]
	fn alternative(this: &EditingHost, version: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = mapChanges)]
	fn map_changes(this: &EditingHost, changes: &JsValue, undo: bool) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = undoRedo)]
	fn undo_redo(
		this: &EditingHost,
		edits: &JsValue,
		eol: &JsValue,
		undo: &JsValue,
		redo: &JsValue,
		version: &JsValue,
		selection: &JsValue,
	) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = stack)]
	fn stack(this: &EditingHost, push: bool) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = service)]
	fn service(this: &EditingHost, operation: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = positionMethod)]
	fn position_method(this: &EditingHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = changeField)]
	fn change_field(this: &EditingHost, change: &JsValue, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = position)]
	fn position(this: &EditingHost, method: &JsValue, offset: &JsValue)
	-> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = rangeMethod)]
	fn range_method(this: &EditingHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = positionField)]
	fn position_field(
		this: &EditingHost,
		position: &JsValue,
		index: u32,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = range)]
	fn range(
		this: &EditingHost,
		method: &JsValue,
		first: &JsValue,
		second: &JsValue,
		third: &JsValue,
		fourth: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = edit)]
	fn edit(this: &EditingHost, range: &JsValue, text: &JsValue) -> Result<JsValue, JsValue>;
}

struct Host(EditingHost);
impl ModelEditingHost for Host {
	type Value = JsValue;
	type Error = JsValue;
	fn undefined(&self) -> JsValue {
		JsValue::UNDEFINED
	}
	fn boolean(&self, value: bool) -> JsValue {
		JsValue::from_bool(value)
	}
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn lf(&self) -> JsValue {
		JsValue::from_str("\n")
	}
	fn same(&self, first: &JsValue, second: &JsValue) -> bool {
		first == second
	}
	fn null(&self, value: &JsValue) -> bool {
		value.is_null()
	}
	fn nullish(&self, value: &JsValue) -> bool {
		value.is_null() || value.is_undefined()
	}
	fn begin_decorations(&self) -> Result<(), JsValue> {
		self.0.begin_decorations()
	}
	fn begin_content(&self) -> Result<(), JsValue> {
		self.0.begin_content()
	}
	fn end_content(&self, selection: Option<&JsValue>) -> Result<(), JsValue> {
		self.0.end_content(
			selection.unwrap_or(&JsValue::UNDEFINED),
			selection.is_some(),
		)
	}
	fn end_decorations(&self) -> Result<(), JsValue> {
		self.0.end_decorations()
	}
	fn eol(&self) -> Result<JsValue, JsValue> {
		self.0.eol()
	}
	fn snapshot(&self) -> Result<JsValue, JsValue> {
		self.0.snapshot()
	}
	fn create_snapshot(&self) -> Result<JsValue, JsValue> {
		self.0.create_snapshot()
	}
	fn store_snapshot(&self, snapshot: &JsValue) -> Result<(), JsValue> {
		self.0.store_snapshot(snapshot)
	}
	fn command_eol(&self, eol: &JsValue) -> Result<(), JsValue> {
		self.0.command_eol(eol)
	}
	fn push_method(&self) -> Result<JsValue, JsValue> {
		self.0.push_method()
	}
	fn validate(&self, operations: &JsValue) -> Result<JsValue, JsValue> {
		self.0.validate(operations)
	}
	fn push(
		&self,
		method: &JsValue,
		before: &JsValue,
		operations: &JsValue,
		cursor: &JsValue,
		group: &JsValue,
		reason: &JsValue,
	) -> Result<JsValue, JsValue> {
		self.0
			.push(method, before, operations, cursor, group, reason)
	}
	fn apply_method(&self) -> Result<JsValue, JsValue> {
		self.0.apply_method()
	}
	fn source(&self) -> Result<JsValue, JsValue> {
		self.0.source()
	}
	fn apply(
		&self,
		method: &JsValue,
		operations: &JsValue,
		undo: &JsValue,
		reason: &JsValue,
		selection: Option<&JsValue>,
	) -> Result<JsValue, JsValue> {
		self.0.apply(
			method,
			operations,
			undo,
			reason,
			selection.unwrap_or(&JsValue::UNDEFINED),
			selection.is_some(),
		)
	}
	fn undoing(&self, value: &JsValue) -> Result<(), JsValue> {
		self.0.undoing(value)
	}
	fn redoing(&self, value: &JsValue) -> Result<(), JsValue> {
		self.0.redoing(value)
	}
	fn set_eol(&self, eol: &JsValue) -> Result<(), JsValue> {
		self.0.set_eol(eol)
	}
	fn alternative(&self, version: &JsValue) -> Result<(), JsValue> {
		self.0.alternative(version)
	}
	fn map_changes(&self, changes: &JsValue, undo: bool) -> Result<JsValue, JsValue> {
		self.0.map_changes(changes, undo)
	}
	fn undo_redo(
		&self,
		edits: &JsValue,
		eol: &JsValue,
		undo: &JsValue,
		redo: &JsValue,
		version: &JsValue,
		selection: &JsValue,
	) -> Result<(), JsValue> {
		self.0.undo_redo(edits, eol, undo, redo, version, selection)
	}
	fn stack(&self, push: bool) -> Result<(), JsValue> {
		self.0.stack(push)
	}
	fn service(&self, operation: u32) -> Result<JsValue, JsValue> {
		self.0.service(operation)
	}
	fn position_method(&self) -> Result<JsValue, JsValue> {
		self.0.position_method()
	}
	fn change_field(&self, change: &JsValue, index: u32) -> Result<JsValue, JsValue> {
		self.0.change_field(change, index)
	}
	fn position(&self, method: &JsValue, offset: &JsValue) -> Result<JsValue, JsValue> {
		self.0.position(method, offset)
	}
	fn range_method(&self) -> Result<JsValue, JsValue> {
		self.0.range_method()
	}
	fn position_field(&self, position: &JsValue, index: u32) -> Result<JsValue, JsValue> {
		self.0.position_field(position, index)
	}
	fn range(&self, method: &JsValue, values: &[JsValue; 4]) -> Result<JsValue, JsValue> {
		self.0
			.range(method, &values[0], &values[1], &values[2], &values[3])
	}
	fn edit(&self, range: &JsValue, text: &JsValue) -> Result<JsValue, JsValue> {
		self.0.edit(range, text)
	}
}

/// Identifies public editing control independently of buffer transaction storage.
#[wasm_bindgen]
pub fn model_editing_abi_version() -> u32 {
	1
}

/// Runs original edit nesting, defaults, undo flags, and finally error precedence.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn run_model_editing(
	host: EditingHost,
	operation: u32,
	first: JsValue,
	second: JsValue,
	third: JsValue,
	fourth: JsValue,
	fifth: JsValue,
	sixth: JsValue,
) -> Result<JsValue, JsValue> {
	use ModelEditingOperation as O;
	let operation = match operation {
		0 => O::PushStack,
		1 => O::PopStack,
		2 => O::PushEol,
		3 => O::PushEdits,
		4 => O::ApplyEdits,
		5 => O::UndoEdits,
		6 => O::RedoEdits,
		7 => O::UndoRedoEdits,
		8 => O::Undo,
		9 => O::CanUndo,
		10 => O::Redo,
		11 => O::CanRedo,
		_ => return Err(JsValue::from_str("Unsupported model editing operation")),
	};
	vscode_editor_core::run_model_editing(
		&Host(host),
		operation,
		&[first, second, third, fourth, fifth, sixth],
	)
}

/// Maps one original array callback without losing source getters or factory identities.
#[wasm_bindgen]
pub fn map_model_undo_change(
	host: EditingHost,
	change: JsValue,
	undo: bool,
) -> Result<JsValue, JsValue> {
	vscode_editor_core::map_model_undo_change(&Host(host), &change, undo)
}
