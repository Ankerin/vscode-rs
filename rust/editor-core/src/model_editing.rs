/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Public edit transactions retain event nesting, finally precedence, and undo-service identities.

/// The operation numbers are shared with the model facade and generated bindings.
#[derive(Clone, Copy)]
pub enum ModelEditingOperation {
	PushStack,
	PopStack,
	PushEol,
	PushEdits,
	ApplyEdits,
	UndoEdits,
	RedoEdits,
	UndoRedoEdits,
	Undo,
	CanUndo,
	Redo,
	CanRedo,
	PushPrepared,
}

/// Existing event, service, array, and factory methods remain borrowed caught capabilities.
pub trait ModelEditingHost {
	type Value;
	type Error;
	fn undefined(&self) -> Self::Value;
	fn boolean(&self, value: bool) -> Self::Value;
	fn number(&self, value: f64) -> Self::Value;
	fn lf(&self) -> Self::Value;
	fn same(&self, first: &Self::Value, second: &Self::Value) -> bool;
	fn null(&self, value: &Self::Value) -> bool;
	fn nullish(&self, value: &Self::Value) -> bool;
	fn begin_decorations(&self) -> Result<(), Self::Error>;
	fn begin_content(&self) -> Result<(), Self::Error>;
	fn end_content(&self, selection: Option<&Self::Value>) -> Result<(), Self::Error>;
	fn end_decorations(&self) -> Result<(), Self::Error>;
	fn eol(&self) -> Result<Self::Value, Self::Error>;
	fn snapshot(&self) -> Result<Self::Value, Self::Error>;
	fn create_snapshot(&self) -> Result<Self::Value, Self::Error>;
	fn store_snapshot(&self, snapshot: &Self::Value) -> Result<(), Self::Error>;
	fn command_eol(&self, eol: &Self::Value) -> Result<(), Self::Error>;
	fn push_method(&self) -> Result<Self::Value, Self::Error>;
	fn validate(&self, operations: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn push(
		&self,
		method: &Self::Value,
		before: &Self::Value,
		operations: &Self::Value,
		cursor: &Self::Value,
		group: &Self::Value,
		reason: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn apply_method(&self) -> Result<Self::Value, Self::Error>;
	fn source(&self) -> Result<Self::Value, Self::Error>;
	fn apply(
		&self,
		method: &Self::Value,
		operations: &Self::Value,
		undo: &Self::Value,
		reason: &Self::Value,
		selection: Option<&Self::Value>,
	) -> Result<Self::Value, Self::Error>;
	fn undoing(&self, value: &Self::Value) -> Result<(), Self::Error>;
	fn redoing(&self, value: &Self::Value) -> Result<(), Self::Error>;
	fn set_eol(&self, eol: &Self::Value) -> Result<(), Self::Error>;
	fn alternative(&self, version: &Self::Value) -> Result<(), Self::Error>;
	fn map_changes(&self, changes: &Self::Value, undo: bool) -> Result<Self::Value, Self::Error>;
	fn undo_redo(
		&self,
		edits: &Self::Value,
		eol: &Self::Value,
		undo: &Self::Value,
		redo: &Self::Value,
		version: &Self::Value,
		selection: &Self::Value,
	) -> Result<(), Self::Error>;
	fn stack(&self, push: bool) -> Result<(), Self::Error>;
	fn service(&self, operation: u32) -> Result<Self::Value, Self::Error>;
	fn position_method(&self) -> Result<Self::Value, Self::Error>;
	fn change_field(&self, change: &Self::Value, index: u32) -> Result<Self::Value, Self::Error>;
	fn position(
		&self,
		method: &Self::Value,
		offset: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn range_method(&self) -> Result<Self::Value, Self::Error>;
	fn position_field(
		&self,
		position: &Self::Value,
		index: u32,
	) -> Result<Self::Value, Self::Error>;
	fn range(
		&self,
		method: &Self::Value,
		values: &[Self::Value; 4],
	) -> Result<Self::Value, Self::Error>;
	fn edit(&self, range: &Self::Value, text: &Self::Value) -> Result<Self::Value, Self::Error>;

	fn truthy(&self, value: &Self::Value) -> bool;
	fn trim_enabled(&self) -> Result<Self::Value, Self::Error>;
	fn trim_lines(&self) -> Result<Self::Value, Self::Error>;
	fn incoming(&self, operations: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn length(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn less(&self, index: f64, length: &Self::Value) -> Result<bool, Self::Error>;
	fn selection(&self, selections: &Self::Value, index: f64) -> Result<Self::Value, Self::Error>;
	fn selection_field(
		&self,
		selection: &Self::Value,
		index: u32,
	) -> Result<Self::Value, Self::Error>;
	fn incoming_range(&self, edits: &Self::Value, index: f64) -> Result<Self::Value, Self::Error>;
	fn incoming_text(&self, edits: &Self::Value, index: f64) -> Result<Self::Value, Self::Error>;
	fn range_field(&self, range: &Self::Value, index: u32) -> Result<Self::Value, Self::Error>;
	fn greater(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
	fn below(&self, first: &Self::Value, second: &Self::Value) -> Result<bool, Self::Error>;
	fn trim_length(&self) -> Result<Self::Value, Self::Error>;
	fn trim_line(&self, index: f64) -> Result<Self::Value, Self::Error>;
	fn max_column(&self, line: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn empty(&self, range: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn char_method(&self, text: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn char(&self, method: &Self::Value, index: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn minus_one(&self, value: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn trim_range(
		&self,
		line: &Self::Value,
		column: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
	fn append_method(&self, operations: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn trim_edit(&self, range: &Self::Value) -> Result<Self::Value, Self::Error>;
	fn append(&self, method: &Self::Value, edit: &Self::Value) -> Result<(), Self::Error>;
	fn clear_trim(&self) -> Result<(), Self::Error>;
	fn command_push(&self, args: &[Self::Value; 6]) -> Result<Self::Value, Self::Error>;
	fn validate_range_method(&self) -> Result<Self::Value, Self::Error>;
	fn operation_field(
		&self,
		operation: &Self::Value,
		index: u32,
	) -> Result<Self::Value, Self::Error>;
	fn validate_range(
		&self,
		method: &Self::Value,
		range: &Self::Value,
	) -> Result<Self::Value, Self::Error>;
}

/// Maps one undo/redo change without losing virtual-method and constructor lookup order.
pub fn map_model_undo_change<H: ModelEditingHost>(
	host: &H,
	change: &H::Value,
	undo: bool,
) -> Result<H::Value, H::Error> {
	let base = if undo { 0 } else { 3 };
	let method = host.position_method()?;
	let start = host.position(&method, &host.change_field(change, base)?)?;
	let method = host.position_method()?;
	let end = host.position(&method, &host.change_field(change, base + 1)?)?;
	let method = host.range_method()?;
	let first = host.position_field(&start, 0)?;
	let second = host.position_field(&start, 1)?;
	let third = host.position_field(&end, 0)?;
	let fourth = host.position_field(&end, 1)?;
	let range = host.range(&method, &[first, second, third, fourth])?;
	let text = host.change_field(change, base + 2)?;
	host.edit(&range, &text)
}

/// Executes a public edit transition with JavaScript finally error precedence.
pub fn run_model_editing<H: ModelEditingHost>(
	host: &H,
	operation: ModelEditingOperation,
	args: &[H::Value; 6],
) -> Result<H::Value, H::Error> {
	use ModelEditingOperation as O;
	match operation {
		O::PushPrepared => return push_prepared_model_edits(host, args),
		O::PushStack | O::PopStack => {
			host.stack(matches!(operation, O::PushStack))?;
		}
		O::Undo | O::CanUndo | O::Redo | O::CanRedo => {
			return host.service(match operation {
				O::Undo => 0,
				O::CanUndo => 1,
				O::Redo => 2,
				_ => 3,
			});
		}
		O::UndoEdits | O::RedoEdits => {
			let undo = matches!(operation, O::UndoEdits);
			let edits = host.map_changes(&args[0], undo)?;
			host.undo_redo(
				&edits,
				&args[1],
				&host.boolean(undo),
				&host.boolean(!undo),
				&args[2],
				&args[3],
			)?;
		}
		O::PushEol => {
			let current = host.number(if host.same(&host.eol()?, &host.lf()) {
				0.0
			} else {
				1.0
			});
			if host.same(&current, &args[0]) {
				return Ok(host.undefined());
			}
			let result = (|| {
				host.begin_decorations()?;
				host.begin_content()?;
				if host.null(&host.snapshot()?) {
					host.store_snapshot(&host.create_snapshot()?)?;
				}
				host.command_eol(&args[0])?;
				Ok(host.undefined())
			})();
			host.end_content(None)?;
			host.end_decorations()?;
			return result;
		}
		O::PushEdits | O::ApplyEdits => {
			let result = (|| {
				host.begin_decorations()?;
				host.begin_content()?;
				if matches!(operation, O::PushEdits) {
					let method = host.push_method()?;
					let operations = host.validate(&args[1])?;
					host.push(&method, &args[0], &operations, &args[2], &args[3], &args[4])
				} else {
					let operations = host.validate(&args[0])?;
					let method = host.apply_method()?;
					let fallback = host.boolean(false);
					let undo = if host.nullish(&args[1]) {
						&fallback
					} else {
						&args[1]
					};
					apply_with_reason(host, &method, &operations, undo, &args[2], None)
				}
			})();
			host.end_content(None)?;
			host.end_decorations()?;
			return result;
		}
		O::UndoRedoEdits => {
			let result = (|| {
				host.begin_decorations()?;
				host.begin_content()?;
				host.undoing(&args[2])?;
				host.redoing(&args[3])?;
				let operations = host.validate(&args[0])?;
				let method = host.apply_method()?;
				host.apply(
					&method,
					&operations,
					&host.boolean(false),
					&host.source()?,
					Some(&args[5]),
				)?;
				host.set_eol(&args[1])?;
				host.alternative(&args[4])?;
				Ok(host.undefined())
			})();
			host.undoing(&host.boolean(false))?;
			host.redoing(&host.boolean(false))?;
			host.end_content(Some(&args[5]))?;
			host.end_decorations()?;
			return result;
		}
	}
	Ok(host.undefined())
}

fn apply_with_reason<H: ModelEditingHost>(
	host: &H,
	method: &H::Value,
	operations: &H::Value,
	undo: &H::Value,
	reason: &H::Value,
	selection: Option<&H::Value>,
) -> Result<H::Value, H::Error> {
	if host.nullish(reason) {
		host.apply(method, operations, undo, &host.source()?, selection)
	} else {
		host.apply(method, operations, undo, reason, selection)
	}
}

/// Prepares one mapped incoming edit while preserving method lookup before range getters.
pub fn prepare_model_incoming_edit<H: ModelEditingHost>(
	host: &H,
	operation: &H::Value,
) -> Result<H::Value, H::Error> {
	let method = host.validate_range_method()?;
	let range = host.validate_range(&method, &host.operation_field(operation, 0)?)?;
	let text = host.operation_field(operation, 1)?;
	host.edit(&range, &text)
}

fn newline_insertion<H: ModelEditingHost>(
	host: &H,
	range: &H::Value,
	text: &H::Value,
	line: &H::Value,
	column: &H::Value,
	before: bool,
) -> Result<bool, H::Error> {
	if !host.same(line, &host.range_field(range, 0)?)
		|| !host.same(&host.range_field(range, 1)?, column)
		|| !host.truthy(&host.empty(range)?)
		|| !host.truthy(text)
		|| !host.greater(&host.length(text)?, &host.number(0.0))?
	{
		return Ok(false);
	}
	let method = host.char_method(text)?;
	let index = if before {
		host.minus_one(&host.length(text)?)?
	} else {
		host.number(0.0)
	};
	Ok(host.same(&host.char(&method, &index)?, &host.lf()))
}

/// Preserves cursor proximity, newline exceptions, trim conflicts, live arrays, and snapshot capture.
pub fn push_prepared_model_edits<H: ModelEditingHost>(
	host: &H,
	args: &[H::Value; 6],
) -> Result<H::Value, H::Error> {
	if host.truthy(&host.trim_enabled()?) && host.truthy(&host.trim_lines()?) {
		let incoming = host.incoming(&args[1])?;
		let mut near = true;
		if host.truthy(&args[0]) {
			let length = host.length(&args[0])?;
			let mut index = 0.0;
			while host.less(index, &length)? {
				let selection = host.selection(&args[0], index)?;
				let mut found = false;
				let edit_length = host.length(&incoming)?;
				let mut edit_index = 0.0;
				while host.less(edit_index, &edit_length)? {
					let range = host.incoming_range(&incoming, edit_index)?;
					let above = host.greater(
						&host.range_field(&range, 0)?,
						&host.selection_field(&selection, 0)?,
					)?;
					let below = host.greater(
						&host.selection_field(&selection, 1)?,
						&host.range_field(&range, 2)?,
					)?;
					if !above && !below {
						found = true;
						break;
					}
					edit_index += 1.0;
				}
				if !found {
					near = false;
					break;
				}
				index += 1.0;
			}
		}
		if near {
			let length = host.trim_length()?;
			let mut index = 0.0;
			while host.less(index, &length)? {
				let line = host.trim_line(index)?;
				let column = host.max_column(&line)?;
				let mut allowed = true;
				let edit_length = host.length(&incoming)?;
				let mut edit_index = 0.0;
				while host.less(edit_index, &edit_length)? {
					let range = host.incoming_range(&incoming, edit_index)?;
					let text = host.incoming_text(&incoming, edit_index)?;
					if host.below(&line, &host.range_field(&range, 0)?)?
						|| host.greater(&line, &host.range_field(&range, 2)?)?
					{
						edit_index += 1.0;
						continue;
					}
					if newline_insertion(host, &range, &text, &line, &column, false)?
						|| newline_insertion(host, &range, &text, &line, &host.number(1.0), true)?
					{
						edit_index += 1.0;
						continue;
					}
					allowed = false;
					break;
				}
				if allowed {
					let range = host.trim_range(&line, &column)?;
					let method = host.append_method(&args[1])?;
					let edit = host.trim_edit(&range)?;
					host.append(&method, &edit)?;
				}
				index += 1.0;
			}
		}
		host.clear_trim()?;
	}
	if host.null(&host.snapshot()?) {
		host.store_snapshot(&host.create_snapshot()?)?;
	}
	host.command_push(args)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::RefCell;

	#[derive(Default)]
	struct Host {
		failures: Vec<&'static str>,
		calls: RefCell<Vec<(&'static str, Vec<f64>)>>,
		trim: bool,
		near: bool,
		newline: bool,
	}
	impl Host {
		fn call(&self, name: &'static str, args: &[f64]) -> Result<f64, &'static str> {
			self.calls.borrow_mut().push((name, args.to_vec()));
			if self.failures.contains(&name) {
				return Err(name);
			}
			Ok(match name {
				"trim_enabled" => {
					if self.trim {
						1.0
					} else {
						0.0
					}
				}
				"trim_lines" => 7.0,
				"incoming" => 8.0,
				"length" => {
					if args[0] == 30.0 {
						2.0
					} else {
						1.0
					}
				}
				"selection" => 9.0,
				"selection_field" => {
					if self.near {
						2.0
					} else {
						99.0
					}
				}
				"incoming_range" => 10.0,
				"incoming_text" => 30.0,
				"range_field" => {
					if args[1] == 1.0 {
						3.0
					} else {
						2.0
					}
				}
				"trim_line" => 2.0,
				"max_column" => 3.0,
				"char" => {
					if self.newline {
						2.0
					} else {
						0.0
					}
				}
				"eol" => 2.0,
				"snapshot" => 0.0,
				"validate" => 48.0,
				"push_method" => 55.0,
				"apply_method" => 66.0,
				"source" => 90.0,
				"apply" | "push" | "service" | "command_push" => 70.0,
				_ => 1.0,
			})
		}
		fn names(&self) -> Vec<&'static str> {
			self.calls.borrow().iter().map(|call| call.0).collect()
		}
	}
	impl ModelEditingHost for Host {
		type Value = f64;
		type Error = &'static str;
		fn undefined(&self) -> f64 {
			-1.0
		}
		fn boolean(&self, value: bool) -> f64 {
			if value { 1.0 } else { 0.0 }
		}
		fn number(&self, value: f64) -> f64 {
			value
		}
		fn lf(&self) -> f64 {
			2.0
		}
		fn same(&self, first: &f64, second: &f64) -> bool {
			first == second
		}
		fn null(&self, value: &f64) -> bool {
			*value == 0.0
		}
		fn nullish(&self, value: &f64) -> bool {
			*value == 0.0 || *value == -1.0
		}
		fn begin_decorations(&self) -> Result<(), Self::Error> {
			self.call("begin_decorations", &[]).map(|_| ())
		}
		fn begin_content(&self) -> Result<(), Self::Error> {
			self.call("begin_content", &[]).map(|_| ())
		}
		fn end_content(&self, selection: Option<&f64>) -> Result<(), Self::Error> {
			self.call("end_content", &[selection.copied().unwrap_or(-1.0)])
				.map(|_| ())
		}
		fn end_decorations(&self) -> Result<(), Self::Error> {
			self.call("end_decorations", &[]).map(|_| ())
		}
		fn eol(&self) -> Result<f64, Self::Error> {
			self.call("eol", &[])
		}
		fn snapshot(&self) -> Result<f64, Self::Error> {
			self.call("snapshot", &[])
		}
		fn create_snapshot(&self) -> Result<f64, Self::Error> {
			self.call("create_snapshot", &[])
		}
		fn store_snapshot(&self, snapshot: &f64) -> Result<(), Self::Error> {
			self.call("store_snapshot", &[*snapshot]).map(|_| ())
		}
		fn command_eol(&self, eol: &f64) -> Result<(), Self::Error> {
			self.call("command_eol", &[*eol]).map(|_| ())
		}
		fn push_method(&self) -> Result<f64, Self::Error> {
			self.call("push_method", &[])
		}
		fn validate(&self, operations: &f64) -> Result<f64, Self::Error> {
			self.call("validate", &[*operations])
		}
		fn push(
			&self,
			method: &f64,
			before: &f64,
			operations: &f64,
			cursor: &f64,
			group: &f64,
			reason: &f64,
		) -> Result<f64, Self::Error> {
			self.call(
				"push",
				&[*method, *before, *operations, *cursor, *group, *reason],
			)
		}
		fn apply_method(&self) -> Result<f64, Self::Error> {
			self.call("apply_method", &[])
		}
		fn source(&self) -> Result<f64, Self::Error> {
			self.call("source", &[])
		}
		fn apply(
			&self,
			method: &f64,
			operations: &f64,
			undo: &f64,
			reason: &f64,
			selection: Option<&f64>,
		) -> Result<f64, Self::Error> {
			self.call(
				"apply",
				&[
					*method,
					*operations,
					*undo,
					*reason,
					selection.copied().unwrap_or(-1.0),
				],
			)
		}
		fn undoing(&self, value: &f64) -> Result<(), Self::Error> {
			self.call("undoing", &[*value]).map(|_| ())
		}
		fn redoing(&self, value: &f64) -> Result<(), Self::Error> {
			self.call("redoing", &[*value]).map(|_| ())
		}
		fn set_eol(&self, eol: &f64) -> Result<(), Self::Error> {
			self.call("set_eol", &[*eol]).map(|_| ())
		}
		fn alternative(&self, version: &f64) -> Result<(), Self::Error> {
			self.call("alternative", &[*version]).map(|_| ())
		}
		fn map_changes(&self, changes: &f64, undo: bool) -> Result<f64, Self::Error> {
			self.call("map_changes", &[*changes, if undo { 1.0 } else { 0.0 }])
		}
		fn undo_redo(
			&self,
			edits: &f64,
			eol: &f64,
			undo: &f64,
			redo: &f64,
			version: &f64,
			selection: &f64,
		) -> Result<(), Self::Error> {
			self.call(
				"undo_redo",
				&[*edits, *eol, *undo, *redo, *version, *selection],
			)
			.map(|_| ())
		}
		fn stack(&self, push: bool) -> Result<(), Self::Error> {
			self.call("stack", &[if push { 1.0 } else { 0.0 }])
				.map(|_| ())
		}
		fn service(&self, operation: u32) -> Result<f64, Self::Error> {
			self.call("service", &[f64::from(operation)])
		}
		fn position_method(&self) -> Result<f64, Self::Error> {
			self.call("position_method", &[])
		}
		fn change_field(&self, change: &f64, index: u32) -> Result<f64, Self::Error> {
			self.call("change_field", &[*change, f64::from(index)])
		}
		fn position(&self, method: &f64, offset: &f64) -> Result<f64, Self::Error> {
			self.call("position", &[*method, *offset])
		}
		fn range_method(&self) -> Result<f64, Self::Error> {
			self.call("range_method", &[])
		}
		fn position_field(&self, position: &f64, index: u32) -> Result<f64, Self::Error> {
			self.call("position_field", &[*position, f64::from(index)])
		}
		fn range(&self, method: &f64, values: &[f64; 4]) -> Result<f64, Self::Error> {
			self.call(
				"range",
				&[*method, values[0], values[1], values[2], values[3]],
			)
		}
		fn edit(&self, range: &f64, text: &f64) -> Result<f64, Self::Error> {
			self.call("edit", &[*range, *text])
		}
		fn truthy(&self, value: &f64) -> bool {
			*value != 0.0 && !value.is_nan()
		}
		fn trim_enabled(&self) -> Result<f64, Self::Error> {
			self.call("trim_enabled", &[])
		}
		fn trim_lines(&self) -> Result<f64, Self::Error> {
			self.call("trim_lines", &[])
		}
		fn incoming(&self, operations: &f64) -> Result<f64, Self::Error> {
			self.call("incoming", &[*operations])
		}
		fn length(&self, value: &f64) -> Result<f64, Self::Error> {
			self.call("length", &[*value])
		}
		fn less(&self, index: f64, length: &f64) -> Result<bool, Self::Error> {
			self.call("less", &[index, *length])?;
			Ok(index < *length)
		}
		fn selection(&self, selections: &f64, index: f64) -> Result<f64, Self::Error> {
			self.call("selection", &[*selections, index])
		}
		fn selection_field(&self, selection: &f64, index: u32) -> Result<f64, Self::Error> {
			self.call("selection_field", &[*selection, f64::from(index)])
		}
		fn incoming_range(&self, edits: &f64, index: f64) -> Result<f64, Self::Error> {
			self.call("incoming_range", &[*edits, index])
		}
		fn incoming_text(&self, edits: &f64, index: f64) -> Result<f64, Self::Error> {
			self.call("incoming_text", &[*edits, index])
		}
		fn range_field(&self, range: &f64, index: u32) -> Result<f64, Self::Error> {
			self.call("range_field", &[*range, f64::from(index)])
		}
		fn greater(&self, first: &f64, second: &f64) -> Result<bool, Self::Error> {
			self.call("greater", &[*first, *second])?;
			Ok(*first > *second)
		}
		fn below(&self, first: &f64, second: &f64) -> Result<bool, Self::Error> {
			self.call("below", &[*first, *second])?;
			Ok(*first < *second)
		}
		fn trim_length(&self) -> Result<f64, Self::Error> {
			self.call("trim_length", &[])
		}
		fn trim_line(&self, index: f64) -> Result<f64, Self::Error> {
			self.call("trim_line", &[index])
		}
		fn max_column(&self, line: &f64) -> Result<f64, Self::Error> {
			self.call("max_column", &[*line])
		}
		fn empty(&self, range: &f64) -> Result<f64, Self::Error> {
			self.call("empty", &[*range])
		}
		fn char_method(&self, text: &f64) -> Result<f64, Self::Error> {
			self.call("char_method", &[*text])
		}
		fn char(&self, method: &f64, index: &f64) -> Result<f64, Self::Error> {
			self.call("char", &[*method, *index])
		}
		fn minus_one(&self, value: &f64) -> Result<f64, Self::Error> {
			self.call("minus_one", &[*value])?;
			Ok(*value - 1.0)
		}
		fn trim_range(&self, line: &f64, column: &f64) -> Result<f64, Self::Error> {
			self.call("trim_range", &[*line, *column])
		}
		fn append_method(&self, operations: &f64) -> Result<f64, Self::Error> {
			self.call("append_method", &[*operations])
		}
		fn trim_edit(&self, range: &f64) -> Result<f64, Self::Error> {
			self.call("trim_edit", &[*range])
		}
		fn append(&self, method: &f64, edit: &f64) -> Result<(), Self::Error> {
			self.call("append", &[*method, *edit]).map(|_| ())
		}
		fn clear_trim(&self) -> Result<(), Self::Error> {
			self.call("clear_trim", &[]).map(|_| ())
		}
		fn command_push(&self, args: &[f64; 6]) -> Result<f64, Self::Error> {
			self.call("command_push", &args[..5])
		}
		fn validate_range_method(&self) -> Result<f64, Self::Error> {
			self.call("validate_range_method", &[])
		}
		fn operation_field(&self, operation: &f64, index: u32) -> Result<f64, Self::Error> {
			self.call("operation_field", &[*operation, f64::from(index)])
		}
		fn validate_range(&self, method: &f64, range: &f64) -> Result<f64, Self::Error> {
			self.call("validate_range", &[*method, *range])
		}
	}
	#[test]
	fn public_edit_finally_preserves_original_failure_and_cleanup_precedence() {
		use ModelEditingOperation as O;
		for failures in [
			vec!["validate"],
			vec!["validate", "end_content"],
			vec!["validate", "end_decorations"],
			vec!["begin_decorations"],
		] {
			let host = Host {
				failures: failures.clone(),
				..Host::default()
			};
			assert_eq!(
				run_model_editing(&host, O::ApplyEdits, &[3.0; 6]),
				Err(*failures.last().unwrap())
			);
			let names = host.names();
			assert!(names.contains(&"end_content"));
			assert_eq!(
				names.contains(&"end_decorations"),
				!failures.contains(&"end_content")
			);
		}
	}
	#[test]
	fn undo_redo_failure_resets_flags_before_selection_delivery() {
		let host = Host {
			failures: vec!["validate"],
			..Host::default()
		};
		assert_eq!(
			run_model_editing(&host, ModelEditingOperation::UndoRedoEdits, &[3.0; 6]),
			Err("validate")
		);
		assert_eq!(
			*host.calls.borrow(),
			[
				("begin_decorations", vec![]),
				("begin_content", vec![]),
				("undoing", vec![3.0]),
				("redoing", vec![3.0]),
				("validate", vec![3.0]),
				("undoing", vec![0.0]),
				("redoing", vec![0.0]),
				("end_content", vec![3.0]),
				("end_decorations", vec![])
			]
		);
	}
	#[test]
	fn push_eol_noop_skips_nesting_and_changed_eol_captures_snapshot() {
		let host = Host::default();
		assert_eq!(
			run_model_editing(&host, ModelEditingOperation::PushEol, &[0.0; 6]),
			Ok(-1.0)
		);
		assert_eq!(host.names(), ["eol"]);
		let host = Host::default();
		run_model_editing(&host, ModelEditingOperation::PushEol, &[1.0; 6]).unwrap();
		assert_eq!(
			host.names(),
			[
				"eol",
				"begin_decorations",
				"begin_content",
				"snapshot",
				"create_snapshot",
				"store_snapshot",
				"command_eol",
				"end_content",
				"end_decorations"
			]
		);
	}
	#[test]
	fn apply_defaults_and_push_method_capture_retain_argument_order() {
		let host = Host::default();
		assert_eq!(
			run_model_editing(
				&host,
				ModelEditingOperation::ApplyEdits,
				&[3.0, -1.0, 0.0, -1.0, -1.0, -1.0]
			),
			Ok(70.0)
		);
		assert_eq!(
			host.calls.borrow()[5],
			("apply", vec![66.0, 48.0, 0.0, 90.0, -1.0])
		);
		let host = Host::default();
		assert_eq!(
			run_model_editing(&host, ModelEditingOperation::PushEdits, &[3.0; 6]),
			Ok(70.0)
		);
		assert_eq!(
			host.names(),
			[
				"begin_decorations",
				"begin_content",
				"push_method",
				"validate",
				"push",
				"end_content",
				"end_decorations"
			]
		);
	}
	#[test]
	fn undo_mapping_captures_methods_and_range_before_property_reads() {
		let host = Host::default();
		map_model_undo_change(&host, &8.0, true).unwrap();
		assert_eq!(
			host.names(),
			[
				"position_method",
				"change_field",
				"position",
				"position_method",
				"change_field",
				"position",
				"range_method",
				"position_field",
				"position_field",
				"position_field",
				"position_field",
				"range",
				"change_field",
				"edit"
			]
		);
		assert_eq!(host.calls.borrow()[1], ("change_field", vec![8.0, 0.0]));
		assert_eq!(host.calls.borrow()[12], ("change_field", vec![8.0, 2.0]));
		let host = Host::default();
		assert_eq!(
			run_model_editing(&host, ModelEditingOperation::Redo, &[0.0; 6]),
			Ok(70.0)
		);
		assert_eq!(*host.calls.borrow(), [("service", vec![2.0])]);
	}

	#[test]
	fn preparation_skips_disabled_trim_and_retains_command_result() {
		let host = Host::default();
		assert_eq!(
			run_model_editing(&host, ModelEditingOperation::PushPrepared, &[3.0; 6]),
			Ok(70.0)
		);
		assert_eq!(
			host.names(),
			[
				"trim_enabled",
				"snapshot",
				"create_snapshot",
				"store_snapshot",
				"command_push"
			]
		);
	}
	#[test]
	fn preparation_requires_near_cursors_and_resets_trim_after_conflicts() {
		for near in [false, true] {
			let host = Host {
				trim: true,
				near,
				..Host::default()
			};
			run_model_editing(&host, ModelEditingOperation::PushPrepared, &[3.0; 6]).unwrap();
			let names = host.names();
			assert!(!names.contains(&"append"));
			assert_eq!(names.contains(&"trim_line"), near);
			assert!(names.contains(&"clear_trim"));
		}
	}
	#[test]
	fn preparation_allows_newline_insertions_and_captures_append_before_edit_creation() {
		let host = Host {
			trim: true,
			near: true,
			newline: true,
			..Host::default()
		};
		run_model_editing(&host, ModelEditingOperation::PushPrepared, &[3.0; 6]).unwrap();
		let names = host.names();
		assert!(
			names
				.windows(3)
				.any(|names| names == ["append_method", "trim_edit", "append"])
		);
		let host = Host {
			failures: vec!["trim_edit"],
			trim: true,
			near: true,
			newline: true,
			..Host::default()
		};
		assert_eq!(
			run_model_editing(&host, ModelEditingOperation::PushPrepared, &[3.0; 6]),
			Err("trim_edit")
		);
		assert!(!host.names().contains(&"clear_trim"));
	}
}
