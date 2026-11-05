/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../src/vs/base/common/lifecycle.js';
import { URI } from '../../src/vs/base/common/uri.js';
import { WebWorkerDescriptor } from '../../src/vs/platform/webWorker/browser/webWorkerDescriptor.js';
import { WebWorkerService } from '../../src/vs/platform/webWorker/browser/webWorkerServiceImpl.js';
import { IRustTextBufferInitialization } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { IModelChangedEvent } from '../../src/vs/editor/common/model/mirrorTextModel.js';
import { IRawModelData } from '../../src/vs/editor/common/services/textModelSync/textModelSync.protocol.js';
import { TestEditorWorker } from './testEditorWorker.js';

/** Exercises the production browser transport, bootstrap, and editor worker protocol. */
export async function inspectBrowserWorker(initialization: IRustTextBufferInitialization, data: IRawModelData, event: IModelChangedEvent, offsets: number[], mode: 'normal' | 'failed' | 'disposed') {
	const store = new DisposableStore();
	try {
		const service = new WebWorkerService();
		const client = store.add(service.createWorkerClient<TestEditorWorker>(new WebWorkerDescriptor({
			esmModuleLocation: URI.parse(new URL('browserEditorWorkerRealm.mjs', initialization.moduleUrl).href),
			label: 'Rust Editor Compatibility'
		})));
		const initializing = client.proxy.$initializeRustTextBuffer(initialization);
		if (mode === 'disposed') {
			await client.proxy.$disposeWorker();
			await initializing;
			return await client.proxy.$inspectRealm();
		}
		let initializationFailed = false;
		try {
			await initializing;
		} catch (error) {
			if (mode !== 'failed') {
				throw error;
			}
			initializationFailed = true;
		}
		await client.proxy.$acceptNewModel(data);
		await client.proxy.$acceptModelChanged(data.url, event);
		const state = await client.proxy.$inspectModel(data.url, offsets);
		await client.proxy.$acceptRemovedModel(data.url);
		const removed = await client.proxy.$inspectModel(data.url, []);
		await client.proxy.$disposeWorker();
		return { state, removed, initializationFailed, disposed: await client.proxy.$inspectRealm() };
	} finally {
		store.dispose();
	}
}
