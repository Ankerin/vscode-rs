/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getRustTextBufferInitialization } from '../../src/vs/editor/common/model/rustTextBuffer/rustTextBuffer.js';
import { EditorWorker } from '../../src/vs/editor/common/services/editorWebWorker.js';

/** Inspects real mirrored models in isolated Node and browser workers. */
export class TestEditorWorker extends EditorWorker {
	public $inspectModel(uri: string, offsets: number[]) {
		const model = this._getModel(uri);
		return model ? {
			text: model.getValue(),
			lines: model.getLinesContent(),
			version: model.version,
			eol: model.eol,
			positions: offsets.map(offset => model.positionAt(offset)),
			rustInitialized: !!getRustTextBufferInitialization()
		} : null;
	}

	public $disposeWorker(): void { this.dispose(); }

	public $inspectRealm() {
		return { rustInitialized: !!getRustTextBufferInitialization(), models: this.getModels().length };
	}
}
