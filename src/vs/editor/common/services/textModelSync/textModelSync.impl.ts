/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IntervalTimer } from '../../../../base/common/async.js';
import { Disposable, DisposableStore, dispose, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IWebWorkerClient, IWebWorkerServer } from '../../../../base/common/worker/webWorker.js';
import { IPosition, Position } from '../../core/position.js';
import { IRange, Range } from '../../core/range.js';
import { ensureValidWordDefinition, getWordAtText, IWordAtPosition } from '../../core/wordHelper.js';
import { IDocumentColorComputerTarget } from '../../languages/defaultDocumentColorsComputer.js';
import { ILinkComputerTarget } from '../../languages/linkComputer.js';
import { MirrorTextModel as BaseMirrorModel, IModelChangedEvent } from '../../model/mirrorTextModel.js';
import { createRegisteredTextBufferStorageFromLines, ITextBufferStorage } from '../../model/rustTextBuffer/textBufferStorage.js';
import { IMirrorModel, IWordRange } from '../editorWebWorker.js';
import { IModelService } from '../model.js';
import { IRawModelData, IWorkerTextModelSyncChannelServer } from './textModelSync.protocol.js';

/**
 * Stop syncing a model to the worker if it was not needed for 1 min.
 */
export const STOP_SYNC_MODEL_DELTA_TIME_MS = 60 * 1000;

export const WORKER_TEXT_MODEL_SYNC_CHANNEL = 'workerTextModelSync';

export class WorkerTextModelSyncClient extends Disposable {

	public static create(workerClient: IWebWorkerClient<unknown>, modelService: IModelService): WorkerTextModelSyncClient {
		return new WorkerTextModelSyncClient(
			workerClient.getChannel<IWorkerTextModelSyncChannelServer>(WORKER_TEXT_MODEL_SYNC_CHANNEL),
			modelService
		);
	}

	private readonly _proxy: IWorkerTextModelSyncChannelServer;
	private readonly _modelService: IModelService;
	private _syncedModels: { [modelUrl: string]: IDisposable } = Object.create(null);
	private _syncedModelsLastUsedTime: { [modelUrl: string]: number } = Object.create(null);

	constructor(proxy: IWorkerTextModelSyncChannelServer, modelService: IModelService, keepIdleModels: boolean = false) {
		super();
		this._proxy = proxy;
		this._modelService = modelService;

		if (!keepIdleModels) {
			const timer = new IntervalTimer();
			timer.cancelAndSet(() => this._checkStopModelSync(), Math.round(STOP_SYNC_MODEL_DELTA_TIME_MS / 2));
			this._register(timer);
		}
	}

	public override dispose(): void {
		for (const modelUrl in this._syncedModels) {
			dispose(this._syncedModels[modelUrl]);
		}
		this._syncedModels = Object.create(null);
		this._syncedModelsLastUsedTime = Object.create(null);
		super.dispose();
	}

	public ensureSyncedResources(resources: URI[], forceLargeModels: boolean = false): void {
		for (const resource of resources) {
			const resourceStr = resource.toString();

			if (!this._syncedModels[resourceStr]) {
				this._beginModelSync(resource, forceLargeModels);
			}
			if (this._syncedModels[resourceStr]) {
				this._syncedModelsLastUsedTime[resourceStr] = (new Date()).getTime();
			}
		}
	}

	private _checkStopModelSync(): void {
		const currentTime = (new Date()).getTime();

		const toRemove: string[] = [];
		for (const modelUrl in this._syncedModelsLastUsedTime) {
			const elapsedTime = currentTime - this._syncedModelsLastUsedTime[modelUrl];
			if (elapsedTime > STOP_SYNC_MODEL_DELTA_TIME_MS) {
				toRemove.push(modelUrl);
			}
		}

		for (const e of toRemove) {
			this._stopModelSync(e);
		}
	}

	private _beginModelSync(resource: URI, forceLargeModels: boolean): void {
		const model = this._modelService.getModel(resource);
		if (!model) {
			return;
		}
		if (!forceLargeModels && model.isTooLargeForSyncing()) {
			return;
		}

		const modelUrl = resource.toString();

		this._proxy.$acceptNewModel({
			url: model.uri.toString(),
			lines: model.getLinesContent(),
			EOL: model.getEOL(),
			versionId: model.getVersionId()
		});

		const toDispose = new DisposableStore();
		toDispose.add(model.onDidChangeContent((e) => {
			this._proxy.$acceptModelChanged(modelUrl.toString(), e);
		}));
		toDispose.add(model.onWillDispose(() => {
			this._stopModelSync(modelUrl);
		}));
		toDispose.add(toDisposable(() => {
			this._proxy.$acceptRemovedModel(modelUrl);
		}));

		this._syncedModels[modelUrl] = toDispose;
	}

