/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { test, TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { Emitter } from '../../src/vs/base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../src/vs/base/common/lifecycle.js';
import { URI } from '../../src/vs/base/common/uri.js';
import { IWebWorker, Message, WebWorkerClient } from '../../src/vs/base/common/worker/webWorker.js';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { EndOfLineSequence } from '../../src/vs/editor/common/model.js';
import { IModelChangedEvent } from '../../src/vs/editor/common/model/mirrorTextModel.js';
import { getRustTextBufferInitialization, IRustTextBufferModule, registerRustTextBuffer } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { EditorWorker } from '../../src/vs/editor/common/services/editorWebWorker.js';
import { MirrorModel } from '../../src/vs/editor/common/services/textModelSync/textModelSync.impl.js';
import { createTextModel } from '../../src/vs/editor/test/common/testTextModel.js';

interface IRustModule extends IRustTextBufferModule {
	default(options: { module_or_path: Uint8Array }): Promise<object>;
}

const directory = resolve('out/vs/editor/common/model/rustTextBuffer');
const moduleUrl = pathToFileURL(resolve(directory, 'vscode_editor_wasm.js')).href;
const rust = await import(moduleUrl) as IRustModule;
await rust.default({ module_or_path: await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm')) });

class InspectedMirrorModel extends MirrorModel {
	public getRetainedLineCount(): number { return this._lines.length; }
}

function createPair(context: TestContext, lines: string[], eol: string = '\n'): [InspectedMirrorModel, InspectedMirrorModel] {
	const disposables = new DisposableStore();
	context.after(() => disposables.dispose());
	const uri = URI.parse('test:mirror');
	const reference = disposables.add(new InspectedMirrorModel(uri, lines.slice(), eol, 1));
	const registration = registerRustTextBuffer(rust);
	try {
		return [reference, disposables.add(new InspectedMirrorModel(uri, lines.slice(), eol, 1))];
	} finally {
		registration.dispose();
	}
}

function compare(reference: MirrorModel, actual: MirrorModel): void {
	const state = (model: MirrorModel) => ({ text: model.getText(), lines: model.getLinesContent(), eol: model.eol, version: model.version });
	assert.deepStrictEqual(state(actual), state(reference));
	if (reference.getLineCount() === 0) {
		return;
	}
	for (const offset of [-1, 0, 1.5, reference.getValue().length, Number.MAX_VALUE, Number.NaN]) {
		assert.deepStrictEqual(actual.positionAt(offset), reference.positionAt(offset));
	}
	for (let line = 1; line <= reference.getLineCount(); line++) {
		for (const column of [-1, 1, 1.5, Number.NaN, Number.MAX_VALUE]) {
			assert.strictEqual(actual.offsetAt({ lineNumber: line, column }), reference.offsetAt({ lineNumber: line, column }));
		}
	}
}

test('Rust mirror models retain UTF-16 coordinates, CRLF interior clamping, BOM, and range behavior', context => {
	for (const eol of ['\n', '\r\n']) {
		const [reference, actual] = createPair(context, ['\uFEFFone\uD800', 'two\uDC00', '', 'tail\uD83D\uDE00'], eol);
		assert.strictEqual(actual.getRetainedLineCount(), 0);
		compare(reference, actual);
		for (let offset = 0; offset <= reference.getValue().length + 2; offset++) {
			assert.deepStrictEqual(actual.positionAt(offset), reference.positionAt(offset));
		}
		for (const range of [
			new Range(1, 1, 4, 7),
			new Range(-10, -10, 100, 100),
			{ startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 2 },
			{ startLineNumber: 3, startColumn: 1, endLineNumber: 1, endColumn: 3 },
			{ startLineNumber: 1, startColumn: Number.NaN, endLineNumber: 4, endColumn: 2 }
		]) {
			assert.strictEqual(actual.getValueInRange(range), reference.getValueInRange(range));
		}
	}
});

test('Rust mirror models preserve sequential events and nonstandard mirror input compatibility', context => {
	for (const lines of [[], ['embedded\nline', 'tail'], ['one', 'two']]) {
		const [reference, actual] = createPair(context, lines);
		compare(reference, actual);
	}
	const [reference, actual] = createPair(context, ['one', 'two']);
	for (const event of [
		{
			eol: '\r\n', versionId: 2, isUndoing: false, isRedoing: false,
			changes: [
				{ range: new Range(1, 2, 1, 2), rangeOffset: 1, rangeLength: 0, text: 'new\rline\n' },
				{ range: new Range(2, 1, 2, 3), rangeOffset: 0, rangeLength: 2, text: '\uDFFF' }
			]
		},
		{ eol: '\r', versionId: 3, isUndoing: false, isRedoing: false, changes: [] },
		{ eol: '\n', versionId: 4, isUndoing: false, isRedoing: false, changes: [] }
	]) {
		reference.onEvents(event);
		actual.onEvents(event);
		compare(reference, actual);
	}
});

test('Rust mirror models replay seeded real-model edits, EOL changes, undo, and redo', async context => {
	const disposables = new DisposableStore();
	context.after(() => disposables.dispose());
	const model = disposables.add(createTextModel('one\uD800\r\ntwo\uDC00\r\n'.repeat(128)));
	const [reference, actual] = createPair(context, model.getLinesContent(), model.getEOL());
	disposables.add(model.onDidChangeContent(event => {
		reference.onEvents(event);
		actual.onEvents(event);
	}));
	let seed = 42;
	const random = (limit: number) => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed % limit;
	};
	for (let iteration = 0; iteration < 512; iteration++) {
		const length = model.getValueLength();
		const offset = random(length + 1);
		const start = model.getPositionAt(offset);
		const end = model.getPositionAt(Math.min(length, offset + random(17)));
		model.applyEdits([{ range: Range.fromPositions(start, end), text: ['inserted', '\r\n', '\uD800', '\uDC00', '', 'one\nline'][random(6)] }]);
		if (iteration % 32 === 0) {
			model.setEOL(iteration % 64 === 0 ? EndOfLineSequence.LF : EndOfLineSequence.CRLF);
			compare(reference, actual);
		}
	}
	model.pushStackElement();
	model.pushEditOperations(null, [{ range: new Range(1, 1, 1, 1), text: 'undo\nredo' }], () => null);
	model.pushStackElement();
	await model.undo();
	compare(reference, actual);
	await model.redo();
	compare(reference, actual);
});

test('Rust mirror word and regex consumers observe current lines and immutable returned arrays', context => {
	const [reference, actual] = createPair(context, ['one two', 'three four', 'five']);
	const before = actual.getLinesContent();
	const event: IModelChangedEvent = {
		eol: '\n', versionId: 2, isUndoing: false, isRedoing: false,
		changes: [{ range: new Range(2, 1, 2, 6), rangeOffset: 8, rangeLength: 5, text: 'new' }]
	};
	reference.onEvents(event);
	actual.onEvents(event);
	assert.deepStrictEqual(before, ['one two', 'three four', 'five']);
	assert.deepStrictEqual(Array.from(actual.words(/[a-z]+/g)), Array.from(reference.words(/[a-z]+/g)));
	assert.deepStrictEqual(actual.findMatches(/\w+/g), reference.findMatches(/\w+/g));
	for (let line = 1; line <= reference.getLineCount(); line++) {
		assert.deepStrictEqual(actual.getLineWords(line, /[a-z]+/g), reference.getLineWords(line, /[a-z]+/g));
		assert.deepStrictEqual(actual.getWordAtPosition({ lineNumber: line, column: 2 }, /[a-z]+/g), reference.getWordAtPosition({ lineNumber: line, column: 2 }, /[a-z]+/g));
		assert.deepStrictEqual(actual.getWordUntilPosition({ lineNumber: line, column: 2 }, /[a-z]+/g), reference.getWordUntilPosition({ lineNumber: line, column: 2 }, /[a-z]+/g));
	}
});

test('Rust mirror storage is freed on replacement, removal, and editor worker disposal', context => {
	let freed = 0;
	class TrackedBuffer extends rust.WasmTextBuffer {
		public override free(): void {
			freed++;
			super.free();
		}
	}
	const registration = registerRustTextBuffer({ ...rust, WasmTextBuffer: TrackedBuffer });
	context.after(() => registration.dispose());
	const worker = new EditorWorker();
	context.after(() => worker.dispose());
	const data = { url: 'test:mirror', lines: ['\uD800'], EOL: '\n', versionId: 1 };
	worker.$acceptNewModel(data);
	worker.$acceptNewModel(data);
	worker.$acceptRemovedModel(data.url);
	worker.$acceptNewModel(data);
	worker.dispose();
	worker.dispose();
	assert.deepStrictEqual({ freed, models: worker.getModels() }, { freed: 3, models: [] });
	assert.strictEqual(getRustTextBufferInitialization(), undefined);
});

class NodeWorkerTransport extends Disposable implements IWebWorker {
	private readonly _onMessage = this._register(new Emitter<Message>());
	private readonly _onError = this._register(new Emitter<Error>());
	public readonly onMessage = this._onMessage.event;
	public readonly onError = this._onError.event;
	private readonly _worker: Worker;

	constructor() {
		super();
		this._worker = new Worker(pathToFileURL(resolve('.build/rust/editorWorkerRealm.mjs')));
		this._register(toDisposable(() => { void this._worker.terminate(); }));
		this._worker.on('message', (message: Message) => this._onMessage.fire(message));
		this._worker.on('error', (error: Error) => this._onError.fire(error));
	}

	public getId(): number { return 1; }
	public postMessage(message: Message, transfer: ArrayBuffer[]): void { this._worker.postMessage(message, transfer); }
}

interface IWorkerState {
	text: string;
	lines: string[];
	version: number;
	eol: string;
	positions: { lineNumber: number; column: number }[];
	rustInitialized: boolean;
}

interface ITestEditorWorker extends EditorWorker {
	$inspectModel(uri: string, offsets: number[]): IWorkerState | null;
}

test('An isolated editor worker initializes Rust before mirror synchronization over the existing protocol', { timeout: 30000 }, async context => {
	const bytes = await readFile(resolve(directory, 'vscode_editor_wasm_bg.wasm'));
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'Content-Type': 'application/wasm' });
		response.end(bytes);
	});
	context.after(() => new Promise<void>((complete, reject) => server.close(error => error ? reject(error) : complete())));
	await new Promise<void>((complete, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', complete);
	});
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('The fixture requires a local TCP address');
	}
	const client = new WebWorkerClient<ITestEditorWorker>(new NodeWorkerTransport());
	context.after(() => client.dispose());
	await client.proxy.$initializeRustTextBuffer({ moduleUrl, wasmUrl: `http://127.0.0.1:${address.port}/editor.wasm` });
	const data = { url: 'test:isolated', lines: ['one\uD800', 'two\uDC00'], EOL: '\r\n', versionId: 1 };
	await client.proxy.$acceptNewModel(data);
	const event: IModelChangedEvent = {
		eol: '\n', versionId: 2, isUndoing: false, isRedoing: false,
		changes: [{ range: new Range(2, 1, 2, 4), rangeOffset: 6, rangeLength: 3, text: 'new\nline' }]
	};
	await client.proxy.$acceptModelChanged(data.url, event);
	const reference = new MirrorModel(URI.parse(data.url), data.lines.slice(), data.EOL, data.versionId);
	context.after(() => reference.dispose());
	reference.onEvents(event);
	const offsets = [0, 1, 5, 6, 10, 100];
	assert.deepStrictEqual(await client.proxy.$inspectModel(data.url, offsets), {
		text: reference.getValue(), lines: reference.getLinesContent(), version: reference.version, eol: reference.eol,
		positions: offsets.map(offset => reference.positionAt(offset)), rustInitialized: true
	});
	await client.proxy.$acceptRemovedModel(data.url);
	assert.strictEqual(await client.proxy.$inspectModel(data.url, []), null);
	assert.strictEqual(getRustTextBufferInitialization(), undefined);
});
