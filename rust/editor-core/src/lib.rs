/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//! Platform-independent editor algorithms. Text coordinates use UTF-16 code units.

mod search;
mod text_buffer;
mod text_chunk;
mod tree;

pub use text_buffer::{BufferError, Position, TextBuffer, TextEdit, TextSnapshot};
pub use text_chunk::{TextChunk, TextChunkIter};
