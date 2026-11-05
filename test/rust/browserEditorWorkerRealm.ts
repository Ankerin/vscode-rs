/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { bootstrapWebWorker } from '../../src/vs/base/common/worker/webWorkerBootstrap.js';
import { TestEditorWorker } from './testEditorWorker.js';

bootstrapWebWorker(() => new TestEditorWorker());
