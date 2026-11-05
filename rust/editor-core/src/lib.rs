/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Platform-independent editor algorithms. Text coordinates use UTF-16 code units.

mod search;
mod sequence_diff;
mod text_buffer;
mod text_chunk;
mod tree;

pub use sequence_diff::{
	CharacterDiffOptions, CharacterDiffResult, CharacterSequence, LineDiffResult,
	LineEqualityScores, MAX_DYNAMIC_DIFF_CELLS, OptimizationSequence, SequenceDiff,
	SequenceDiffError, SequenceDiffResult, TextRange, dynamic_programming_diff, myers_diff,
	optimize_sequence_diffs, refine_character_diff, refine_line_diff,
};
pub use text_buffer::{BufferError, Position, TextBuffer, TextEdit, TextSnapshot};
pub use text_chunk::{TextChunk, TextChunkIter};
