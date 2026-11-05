/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Platform-independent editor algorithms. Text coordinates use UTF-16 code units.

mod contiguous_tokens;
mod folding;
mod guides;
mod indentation;
mod line_tokens;
mod model_edits;
mod search;
mod sequence_diff;
mod sparse_tokens;
mod text_buffer;
mod text_change;
mod text_chunk;
mod token_array;
mod tokens;
mod tree;

pub use contiguous_tokens::{
	ContiguousTokensUpdate, append_contiguous_tokens, delete_contiguous_tokens,
	insert_contiguous_tokens,
};
pub use folding::{IndentationFoldingRanges, compute_indentation_folding};
pub use guides::{ActiveIndentGuide, compute_active_indent_guide, compute_indent_guides};
pub use indentation::{GuessedIndentation, guess_indentation};
pub use line_tokens::{
	InsertedLineTokens, LineTokenInsertion, convert_line_token_offsets, find_line_token_index,
	insert_line_tokens, line_token_slice, line_tokens_equal, line_tokens_in_range,
};
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
pub use sparse_tokens::{
	SparseTokenEdit, SparseTokensUpdate, edit_sparse_tokens, find_sparse_line_tokens,
	remove_sparse_tokens, split_sparse_tokens,
};
pub use text_buffer::{BufferError, Position, TextBuffer, TextEdit, TextSnapshot};
pub use text_change::{CompressedTextChange, TextChange, UndoChangeBatch, compress_text_changes};
pub use text_chunk::{TextChunk, TextChunkIter};
pub use token_array::{create_line_token_array, line_token_array, slice_token_array};
pub use tokens::{TokensError, merge_semantic_tokens};
