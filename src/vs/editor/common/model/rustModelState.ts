/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ownRustBracketNumericState, releaseRustBracketNumericState, RustBracketNumericStateKind } from './bracketPairsTextModelPart/bracketPairsTree/rustBracketNodeMetadata.js';

/** Construction-time ownership keeps every model/service/observer reference on the same facade. */
export function ownRustTextModel<T extends object>(instance: T): T {
	return ownRustBracketNumericState(instance, RustBracketNumericStateKind.TextModel);
}

/** Successful disposal materializes compatible retained fields and releases the native record. */
export function releaseRustTextModel(instance: object): void {
	releaseRustBracketNumericState(instance);
}