	private _stopModelSync(modelUrl: string): void {
		const toDispose = this._syncedModels[modelUrl];
		delete this._syncedModels[modelUrl];
		delete this._syncedModelsLastUsedTime[modelUrl];
		dispose(toDispose);
	}
}

export class WorkerTextModelSyncServer implements IWorkerTextModelSyncChannelServer, IDisposable {

	private readonly _models: { [uri: string]: MirrorModel };

	constructor() {
		this._models = Object.create(null);
	}

	public dispose(): void {
		for (const uri of Object.keys(this._models)) {
			this.$acceptRemovedModel(uri);
		}
	}

	public bindToServer(workerServer: IWebWorkerServer): void {
		workerServer.setChannel(WORKER_TEXT_MODEL_SYNC_CHANNEL, this);
	}

	public getModel(uri: string): ICommonModel | undefined {
		return this._models[uri];
	}

	public getModels(): ICommonModel[] {
		const all: MirrorModel[] = [];
		Object.keys(this._models).forEach((key) => all.push(this._models[key]));
		return all;
	}

	$acceptNewModel(data: IRawModelData): void {
		this.$acceptRemovedModel(data.url);
		this._models[data.url] = new MirrorModel(URI.parse(data.url), data.lines, data.EOL, data.versionId);
	}

	$acceptModelChanged(uri: string, e: IModelChangedEvent): void {
		if (!this._models[uri]) {
			return;
		}
		const model = this._models[uri];
		model.onEvents(e);
	}

	$acceptRemovedModel(uri: string): void {
		if (!this._models[uri]) {
			return;
		}
		this._models[uri].dispose();
		delete this._models[uri];
	}
}

export class MirrorModel extends BaseMirrorModel implements ICommonModel {

	private _storage: (ITextBufferStorage & IDisposable) | undefined;
	private _cachedStorageText: string | null = null;

	constructor(uri: URI, lines: string[], eol: string, versionId: number) {
		const storage = eol === '\n' || eol === '\r\n' ? createRegisteredTextBufferStorageFromLines(lines, eol) : undefined;
		super(uri, storage ? [] : lines, eol, versionId);
		this._storage = storage;
	}

	public override dispose(): void {
		this._storage?.dispose();
		this._storage = undefined;
		this._cachedStorageText = null;
		super.dispose();
	}

	public override getText(): string {
		if (!this._storage) {
			return super.getText();
		}
		if (this._cachedStorageText === null) {
			const lineCount = this.getLineCount();
			this._cachedStorageText = this._storage.getValueInRange(new Range(1, 1, lineCount, this._storage.getLineLength(lineCount) + 1));
		}
		return this._cachedStorageText;
	}

	public override onEvents(event: IModelChangedEvent): void {
		if (!this._storage) {
			super.onEvents(event);
			return;
		}
		if (event.eol && event.eol !== this._eol) {
			if (event.eol !== '\n' && event.eol !== '\r\n') {
				this._lines = this._storage.getLinesContent();
				this._storage.dispose();
				this._storage = undefined;
				this._cachedStorageText = null;
				super.onEvents(event);
				return;
			}
			this._storage.setEOL(event.eol);
			this._eol = event.eol;
		}
		// Mirror events are replayed sequentially, including events with dependent ranges.
		for (const change of event.changes) {
			const start = this._storage.getOffsetAt(change.range.startLineNumber, change.range.startColumn);
			const end = this._storage.getOffsetAt(change.range.endLineNumber, change.range.endColumn);
			const text = change.text.replace(/\r\n|\r|\n/g, this._eol);
			if (this._storage.applyEdits) {
				this._storage.applyEdits([{ rangeOffset: start, rangeLength: end - start, text }]);
			} else {
				this._storage.delete(start, end - start);
				this._storage.insert(start, text, true);
			}
		}
		this._versionId = event.versionId;
		this._cachedStorageText = null;
	}

