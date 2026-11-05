/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Platform-independent editor algorithms. Text coordinates use UTF-16 code units.

mod model_edits;
mod search;
mod sequence_diff;
mod text_buffer;
mod text_change;
mod text_chunk;
mod tree;

pub use model_edits::{
	MAX_MODEL_EDIT_UNITS, MAX_MODEL_EDITS, ModelEdit, ModelEditOptions, ModelTextFlags,
	PreparedModelEdit, PreparedModelEdits, prepare_model_edits,
};
pub use sequence_diff::{
	CharacterDiffOptions, CharacterDiffResult, CharacterSequence, DetailedLineDiff,
	DocumentDiffOptions, DocumentDiffResult, LineDiffResult, LineEqualityScores,
	MAX_DYNAMIC_DIFF_CELLS, MovedBlockDiff, OptimizationSequence, SequenceDiff, SequenceDiffError,
	SequenceDiffResult, TextRange, compute_document_diff, compute_moved_lines,
	dynamic_programming_diff, myers_diff, optimize_sequence_diffs, refine_character_diff,
	refine_line_diff,
};
pub use text_buffer::{BufferError, Position, TextBuffer, TextEdit, TextSnapshot};
pub use text_change::{CompressedTextChange, TextChange, UndoChangeBatch, compress_text_changes};
pub use text_chunk::{TextChunk, TextChunkIter};
