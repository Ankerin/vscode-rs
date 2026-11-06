/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Public search and multiline navigation use scoped original model/searcher capabilities.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
	pub type DispatchHost;
	#[wasm_bindgen(method, catch, js_name = emptyResult)]
	fn empty_result(this: &DispatchHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = parse)]
	fn parse(this: &DispatchHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = multiline)]
	fn multiline(this: &DispatchHost, data: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = createSearcher)]
	fn create_searcher(this: &DispatchHost, data: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = allMultiline)]
	fn all_multiline(this: &DispatchHost, data: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = allLines)]
	fn all_lines(this: &DispatchHost, data: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = nextMultiline)]
	fn next_multiline(this: &DispatchHost, searcher: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = nextLines)]
	fn next_lines(this: &DispatchHost, searcher: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = previousMultiline)]
	fn previous_multiline(this: &DispatchHost, searcher: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = previousLines)]
	fn previous_lines(this: &DispatchHost, searcher: &JsValue) -> Result<JsValue, JsValue>;
}
#[wasm_bindgen]
extern "C" {
	pub type MultilineHost;
	#[wasm_bindgen(method, catch, js_name = prepareForward)]
	fn prepare_forward(this: &MultilineHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = resetForward)]
	fn reset_forward(this: &MultilineHost) -> Result<(), JsValue>;
	#[wasm_bindgen(method, catch, js_name = nextForward)]
	fn next_forward(this: &MultilineHost, context: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = forwardMatch)]
	fn forward_match(
		this: &MultilineHost,
		context: &JsValue,
		matched: &JsValue,
	) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = startLine)]
	fn start_line(this: &MultilineHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = startColumn)]
	fn start_column(this: &MultilineHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = retryForward)]
	fn retry_forward(this: &MultilineHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = previousMatches)]
	fn previous_matches(this: &MultilineHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = length)]
	fn length(this: &MultilineHost, matches: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = positive)]
	fn positive(this: &MultilineHost, value: &JsValue) -> Result<bool, JsValue>;
	#[wasm_bindgen(method, catch, js_name = lastMatch)]
	fn last_match(this: &MultilineHost, matches: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = lineCount)]
	fn line_count(this: &MultilineHost) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = maxColumn)]
	fn max_column(this: &MultilineHost, count: &JsValue) -> Result<JsValue, JsValue>;
	#[wasm_bindgen(method, catch, js_name = retryPrevious)]
	fn retry_previous(this: &MultilineHost, count: &JsValue) -> Result<JsValue, JsValue>;
}

struct Dispatch(DispatchHost);
impl vscode_editor_core::SearchDispatchHost for Dispatch {
	type Value = JsValue;
	type Error = JsValue;
	fn null(&self) -> JsValue {
		JsValue::NULL
	}
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn empty_result(&self) -> Result<JsValue, JsValue> {
		self.0.empty_result()
	}
	fn parse(&self) -> Result<JsValue, JsValue> {
		self.0.parse()
	}
	fn multiline(&self, data: &JsValue) -> Result<JsValue, JsValue> {
		self.0.multiline(data)
	}
	fn create_searcher(&self, data: &JsValue) -> Result<JsValue, JsValue> {
		self.0.create_searcher(data)
	}
	fn all_multiline(&self, data: &JsValue) -> Result<JsValue, JsValue> {
		self.0.all_multiline(data)
	}
	fn all_lines(&self, data: &JsValue) -> Result<JsValue, JsValue> {
		self.0.all_lines(data)
	}
	fn next_multiline(&self, searcher: &JsValue) -> Result<JsValue, JsValue> {
		self.0.next_multiline(searcher)
	}
	fn next_lines(&self, searcher: &JsValue) -> Result<JsValue, JsValue> {
		self.0.next_lines(searcher)
	}
	fn previous_multiline(&self, searcher: &JsValue) -> Result<JsValue, JsValue> {
		self.0.previous_multiline(searcher)
	}
	fn previous_lines(&self, searcher: &JsValue) -> Result<JsValue, JsValue> {
		self.0.previous_lines(searcher)
	}
}

struct Navigation(MultilineHost);
impl vscode_editor_core::MultilineNavigationHost for Navigation {
	type Value = JsValue;
	type Error = JsValue;
	fn null(&self) -> JsValue {
		JsValue::NULL
	}
	fn number(&self, value: f64) -> JsValue {
		JsValue::from_f64(value)
	}
	fn equal(&self, first: &JsValue, second: &JsValue) -> bool {
		first == second
	}
	fn truthy(&self, value: &JsValue) -> bool {
		value.is_truthy()
	}
	fn positive(&self, value: &JsValue) -> Result<bool, JsValue> {
		if let Some(value) = value.as_f64() {
			return Ok(value > 0.0);
		}
		self.0.positive(value)
	}
	fn prepare_forward(&self) -> Result<JsValue, JsValue> {
		self.0.prepare_forward()
	}
	fn reset_forward(&self) -> Result<(), JsValue> {
		self.0.reset_forward()
	}
	fn next_forward(&self, context: &JsValue) -> Result<JsValue, JsValue> {
		self.0.next_forward(context)
	}
	fn forward_match(&self, context: &JsValue, matched: &JsValue) -> Result<JsValue, JsValue> {
		self.0.forward_match(context, matched)
	}
	fn start_line(&self) -> Result<JsValue, JsValue> {
		self.0.start_line()
	}
	fn start_column(&self) -> Result<JsValue, JsValue> {
		self.0.start_column()
	}
	fn retry_forward(&self) -> Result<JsValue, JsValue> {
		self.0.retry_forward()
	}
	fn previous_matches(&self) -> Result<JsValue, JsValue> {
		self.0.previous_matches()
	}
	fn length(&self, matches: &JsValue) -> Result<JsValue, JsValue> {
		self.0.length(matches)
	}
	fn last_match(&self, matches: &JsValue) -> Result<JsValue, JsValue> {
		self.0.last_match(matches)
	}
	fn line_count(&self) -> Result<JsValue, JsValue> {
		self.0.line_count()
	}
	fn max_column(&self, count: &JsValue) -> Result<JsValue, JsValue> {
		self.0.max_column(count)
	}
	fn retry_previous(&self, count: &JsValue) -> Result<JsValue, JsValue> {
		self.0.retry_previous(count)
	}
}

/// Dispatches an original public search and returns its original array/match/null result.
#[wasm_bindgen]
pub fn dispatch_text_search(host: DispatchHost, operation: u32) -> Result<JsValue, JsValue> {
	use vscode_editor_core::SearchDispatchOperation;
	let operation = match operation {
		0 => SearchDispatchOperation::All,
		1 => SearchDispatchOperation::Next,
		2 => SearchDispatchOperation::Previous,
		_ => {
			return Err(JsValue::from_str(
				"Unsupported public text search operation",
			));
		}
	};
	vscode_editor_core::dispatch_text_search(&Dispatch(host), operation)
}

/// Navigates multiline results, retaining original virtual retry and model-provider behavior.
#[wasm_bindgen]
pub fn navigate_text_search_multiline(
	host: MultilineHost,
	previous: bool,
) -> Result<JsValue, JsValue> {
	let host = Navigation(host);
	if previous {
		vscode_editor_core::previous_multiline_search_match(&host)
	} else {
		vscode_editor_core::next_multiline_search_match(&host)
	}
}
