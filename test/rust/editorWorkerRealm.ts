/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parentPort } from 'node:worker_threads';
import { WebWorkerServer } from '../../src/vs/base/common/worker/webWorker.js';
import { TestEditorWorker } from './testEditorWorker.js';

if (!parentPort) {
	throw new Error('The editor worker fixture requires an isolated worker thread');
}
const port = parentPort;
const server = new WebWorkerServer(msg => port.postMessage(msg), () => new TestEditorWorker());
port.on('message', message => server.onmessage(message));
port.on('close', () => server.requestHandler.dispose());