	public get uri(): URI {
		return this._uri;
	}

	public get eol(): string {
		return this._eol;
	}

	public getValue(): string {
		return this.getText();
	}

	public findMatches(regex: RegExp): RegExpMatchArray[] {
		const matches = [];
		for (let i = 0; i < this.getLineCount(); i++) {
			const line = this.getLineContent(i + 1);
			const offsetToAdd = this.offsetAt(new Position(i + 1, 1));
			const iteratorOverMatches = line.matchAll(regex);
			for (const match of iteratorOverMatches) {
				if (match.index || match.index === 0) {
					match.index = match.index + offsetToAdd;
				}
				matches.push(match);
			}
		}
		return matches;
	}

	public getLinesContent(): string[] {
		return this._storage ? this._storage.getLinesContent() : this._lines.slice(0);
	}

	public getLineCount(): number {
		return this._storage ? this._storage.getLineCount() : this._lines.length;
	}

	public getLineContent(lineNumber: number): string {
		return this._storage && Number.isInteger(lineNumber) && lineNumber >= 1 && lineNumber <= this.getLineCount() ? this._storage.getLineContent(lineNumber) : this._lines[lineNumber - 1];
	}

	public getWordAtPosition(position: IPosition, wordDefinition: RegExp): Range | null {

		const wordAtText = getWordAtText(
			position.column,
			ensureValidWordDefinition(wordDefinition),
			this.getLineContent(position.lineNumber),
			0
		);

		if (wordAtText) {
			return new Range(position.lineNumber, wordAtText.startColumn, position.lineNumber, wordAtText.endColumn);
		}

		return null;
	}

	public getWordUntilPosition(position: IPosition, wordDefinition: RegExp): IWordAtPosition {
		const wordAtPosition = this.getWordAtPosition(position, wordDefinition);
		if (!wordAtPosition) {
			return {
				word: '',
				startColumn: position.column,
				endColumn: position.column
			};
		}
		return {
			word: this.getLineContent(position.lineNumber).substring(wordAtPosition.startColumn - 1, position.column - 1),
			startColumn: wordAtPosition.startColumn,
			endColumn: position.column
		};
	}


	public words(wordDefinition: RegExp): Iterable<string> {

		const model = this;
		const wordenize = (content: string) => this._wordenize(content, wordDefinition);

		let lineNumber = 0;
		let lineText = '';
		let wordRangesIdx = 0;
		let wordRanges: IWordRange[] = [];

		return {
			*[Symbol.iterator]() {
				while (true) {
					if (wordRangesIdx < wordRanges.length) {
						const value = lineText.substring(wordRanges[wordRangesIdx].start, wordRanges[wordRangesIdx].end);
						wordRangesIdx += 1;
						yield value;
					} else {
						if (lineNumber < model.getLineCount()) {
							lineText = model.getLineContent(lineNumber + 1);
							wordRanges = wordenize(lineText);
							wordRangesIdx = 0;
							lineNumber += 1;
						} else {
							break;
						}
					}
				}
			}
		};
	}

	public getLineWords(lineNumber: number, wordDefinition: RegExp): IWordAtPosition[] {
		const content = this.getLineContent(lineNumber);
		const ranges = this._wordenize(content, wordDefinition);
		const words: IWordAtPosition[] = [];
		for (const range of ranges) {
			words.push({
				word: content.substring(range.start, range.end),
				startColumn: range.start + 1,
				endColumn: range.end + 1
			});
		}
		return words;
	}

	private _wordenize(content: string, wordDefinition: RegExp): IWordRange[] {
		const result: IWordRange[] = [];
		let match: RegExpExecArray | null;

		wordDefinition.lastIndex = 0; // reset lastIndex just to be sure

		while (match = wordDefinition.exec(content)) {
			if (match[0].length === 0) {
				// it did match the empty string
				break;
			}
			result.push({ start: match.index, end: match.index + match[0].length });
		}
		return result;
	}

