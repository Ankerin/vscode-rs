/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Platform-independent editor algorithms. Text coordinates use UTF-16 code units.

mod atomic_tab_move;
mod bracket_ast;
mod bracket_collection;
mod bracket_edits;
mod bracket_indentation;
mod bracket_lengths;
mod bracket_lifecycle;
mod bracket_mutation;
mod bracket_node_metadata;
mod bracket_node_reader;
mod bracket_pair_collection;
mod bracket_parser;
mod bracket_position_mapper;
mod bracket_search;
mod bracket_tokenizer;
mod bracket_transform;
mod bracket_trees;
mod contiguous_tokens;
mod cursor_columns;
mod decorations;
mod ecmascript;
mod fast_bracket_tokenizer;
mod folding;
mod guides;
mod indentation;
mod line_tokens;
mod model_edits;
mod normalize_indentation;
mod search;
mod sequence_diff;
mod small_immutable_set;
mod sparse_tokens;
mod text_buffer;
mod text_change;
mod text_chunk;
mod token_array;
mod tokens;
mod tree;
mod unicode_deletion;
mod unicode_grapheme_data;
mod word_part;

pub use atomic_tab_move::{atomic_tab_position, whitespace_visible_column};
pub use bracket_ast::{
	BracketAstHost, create_bracket_list, create_bracket_pair, make_bracket_edge_mutable,
	reuse_bracket_node, update_bracket_children,
};
pub use bracket_collection::{BracketCollectionHost, collect_brackets};
pub use bracket_edits::combine_bracket_edits;
pub use bracket_indentation::{
	BracketIndentationHost, list_bracket_indentation, pair_bracket_indentation,
	text_bracket_indentation,
};
pub use bracket_lengths::{bracket_length, bracket_length_parts};
pub use bracket_lifecycle::{
	BracketLifecycleHost, complete_bracket_tokenization, flush_bracket_queues,
	handle_bracket_change, initialize_bracket_tree, queue_bracket_edits,
};
pub use bracket_mutation::{BracketMutationHost, mutate_bracket_list};
pub use bracket_node_metadata::{BracketNodeMetadata, BracketNodeNumber};
pub use bracket_node_reader::{
	BracketNodeReaderHost, advance_bracket_node, read_longest_bracket_node,
};
pub use bracket_pair_collection::{BracketPairCollectionHost, collect_bracket_pairs};
pub use bracket_parser::{
	BracketParserHost, can_reuse_bracket_parser_node, parse_bracket_child, parse_bracket_document,
	parse_bracket_list, read_bracket_parser_cache,
};
pub use bracket_position_mapper::{
	BracketPositionMapperHost, adjust_bracket_position_mapper, distance_to_bracket_change,
	translate_bracket_current_offset, translate_bracket_old_offset,
};
pub use bracket_search::{BracketSearchHost, find_bracket, has_unmatched_bracket};
pub use bracket_tokenizer::{
	BracketTokenizerHost, PeekableBracketTokenizerHost, peek_bracket_token, read_bracket_token,
	read_peekable_bracket_token, set_bracket_token_position, skip_bracket_tokens,
};
pub use bracket_transform::{
	BracketTransformHost, flatten_bracket_list, transform_array_bracket_list,
	transform_bracket_pair, transform_compact_bracket_list,
};
pub use bracket_trees::{
	BracketTreeGroup, BracketTreeHost, concat_bracket_trees, concat_bracket_trees_same_height,
};
pub use contiguous_tokens::{
	ContiguousTokensUpdate, append_contiguous_tokens, delete_contiguous_tokens,
	insert_contiguous_tokens,
};
pub use cursor_columns::{
	CursorColumnOperation, cursor_column, grapheme_break_type, next_cursor_tab_stop,
	previous_cursor_tab_stop, unicode_code_point, unicode_grapheme_offset,
};
pub use decorations::decoration_accept_edit;
pub use fast_bracket_tokenizer::{FastBracketTokenizerHost, build_fast_bracket_tokens};
pub use folding::{IndentationFoldingRanges, compute_indentation_folding};
pub use guides::{ActiveIndentGuide, compute_active_indent_guide, compute_indent_guides};
pub use indentation::{GuessedIndentation, guess_indentation};
pub use line_tokens::{
	InsertedLineTokens, LineTokenInsertion, convert_line_token_offsets, find_line_token_index,
	insert_line_tokens, line_token_slice, line_tokens_equal, line_tokens_in_range,
};
pub use model_edits::{
	MAX_MODEL_EDIT_UNITS, MAX_MODEL_EDITS, ModelEdit, ModelEditOptions, ModelTextFlags,
	PreparedModelEdit, PreparedModelEdits, count_eol, prepare_model_edits,
};
pub use normalize_indentation::{NormalizedIndentation, normalize_indentation};
pub use sequence_diff::{
	CharacterDiffOptions, CharacterDiffResult, CharacterSequence, DetailedLineDiff,
	DocumentDiffOptions, DocumentDiffResult, LineDiffResult, LineEqualityScores,
	MAX_DYNAMIC_DIFF_CELLS, MovedBlockDiff, OptimizationSequence, SequenceDiff, SequenceDiffError,
	SequenceDiffResult, TextRange, compute_document_diff, compute_moved_lines,
	dynamic_programming_diff, myers_diff, optimize_sequence_diffs, refine_character_diff,
	refine_line_diff,
};
pub use small_immutable_set::{small_set_add, small_set_merge, small_set_query};
pub use sparse_tokens::{
	SparseTokenEdit, SparseTokensUpdate, edit_sparse_tokens, find_sparse_line_tokens,
	remove_sparse_tokens, split_sparse_tokens,
};
pub use text_buffer::{BufferError, Position, TextBuffer, TextEdit, TextSnapshot};
pub use text_change::{CompressedTextChange, TextChange, UndoChangeBatch, compress_text_changes};
pub use text_chunk::{TextChunk, TextChunkIter};
pub use token_array::{create_line_token_array, line_token_array, slice_token_array};
pub use tokens::{TokensError, merge_semantic_tokens};
pub use unicode_deletion::unicode_left_delete_offset;
pub use word_part::word_part_column;
