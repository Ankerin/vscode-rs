/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import { URI } from '../../src/vs/base/common/uri.js';
import { Range } from '../../src/vs/editor/common/core/range.js';
import { IModelChangedEvent } from '../../src/vs/editor/common/model/mirrorTextModel.js';
import { MirrorModel } from '../../src/vs/editor/common/services/textModelSync/textModelSync.impl.js';
import { EditorWorker } from '../../src/vs/editor/common/services/editorWebWorker.js';
import type { inspectBrowserWorker } from './browserWorkerFixture.js';

test('Chromium workers preserve model parity, initialization failures, and disposal during WASM loading', { timeout: 60000 }, async context => {
	const root = resolve('.build/rust');
	const bindings = resolve('out/vs/editor/common/model/rustTextBuffer');
	const routes = new Map([
		['/browserWorkerFixture.mjs', { path: resolve(root, 'browserWorkerFixture.mjs'), type: 'text/javascript' }],
		['/browserEditorWorkerRealm.mjs', { path: resolve(root, 'browserEditorWorkerRealm.mjs'), type: 'text/javascript' }],
		['/vscode_editor_wasm.js', { path: resolve(bindings, 'vscode_editor_wasm.js'), type: 'text/javascript' }],
		['/vscode_editor_wasm_bg.wasm', { path: resolve(bindings, 'vscode_editor_wasm_bg.wasm'), type: 'application/wasm' }]
	]);
	const server = createServer(async (request, response) => {
		const path = new URL(request.url ?? '/', 'http://localhost').pathname;
		if (path === '/') {
			response.writeHead(200, { 'Content-Type': 'text/html' });
			response.end('<!doctype html><html lang="en"><title>Rust Editor Worker Compatibility</title></html>');
			return;
		}
		const route = routes.get(path);
		if (!route) {
			response.writeHead(404);
			response.end();
			return;
		}
		try {
			const bytes = await readFile(route.path);
			response.writeHead(200, { 'Content-Type': route.type });
			response.end(bytes);
		} catch {
			response.writeHead(500);
			response.end();
		}
	});
	context.after(() => new Promise<void>((complete, reject) => server.close(error => error ? reject(error) : complete())));
	await new Promise<void>((complete, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', complete);
	});
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('The browser fixture requires a local TCP address');
	}
	const origin = `http://127.0.0.1:${address.port}`;
	const browser = await chromium.launch({ headless: true });
	context.after(() => browser.close());
	const page = await browser.newPage();
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.goto(origin);
	const data = { url: 'test:browser', lines: ['one\uD800', 'two\uDC00', 'tail\uD83D\uDE00'], EOL: '\r\n', versionId: 1 };
	const event: IModelChangedEvent = {
		eol: '\n', versionId: 2, isUndoing: false, isRedoing: false,
		changes: [{ range: new Range(2, 1, 2, 4), rangeOffset: 6, rangeLength: 3, text: 'new\nline' }]
	};
	const offsets = [0, 1, 5, 6, 10, 100];
	const reference = new MirrorModel(URI.parse(data.url), data.lines.slice(), data.EOL, data.versionId);
	context.after(() => reference.dispose());
	reference.onEvents(event);
	const referenceWorker = new EditorWorker();
	context.after(() => referenceWorker.dispose());
	const diffs = await Promise.all([0, 30000].map(maxComputationTimeMs => referenceWorker.$computeStringDiff('a a'.repeat(256), 'b b'.repeat(256), { maxComputationTimeMs }, 'advanced')));
	for (const mode of ['normal', 'failed', 'disposed'] as const) {
		const wasmUrl = `${origin}/${mode === 'failed' ? 'missing.wasm' : 'vscode_editor_wasm_bg.wasm'}`;
		if (mode === 'disposed') {
			await page.route(wasmUrl, async route => {
				// Delay the real response so disposal reaches the worker during initialization.
				await new Promise(complete => setTimeout(complete, 100));
				await route.continue();
			});
		}
		const actual = await page.evaluate(async args => {
			const fixture = await import(`${args.origin}/browserWorkerFixture.mjs`) as { inspectBrowserWorker: typeof inspectBrowserWorker };
			return Promise.race([
				fixture.inspectBrowserWorker({ moduleUrl: `${args.origin}/vscode_editor_wasm.js`, wasmUrl: args.wasmUrl }, args.data, args.event, args.offsets, args.mode),
				new Promise<never>((_complete, reject) => setTimeout(() => reject(new Error('The browser worker did not respond')), 10000))
			]);
		}, { origin, wasmUrl, data, event, offsets, mode });
		assert.deepStrictEqual(actual, mode === 'disposed' ? { rustInitialized: false, models: 0 } : {
			state: {
				text: reference.getValue(), lines: reference.getLinesContent(), version: reference.version, eol: reference.eol,
				positions: offsets.map(offset => reference.positionAt(offset)), rustInitialized: mode === 'normal'
			},
			diffs, removed: null, initializationFailed: mode === 'failed', disposed: { rustInitialized: false, models: 0 }
		});
	}
	assert.deepStrictEqual(errors, []);
});