	public getValueInRange(range: IRange): string {
		range = this._validateRange(range);
		if (this._storage && Number.isFinite(range.startColumn) && Number.isFinite(range.endColumn) && (range.startLineNumber < range.endLineNumber || (range.startLineNumber === range.endLineNumber && range.startColumn <= range.endColumn))) {
			return this._storage.getValueInRange(Range.lift(range));
		}

		if (range.startLineNumber === range.endLineNumber) {
			return this.getLineContent(range.startLineNumber).substring(range.startColumn - 1, range.endColumn - 1);
		}

		const lineEnding = this._eol;
		const startLineIndex = range.startLineNumber - 1;
		const endLineIndex = range.endLineNumber - 1;
		const resultLines: string[] = [];

		resultLines.push(this.getLineContent(startLineIndex + 1).substring(range.startColumn - 1));
		for (let i = startLineIndex + 1; i < endLineIndex; i++) {
			resultLines.push(this.getLineContent(i + 1));
		}
		resultLines.push(this.getLineContent(endLineIndex + 1).substring(0, range.endColumn - 1));

		return resultLines.join(lineEnding);
	}

	public offsetAt(position: IPosition): number {
		position = this._validatePosition(position);
		if (this._storage) {
			return this._storage.getOffsetAt(position.lineNumber, 1) + (position.column - 1);
		}
		this._ensureLineStarts();
		return this._lineStarts!.getPrefixSum(position.lineNumber - 2) + (position.column - 1);
	}

	public positionAt(offset: number): IPosition {
		offset = Math.floor(offset);
		offset = Math.max(0, offset);
		if (this._storage) {
			if (Number.isNaN(offset)) {
				// Preserve the prefix-sum reference's invalid-offset result instead of coercing NaN to zero.
				return { lineNumber: 1 + Math.floor((this.getLineCount() - 1) / 2), column: Number.NaN };
			}
			const position = this._storage.getPositionAt(offset);
			return { lineNumber: position.lineNumber, column: Math.min(position.column, this._storage.getLineLength(position.lineNumber) + 1) };
		}

		this._ensureLineStarts();
		const out = this._lineStarts!.getIndexOf(offset);
		const lineLength = this._lines[out.index].length;

		// Ensure we return a valid position
		return {
			lineNumber: 1 + out.index,
			column: 1 + Math.min(out.remainder, lineLength)
		};
	}

	private _validateRange(range: IRange): IRange {

		const start = this._validatePosition({ lineNumber: range.startLineNumber, column: range.startColumn });
		const end = this._validatePosition({ lineNumber: range.endLineNumber, column: range.endColumn });

		if (start.lineNumber !== range.startLineNumber
			|| start.column !== range.startColumn
			|| end.lineNumber !== range.endLineNumber
			|| end.column !== range.endColumn) {

			return {
				startLineNumber: start.lineNumber,
				startColumn: start.column,
				endLineNumber: end.lineNumber,
				endColumn: end.column
			};
		}

		return range;
	}

	private _validatePosition(position: IPosition): IPosition {
		if (!Position.isIPosition(position)) {
			throw new Error('bad position');
		}
		let { lineNumber, column } = position;
		let hasChanged = false;

		if (lineNumber < 1) {
			lineNumber = 1;
			column = 1;
			hasChanged = true;

		} else if (lineNumber > this.getLineCount()) {
			lineNumber = this.getLineCount();
			column = this.getLineContent(lineNumber).length + 1;
			hasChanged = true;

		} else {
			const maxCharacter = this.getLineContent(lineNumber).length + 1;
			if (column < 1) {
				column = 1;
				hasChanged = true;
			}
			else if (column > maxCharacter) {
				column = maxCharacter;
				hasChanged = true;
			}
		}

		if (!hasChanged) {
			return position;
		} else {
			return { lineNumber, column };
		}
	}
}

export interface ICommonModel extends ILinkComputerTarget, IDocumentColorComputerTarget, IMirrorModel {
	uri: URI;
	version: number;
	eol: string;
	getValue(): string;

	getLinesContent(): string[];
	getLineCount(): number;
	getLineContent(lineNumber: number): string;
	getLineWords(lineNumber: number, wordDefinition: RegExp): IWordAtPosition[];
	words(wordDefinition: RegExp): Iterable<string>;
	getWordUntilPosition(position: IPosition, wordDefinition: RegExp): IWordAtPosition;
	getValueInRange(range: IRange): string;
	getWordAtPosition(position: IPosition, wordDefinition: RegExp): Range | null;
	offsetAt(position: IPosition): number;
	positionAt(offset: number): IPosition;
	findMatches(regex: RegExp): RegExpMatchArray[];
}
