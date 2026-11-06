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
	#[wasm_bindgen(method, catch, js_name = trimEnabled)]
	fn trim_enabled(this: &EditingHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = trimLines)]
	fn trim_lines(this: &EditingHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = incoming)]
	fn incoming(this: &EditingHost, operations: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = length)]
	fn length(this: &EditingHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = less)]
	fn less(this: &EditingHost, index: f64, length: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = selection)]
	fn selection(this: &EditingHost, selections: &JsValue, index: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = selectionField)]
	fn selection_field(
		this: &EditingHost,
		selection: &JsValue,
		index: u32,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = incomingRange)]
	fn incoming_range(this: &EditingHost, edits: &JsValue, index: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = incomingText)]
	fn incoming_text(this: &EditingHost, edits: &JsValue, index: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = rangeField)]
	fn range_field(this: &EditingHost, range: &JsValue, index: u32) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = greater)]
	fn greater(this: &EditingHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = below)]
	fn below(this: &EditingHost, first: &JsValue, second: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = trimLength)]
	fn trim_length(this: &EditingHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = trimLine)]
	fn trim_line(this: &EditingHost, index: f64) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = maxColumn)]
	fn max_column(this: &EditingHost, line: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = empty)]
	fn empty(this: &EditingHost, range: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = charMethod)]
	fn char_method(this: &EditingHost, text: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = char)]
	fn char(this: &EditingHost, method: &JsValue, index: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = minusOne)]
	fn minus_one(this: &EditingHost, value: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = trimRange)]
	fn trim_range(this: &EditingHost, line: &JsValue, column: &JsValue)
	-> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = appendMethod)]
	fn append_method(this: &EditingHost, operations: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = trimEdit)]
	fn trim_edit(this: &EditingHost, range: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = append)]
	fn append(this: &EditingHost, method: &JsValue, edit: &JsValue) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = clearTrim)]
	fn clear_trim(this: &EditingHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = commandPush)]
	fn command_push(
		this: &EditingHost,
		before: &JsValue,
		operations: &JsValue,
		cursor: &JsValue,
		group: &JsValue,
		reason: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = validateRangeMethod)]
	fn validate_range_method(this: &EditingHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = operationField)]
	fn operation_field(
		this: &EditingHost,
		operation: &JsValue,
		index: u32,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = validateRange)]
	fn validate_range(
		this: &EditingHost,
		method: &JsValue,
		range: &JsValue,
	) -> Result<JsValue, JsValue>;
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
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn trim_enabled(&self) -> Result<JsValue, JsValue> {
		self.0.trim_enabled()
	}
	fn trim_lines(&self) -> Result<JsValue, JsValue> {
		self.0.trim_lines()
	}
	fn incoming(&self, operations: &JsValue) -> Result<JsValue, JsValue> {
		self.0.incoming(operations)
	}
	fn length(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		self.0.length(value)
	}
	fn less(&self, index: f64, length: &JsValue) -> Result<bool, JsValue> {
		match length.as_f64() {
			Some(length) => Ok(index < length),
			None => self.0.less(index, length),
		}
	}
	fn selection(&self, selections: &JsValue, index: f64) -> Result<JsValue, JsValue> {
		self.0.selection(selections, index)
	}
	fn selection_field(&self, selection: &JsValue, index: u32) -> Result<JsValue, JsValue> {
		self.0.selection_field(selection, index)
	}
	fn incoming_range(&self, edits: &JsValue, index: f64) -> Result<JsValue, JsValue> {
		self.0.incoming_range(edits, index)
	}
	fn incoming_text(&self, edits: &JsValue, index: f64) -> Result<JsValue, JsValue> {
		self.0.incoming_text(edits, index)
	}
	fn range_field(&self, range: &JsValue, index: u32) -> Result<JsValue, JsValue> {
		self.0.range_field(range, index)
	}
	fn greater(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		match (first.as_f64(), second.as_f64()) {
			(Some(first), Some(second)) => Ok(first > second),
			_ => self.0.greater(first, second),
		}
	}
	fn below(&self, first: &JsValue, second: &JsValue) -> Result<bool, JsValue> {
		match (first.as_f64(), second.as_f64()) {
			(Some(first), Some(second)) => Ok(first < second),
			_ => self.0.below(first, second),
		}
	}
	fn trim_length(&self) -> Result<JsValue, JsValue> {
		self.0.trim_length()
	}
	fn trim_line(&self, index: f64) -> Result<JsValue, JsValue> {
		self.0.trim_line(index)
	}
	fn max_column(&self, line: &JsValue) -> Result<JsValue, JsValue> {
		self.0.max_column(line)
	}
	fn empty(&self, range: &JsValue) -> Result<JsValue, JsValue> {
		self.0.empty(range)
	}
	fn char_method(&self, text: &JsValue) -> Result<JsValue, JsValue> {
		self.0.char_method(text)
	}
	fn char(&self, method: &JsValue, index: &JsValue) -> Result<JsValue, JsValue> {
		self.0.char(method, index)
	}
	fn minus_one(&self, value: &JsValue) -> Result<JsValue, JsValue> {
		match value.as_f64() {
			Some(value) => Ok(JsValue::from_f64(value - 1.0)),
			None => self.0.minus_one(value),
		}
	}
	fn trim_range(&self, line: &JsValue, column: &JsValue) -> Result<JsValue, JsValue> {
		self.0.trim_range(line, column)
	}
	fn append_method(&self, operations: &JsValue) -> Result<JsValue, JsValue> {
		self.0.append_method(operations)
	}
	fn trim_edit(&self, range: &JsValue) -> Result<JsValue, JsValue> {
		self.0.trim_edit(range)
	}
	fn append(&self, method: &JsValue, edit: &JsValue) -> Result<(), JsValue> {
		self.0.append(method, edit)
	}
	fn clear_trim(&self) -> Result<(), JsValue> {
		self.0.clear_trim()
	}
	fn command_push(&self, args: &[JsValue; 6]) -> Result<JsValue, JsValue> {
		self.0
			.command_push(&args[0], &args[1], &args[2], &args[3], &args[4])
	}
	fn validate_range_method(&self) -> Result<JsValue, JsValue> {
		self.0.validate_range_method()
	}
	fn operation_field(&self, operation: &JsValue, index: u32) -> Result<JsValue, JsValue> {
		self.0.operation_field(operation, index)
	}
	fn validate_range(&self, method: &JsValue, range: &JsValue) -> Result<JsValue, JsValue> {
		self.0.validate_range(method, range)
	}
}

/// Identifies public editing control independently of buffer transaction storage.
#[wasm_bindgen]
pub fn model_editing_abi_version() -> u32 {
	2
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
		12 => O::PushPrepared,
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

/// Validates one mapped preparation entry without replacing source range/text identities.
#[wasm_bindgen]
pub fn prepare_model_incoming_edit(
	host: EditingHost,
	operation: JsValue,
) -> Result<JsValue, JsValue> {
	vscode_editor_core::prepare_model_incoming_edit(&Host(host), &operation)
}
