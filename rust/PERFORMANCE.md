# Rust Editor Performance

## Method

Run `pnpm run build-rust-editor` followed by `pnpm run benchmark-rust-editor`. The benchmark alternates the original and Rust implementations in three fresh Node processes per fixture each. Both use the actual existing `PieceTreeTextBuffer` wrapper and its model construction path. Rust uses a release WebAssembly build; the reference uses the current TypeScript sources bundled with the same esbuild recipe. Eight construction/disposal iterations warm the adapter and allocator before timing. The runner verifies matching workload checksums within each fixture. Keep other builds and workload-heavy processes stopped during measurement.

Each workload creates and disposes 20 documents, applies 200 batches of 32 cursor insertions to a separate document, then performs 2,000 distributed insertions in a fresh document, resolves 20,000 offsets, reads consecutive and distributed random lines, runs 20 present and 20 absent literal searches, retains 1,000 snapshots of the fragmented document, drains ten snapshots, and extracts the whole document. Batch timings include range resolution and operation construction. The batch document is disposed before the other workloads; the preceding batches warm editing paths in both implementations. Searches stop at 1,000 results. The inserted ASCII text is `inserted`; Unicode edits may split surrogate pairs, so their subsequent transfers must preserve lone surrogates. Raw results and process-memory observations are stored in `.build/rust/benchmark.json`, which is ignored by Git.

## First-stage observation

The original ASCII-only observation was measured on November 5, 2026, Windows x64, Node `24.14.0`, Rust `1.99.1`, wasm-bindgen `0.2.130`, with the first-stage adapter's UTF-16 fast decoding and leaf line indexes. It predates compact leaves, sequential snapshot traversal, adaptive line caching, native literal search, and the expanded fixture runner. Times are medians of three processes, in milliseconds. This table is historical, not the current implementation's result.

| Workload | Existing | Rust/WASM |
| --- | ---: | ---: |
| Create 20 documents | 48.55 | 100.34 |
| Perform 2,000 edits | 10.44 | 14.46 |
| Resolve 20,000 positions | 4.12 | 6.82 |
| Read 20,000 lines | 2.53 | 17.81 |
| Retain 1,000 snapshots | 84.75 | 0.52 |
| Drain ten snapshots | 1.67 | 22.68 |
| Extract the entire document | 0.51 | 1.64 |

## Storage batch observation

Measured on November 5, 2026, Windows x64, repository-pinned Node `24.22.1`, Rust `1.99.1`, wasm-bindgen `0.2.130`, js-sys `0.3.107`, and memchr `2.8.3`. The implementation uses compact Latin-1 leaves with shared backing/indexes, lazy sequential snapshots, storage ABI 3, atomic model batch application, direct single-leaf transfers, adaptive line caching, and native literal search. ASCII output uses the binding's string path; non-ASCII output uses UTF-16 typed arrays and native JavaScript decoding. All six runs per fixture produced matching checksums. Times below are medians of three processes, in milliseconds.

This capture precedes complete buffer edit transactions and direct decoding of short UTF-16 results. Its raw runs are retained in `.build/rust/benchmark-storage.json`.

| Fixture | Initial UTF-16 units | Initial nonempty lines | Consecutive reads | Random reads |
| --- | ---: | ---: | ---: | ---: |
| ASCII source | 1,100,000 | 20,000 | 20,000 | 20,000 |
| Latin-1 source, including U+0080/U+009F/U+00FF | 940,000 | 20,000 | 20,000 | 20,000 |
| Unicode source, including U+03A9/U+6F22/U+1F600 | 960,000 | 20,000 | 20,000 | 20,000 |
| Long lines, 65,545 units per nonempty line | 1,048,736 | 16 | 17 | 1,088 |

Each fixture ends with LF and therefore has a final empty line. Insertions contain no line breaks. Distributed reads use a deterministic index sequence and can revisit lines; consecutive reads visit each indicated line once. See `test/rust/textBufferBenchmark.ts` for the exact fixture strings and operation order.

### ASCII source

| Workload | Existing | Rust/WASM |
| --- | ---: | ---: |
| Create 20 documents | 48.81 | 95.52 |
| Apply 200 batches of 32 cursor insertions | 16.29 | 21.30 |
| Perform 2,000 edits | 3.55 | 8.20 |
| Resolve 20,000 positions | 4.57 | 6.25 |
| Read consecutive lines | 3.18 | 2.46 |
| Read random lines | 3.87 | 16.51 |
| Run 20 present literal searches | 6.59 | 4.28 |
| Run 20 absent literal searches | 5,760.61 | 8.99 |
| Retain 1,000 snapshots | 83.94 | 0.48 |
| Drain ten snapshots | 1.54 | 4.21 |
| Extract the entire document | 0.45 | 0.68 |

### Latin-1 source

| Workload | Existing | Rust/WASM |
| --- | ---: | ---: |
| Create 20 documents | 35.84 | 93.21 |
| Apply 200 batches of 32 cursor insertions | 16.49 | 22.65 |
| Perform 2,000 edits | 3.91 | 8.29 |
| Resolve 20,000 positions | 4.01 | 6.66 |
| Read consecutive lines | 2.95 | 3.81 |
| Read random lines | 3.69 | 27.54 |
| Run 20 present literal searches | 6.54 | 4.68 |
| Run 20 absent literal searches | 4,844.86 | 9.09 |
| Retain 1,000 snapshots | 86.80 | 0.50 |
| Drain ten snapshots | 1.42 | 19.53 |
| Extract the entire document | 0.43 | 1.63 |

### Unicode source

| Workload | Existing | Rust/WASM |
| --- | ---: | ---: |
| Create 20 documents | 111.48 | 154.40 |
| Apply 200 batches of 32 cursor insertions | 16.47 | 23.29 |
| Perform 2,000 edits | 3.51 | 8.63 |
| Resolve 20,000 positions | 4.25 | 6.70 |
| Read consecutive lines | 2.82 | 5.55 |
| Read random lines | 3.99 | 27.65 |
| Run 20 present literal searches | 6.74 | 4.52 |
| Run 20 absent literal searches | 4,925.90 | 10.19 |
| Retain 1,000 snapshots | 86.68 | 0.50 |
| Drain ten snapshots | 1.51 | 39.42 |
| Extract the entire document | 0.44 | 3.39 |

### Long lines

| Workload | Existing | Rust/WASM |
| --- | ---: | ---: |
| Create 20 documents | 51.42 | 107.93 |
| Apply 200 batches of 32 cursor insertions | 16.98 | 22.77 |
| Perform 2,000 edits | 4.07 | 8.80 |
| Resolve 20,000 positions | 3.08 | 5.11 |
| Read consecutive lines | 0.56 | 1.32 |
| Read random lines | 7.39 | 24.59 |
| Run 20 present literal searches | 4.14 | 5.44 |
| Run 20 absent literal searches | 3.75 | 4.05 |
| Retain 1,000 snapshots | 86.49 | 0.55 |
| Drain ten snapshots | 1.51 | 3.90 |
| Extract the entire document | 0.43 | 0.71 |

## Interpretation and next work

- Persistent-root snapshots retain their substantial creation advantage in all four fixtures. Snapshot consumption still regresses, particularly for Unicode after edits split surrogate pairs. Efficient creation alone does not make saving efficient.
- Native literal search avoids per-line string extraction. The absent-marker scan improves substantially on the fragmented short-line fixtures, while both long-line searches remain close to the reference. Present short-line searches reach the result limit early; these timings do not describe a full scan or regex/word-boundary performance.
- Consecutive ASCII line reads improve, but random line reads still regress on every fixture. Keep batching at meaningful model/view boundaries rather than growing a cache to hide distributed-read costs or retaining all decoded lines.
- Construction, position lookup, distributed edits, and cursor batches remain slower in this observation. Atomic batch application reduces the number of storage binding calls and preserves all-or-nothing text updates; it does not establish an end-to-end batch performance gain. Reduce tree/index allocation and coordinate-resolution overhead, and consider moving the consuming view/model algorithms into Rust before promotion.
- One-byte Latin-1 payloads halve that leaf's text bytes compared with the previous Rust representation. This is a representation fact, not a measured total-memory saving; nodes, shared indexes, retained versions, decoding buffers, and allocator capacity still contribute.
- Extend measurements to non-ASCII content, large and long-line files, many documents, actual editor interaction, Electron process trees, workers, remote models, notebooks, and extensions before assigning product promotion budgets.

These results are not sufficient to promote Rust storage as the default or claim that the application is faster or uses fewer resources overall. The historical and current tables use different Node versions and implementation stages; use the existing/Rust pair within the current run for direct comparisons.

Process RSS and heap observations in the raw artifact are sampled at one workload point while most snapshots remain retained. They are not a peak-memory profiler or an application-wide memory baseline. V8 and WebAssembly allocators can retain capacity after disposal, and submillisecond measurements and GC-sensitive extraction timings vary between runs. Do not interpret a smaller JavaScript heap as equivalent total-memory savings.

## Sequence alignment observation

This observation describes sequence ABI 3 before native shift/join optimization. The following section records the newer stage.

Measured on November 5, 2026, Windows x64, Node `24.22.1`, Rust `1.99.1`, wasm-bindgen `0.2.130`, and js-sys `0.3.107`, using release WebAssembly and the current bundled TypeScript sources. Run `pnpm run benchmark-rust-editor -- --diff`. The same runner alternates three fresh processes per engine and fixture; all paired result checksums matched. Three warmup iterations precede an explicit GC and the timed work. Input construction and result serialization/checksums are outside the timing intervals. Sequence extraction, typed binding transfers, complete diff heuristics, and range translation remain inside them.

Each document contains numbered source lines, replaces `return` with `yield` every seventeenth line, and relocates eight lines from index 20 to the midpoint. Unicode lines include U+03A9, U+6F22, U+1F600, and an unpaired high surrogate. Standalone alignment uses up to 800 numeric elements with every thirteenth element changed. Each reported alignment workload repeats 20 times; each complete diff workload repeats ten times. Timed display diffs use a 30,000 ms budget per computation and check the same cell/frontier frequency as the reference. These workloads do not expire that budget.

| Fixture | Lines per document | Original UTF-16 units | Standalone sequence elements |
| --- | ---: | ---: | ---: |
| Small source | 120 | 5,458 | 120 |
| Medium source | 800 | 37,018 | 800 |
| Large source | 4,000 | 188,534 | 800 |
| Unicode source | 500 | 22,592 | 500 |

Times are medians of three processes, in milliseconds.

| Fixture | Workload | Existing | Rust/WASM |
| --- | --- | ---: | ---: |
| Small | 20 dynamic alignments | 9.72 | 1.64 |
| Small | 20 Myers alignments | 0.31 | 0.26 |
| Small | Ten display diffs | 21.91 | 7.64 |
| Small | Ten timed display diffs | 36.98 | 29.25 |
| Small | Ten display diffs with raw edits | 25.34 | 9.16 |
| Medium | 20 dynamic alignments | 186.43 | 60.81 |
| Medium | 20 Myers alignments | 9.73 | 2.14 |
| Medium | Ten display diffs | 142.83 | 54.54 |
| Medium | Ten timed display diffs | 441.29 | 406.46 |
| Medium | Ten display diffs with raw edits | 127.26 | 54.61 |
| Large | 20 dynamic alignments | 181.94 | 62.13 |
| Large | 20 Myers alignments | 10.63 | 2.00 |
| Large | Ten display diffs | 141.33 | 83.65 |
| Large | Ten timed display diffs | 344.56 | 314.06 |
| Large | Ten display diffs with raw edits | 110.04 | 72.89 |
| Unicode | 20 dynamic alignments | 79.63 | 23.81 |
| Unicode | 20 Myers alignments | 6.21 | 0.89 |
| Unicode | Ten display diffs | 65.33 | 26.80 |
| Unicode | Ten timed display diffs | 185.16 | 170.08 |
| Unicode | Ten display diffs with raw edits | 49.01 | 25.35 |

The initial per-cell JavaScript timeout callback made timed display diffs 1.38–1.54 times slower in these fixtures. Sequence ABI 3 instead passes the unchanged `DateTimeout` deadline to Rust/WASM and imports `Date.now()` directly, preserving custom checks and timeout latching. The current timed runs improve modestly; untimed runs improve more. The clock check still accounts for a substantial fraction of timed dynamic alignment.

Process peak RSS below comes from `process.resourceUsage().maxRSS` over each entire fresh-process fixture, including initialization and warmup. WebAssembly linear memory is recorded at the end and is already part of the process footprint, so the columns must not be added together. Values are medians in MiB.

| Fixture | Existing process peak RSS | Rust process peak RSS | Rust linear memory at completion |
| --- | ---: | ---: | ---: |
| Small | 64.31 | 62.68 | 1.13 |
| Medium | 316.64 | 69.61 | 1.75 |
| Large | 130.10 | 103.84 | 1.81 |
| Unicode | 172.31 | 67.55 | 1.38 |

These observations support lower peak process memory and faster alignment for the measured diff workloads. They do not establish editor startup, rendering latency, application-wide memory savings, arbitrary equality-score performance, or worst-case diff behavior. V8 and WebAssembly allocation retention, GC, fixture shape, and submillisecond noise influence the numbers. Raw runs remain in the ignored `.build/rust/diff-benchmark.json`; existing text-storage observations above are unchanged.


## Sequence optimization observation

Measured under the same method, fixture inputs, repetition counts, and software versions on November 5, 2026. Sequence ABI 4 additionally runs both shift/join passes and scored insertion/deletion shifts in Rust. The bridge transfers stable strong identities and boundary scores for each optimization; sequences without that contract keep the existing implementation. All result checksums matched. Times are medians of three fresh processes, in milliseconds.

| Fixture | Workload | Existing | Rust/WASM |
| --- | --- | ---: | ---: |
| small | Ten display diffs | 13.09 | 11.37 |
| small | Ten timed display diffs | 36.85 | 29.19 |
| small | Ten display diffs with raw edits | 26.84 | 10.77 |
| medium | Ten display diffs | 144.74 | 59.72 |
| medium | Ten timed display diffs | 455.69 | 413.59 |
| medium | Ten display diffs with raw edits | 123.74 | 57.54 |
| large | Ten display diffs | 145.00 | 110.60 |
| large | Ten timed display diffs | 360.42 | 332.17 |
| large | Ten display diffs with raw edits | 108.72 | 94.13 |
| unicode | Ten display diffs | 59.27 | 33.64 |
| unicode | Ten timed display diffs | 201.58 | 183.12 |
| unicode | Ten display diffs with raw edits | 56.87 | 27.73 |

Process peak RSS and final linear memory use the same method and MiB units as the preceding observation.

| Fixture | Existing process peak RSS | Rust process peak RSS | Rust linear memory at completion |
| --- | ---: | ---: | ---: |
| small | 64.80 | 64.02 | 1.13 |
| medium | 322.55 | 74.12 | 1.75 |
| large | 129.80 | 106.08 | 1.88 |
| unicode | 175.14 | 69.23 | 1.38 |

The complete Rust-backed pipeline remains faster than the paired reference in these fixtures. Native optimization does not provide an additional speed gain over the preceding Rust alignment stage: identity/score construction and repeated typed transfers add overhead, particularly in the large fixture. Move the owning sequence state and remaining refinement algorithms into Rust to remove these repeated conversions. Do not use this stage as evidence of faster application rendering or lower full-product memory. Current raw runs are in the ignored `.build/rust/diff-benchmark.json`; the preceding alignment-stage raw runs were retained locally as `.build/rust/diff-benchmark-alignment.json`.

## Owning character refinement observation

Measured with the same fixture inputs, alternating three fresh processes per engine, Node `24.22.1`, Rust `1.99.1`, and release WASM bindings on November 5, 2026. Sequence ABI 5 performs slice construction, UTF-16 alignment, boundary classification, word/subword expansion, short-match removal, and range translation in one native scope. Raw Myers edits precede display refinements. This removes repeated JavaScript character/identity/score construction and transfers. Line-level operations remain in the existing pipeline. All output checksums matched. Times are medians in milliseconds.

| Fixture | Workload | Existing | Rust/WASM |
| --- | --- | ---: | ---: |
| small | Ten display diffs | 22.81 | 7.72 |
| small | Ten timed display diffs | 38.44 | 30.72 |
| small | Ten display diffs with raw edits | 26.34 | 9.78 |
| medium | Ten display diffs | 152.19 | 53.76 |
| medium | Ten timed display diffs | 481.11 | 430.23 |
| medium | Ten display diffs with raw edits | 133.73 | 53.68 |
| large | Ten display diffs | 147.30 | 80.35 |
| large | Ten timed display diffs | 378.79 | 348.08 |
| large | Ten display diffs with raw edits | 114.33 | 71.72 |
| unicode | Ten display diffs | 66.37 | 26.22 |
| unicode | Ten timed display diffs | 193.57 | 180.71 |
| unicode | Ten display diffs with raw edits | 48.81 | 23.14 |

Process peak RSS and final WASM linear memory are medians in MiB, using the same method as the preceding observations.

| Fixture | Existing process peak RSS | Rust process peak RSS | Rust linear memory at completion |
| --- | ---: | ---: | ---: |
| small | 64.37 | 62.41 | 1.12 |
| medium | 316.96 | 70.07 | 1.75 |
| large | 129.49 | 101.89 | 1.88 |
| unicode | 172.03 | 67.77 | 1.38 |

The paired results support faster complete diff computation and lower process peak RSS for these workloads. Standalone tiny Myers calls still cost more than the reference because their input crosses the boundary; timed runs retain the original checkpoint frequency. Comparisons with historical stage timings are diagnostic because reference timings vary between runs. These measurements do not establish application-wide resource savings, rendering/input parity, or worst-case behavior. Current raw runs are in `.build/rust/diff-benchmark.json`; the preceding optimization-stage runs are retained in `.build/rust/diff-benchmark-optimization.json`. Both files remain ignored.

## Line refinement observation

Measured with the same fixtures and method on November 5, 2026. Sequence ABI 6 also constructs exact/trimmed line identities, indentation scores, and line-level short-match refinement in Rust. Borrowed UTF-16 slices avoid decoded native string copies; source lines cross the boundary once for line alignment and again for each separate character refinement. All output checksums matched. Times are medians of three fresh processes in milliseconds.

| Fixture | Workload | Existing | Rust/WASM |
| --- | --- | ---: | ---: |
| small | Ten display diffs | 13.47 | 8.06 |
| small | Ten timed display diffs | 38.15 | 28.30 |
| small | Ten display diffs with raw edits | 27.64 | 9.70 |
| medium | Ten display diffs | 150.71 | 66.07 |
| medium | Ten timed display diffs | 501.08 | 418.68 |
| medium | Ten display diffs with raw edits | 129.31 | 65.06 |
| large | Ten display diffs | 141.24 | 81.75 |
| large | Ten timed display diffs | 359.39 | 323.93 |
| large | Ten display diffs with raw edits | 108.86 | 77.63 |
| unicode | Ten display diffs | 55.77 | 31.58 |
| unicode | Ten timed display diffs | 199.00 | 178.48 |
| unicode | Ten display diffs with raw edits | 56.43 | 28.30 |

Process peak RSS and final WASM linear memory are medians in MiB.

| Fixture | Existing process peak RSS | Rust process peak RSS | Rust linear memory at completion |
| --- | ---: | ---: | ---: |
| small | 64.75 | 63.45 | 1.12 |
| medium | 316.81 | 70.35 | 1.94 |
| large | 105.88 | 81.81 | 2.12 |
| unicode | 172.17 | 64.25 | 1.50 |

The paired complete pipeline remains faster in these fixtures. This line migration does not establish an additional speed gain over the preceding character-refinement observation: full line input transfers and native identity hashing add work, while reference and standalone alignment timings also vary between captures. Shared owning document state across line alignment, character refinement, and move detection remains an optimization target. Current raw runs are in `.build/rust/diff-benchmark.json`; the preceding character-refinement runs are retained in `.build/rust/diff-benchmark-character.json`. These observations do not establish full-product resource savings or visual parity.

## Move detection observation

Measured with the same fixtures, alternating three fresh processes per engine, and release bindings on November 5, 2026. Sequence ABI 7 adds native histogram/triple matching, stable candidate selection, similar-line extension, and move filtering. Source lines and trimmed hashes still cross a separate boundary for move detection. Every checksum matched. Times are medians in milliseconds.

| Fixture | Workload | Existing | Rust/WASM |
| --- | --- | ---: | ---: |
| small | Ten display diffs | 12.61 | 7.87 |
| small | Ten timed display diffs | 37.56 | 30.15 |
| small | Ten display diffs with raw edits | 27.06 | 10.41 |
| medium | Ten display diffs | 144.26 | 68.46 |
| medium | Ten timed display diffs | 469.24 | 421.85 |
| medium | Ten display diffs with raw edits | 125.91 | 68.18 |
| large | Ten display diffs | 136.97 | 90.06 |
| large | Ten timed display diffs | 348.92 | 325.84 |
| large | Ten display diffs with raw edits | 106.76 | 83.54 |
| unicode | Ten display diffs | 55.92 | 31.80 |
| unicode | Ten timed display diffs | 197.32 | 174.02 |
| unicode | Ten display diffs with raw edits | 58.78 | 28.69 |

Process peak RSS and final WASM linear memory are medians in MiB.

| Fixture | Existing process peak RSS | Rust process peak RSS | Rust linear memory at completion |
| --- | ---: | ---: | ---: |
| small | 67.80 | 63.17 | 1.13 |
| medium | 322.51 | 72.34 | 1.94 |
| large | 105.56 | 84.67 | 2.13 |
| unicode | 171.98 | 65.07 | 1.50 |

The paired pipeline remains faster than the reference for these workloads. This capture does not demonstrate an additional speed gain from move detection over the preceding line-refinement stage. The fixtures contain limited block movement; typed source/hash transfers and stage-to-stage timing variation remain relevant. Ordered lookup removes repeated linear candidate-extension searches, but these measurements do not quantify its benefit on pathological repeated triples. Shared source state across the full pipeline remains the next boundary. Current raw runs are in `.build/rust/diff-benchmark.json`; ABI 6 runs are preserved in `.build/rust/diff-benchmark-lines.json`. No full-product memory or visual-parity claim follows from these measurements.

## Shared document pipeline observation

Measured with the same fixture inputs, alternating three fresh processes per engine, Node `24.22.1`, Rust `1.99.1`, and release bindings on November 5, 2026. Sequence ABI 8 performs the full advanced document pipeline in one native scope: line alignment, whitespace scanning, character refinement, detailed line grouping, move matching, and refinement inside moved blocks share one source transfer. The JavaScript bridge constructs existing result objects from a single packed response. Every checksum matched. Times are medians in milliseconds.

| Fixture | Workload | Existing | Rust/WASM |
| --- | --- | ---: | ---: |
| small | Ten display diffs | 21.77 | 6.30 |
| small | Ten timed display diffs | 38.09 | 29.72 |
| small | Ten display diffs with raw edits | 27.12 | 7.41 |
| medium | Ten display diffs | 147.51 | 36.72 |
| medium | Ten timed display diffs | 477.29 | 412.20 |
| medium | Ten display diffs with raw edits | 131.86 | 40.74 |
| large | Ten display diffs | 142.13 | 56.53 |
| large | Ten timed display diffs | 370.81 | 320.58 |
| large | Ten display diffs with raw edits | 112.31 | 57.68 |
| unicode | Ten display diffs | 68.66 | 19.44 |
| unicode | Ten timed display diffs | 195.81 | 184.38 |
| unicode | Ten display diffs with raw edits | 50.79 | 17.72 |

Process peak RSS and final WASM linear memory are medians in MiB.

| Fixture | Existing process peak RSS | Rust process peak RSS | Rust linear memory at completion |
| --- | ---: | ---: | ---: |
| small | 63.75 | 62.84 | 1.13 |
| medium | 322.58 | 68.64 | 1.94 |
| large | 105.28 | 80.57 | 2.13 |
| unicode | 172.21 | 64.19 | 1.50 |

The paired pipeline is faster and uses lower process peak RSS in these fixtures. Untimed display/raw computation is also faster in this capture than the preceding native move stage, consistent with removing repeated source packing and transfers; cross-capture comparisons remain diagnostic because reference timings vary. Timed workloads retain the original cell/frontier deadline frequency and still spend substantial time crossing to the clock. These observations do not establish whole-product memory savings, startup/rendering latency, exact visual parity, or legacy-diff performance. Current raw runs are in `.build/rust/diff-benchmark.json`; ABI 7 runs are retained in `.build/rust/diff-benchmark-moves.json`. Both remain ignored.

## Undo composition observation

Measured on November 5, 2026 with Node `24.22.1`, Rust `1.99.1`, and release undo-change ABI 1 bindings. The runner alternates three fresh processes per engine and verifies identical complete result checksums. Each operation composes two existing JavaScript change arrays; the Rust path packs their UTF-16 text and position/slice tuples, performs native composition with borrowed fragments, and decodes existing result objects. The fragmented fixtures insert 98,304 units and subsequently replace 512 separated six-unit ranges. Times are medians in milliseconds.

| Fixture | Repetitions | Existing | Rust/WASM |
| --- | ---: | ---: | ---: |
| Small typing batch | 10,000 | 3.61 | 23.31 |
| 1,024 cursors | 100 | 6.49 | 56.37 |
| Fragmented ASCII insertion | 30 | 4.69 | 32.36 |
| Fragmented Unicode insertion | 30 | 4.99 | 93.07 |

Process peak RSS and final WASM linear memory are medians in MiB.

| Fixture | Existing process peak RSS | Rust process peak RSS | Rust linear memory at completion |
| --- | ---: | ---: | ---: |
| Small typing batch | 50.85 | 62.97 | 1.13 |
| 1,024 cursors | 52.58 | 67.36 | 1.31 |
| Fragmented ASCII insertion | 54.21 | 65.20 | 1.63 |
| Fragmented Unicode insertion | 55.49 | 84.54 | 1.63 |

This boundary is slower in every measured workload. Borrowed native fragments avoid copied substring payloads inside Rust, but repeated source packing, result serialization, and lossless JavaScript decoding outweigh that work. The fragmented Unicode case also spends time preserving dense lone surrogates. Do not present stateless composition as an undo performance improvement or promote it by default. ABI 2 implements owning native history between appends and transfers only new changes, deferring complete result conversion until an existing consumer needs it. The ABI 1 raw runs remain ignored in `.build/rust/undo-benchmark-stateless.json`.

## Owning undo batch observation

Measured on November 5, 2026 with Node `24.22.1`, Rust `1.99.1`, and release undo-change ABI 2 bindings. Three fresh processes per engine alternate using the same runner; all complete result and serialized-stream checksums match. Each stream starts from the existing previous batch, appends only new changes, and serializes once at completion. Typing appends 10,000 characters; other streams alternate each fixture's changes and inverse changes. The optimized implementation reuses vectors for contained single edits and aligned replacements, and a scratch vector for contained fragmented edits. Times are medians in milliseconds.

| Fixture | Appends | Existing stream | Rust/WASM stream | Existing stateless pairs | Rust/WASM stateless pairs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small typing batch | 10,000 | 3.20 | 2.65 | 1.41 | 22.22 |
| 1,024 cursors | 100 | 5.45 | 5.24 | 7.54 | 56.04 |
| Fragmented ASCII insertion | 30 | 3.87 | 2.01 | 5.18 | 38.45 |
| Fragmented Unicode insertion | 30 | 5.60 | 1.96 | 4.22 | 102.76 |

The owning streams improve on the reference in this capture, with a small cursor difference that needs more representative measurements before treating it as a reliable gain. The earlier owning implementation, before allocation reuse, was slower in every stream: existing/Rust times were 4.18/5.22, 3.49/21.58, 3.62/7.65, and 5.96/9.31 milliseconds respectively. Reference variation across captures is visible. Stateless pair composition remains substantially slower and still serves existing public array consumers.

The following process peak RSS and final WASM memory are medians in MiB. Each process measures both stateless pairs and the stream, including warm-up; these peaks do not isolate retained open undo state.

| Fixture | Existing process peak RSS | Rust process peak RSS | Rust linear memory at completion |
| --- | ---: | ---: | ---: |
| Small typing batch | 73.83 | 77.06 | 1.13 |
| 1,024 cursors | 79.37 | 80.86 | 1.31 |
| Fragmented ASCII insertion | 82.72 | 88.14 | 1.88 |
| Fragmented Unicode insertion | 85.67 | 108.60 | 1.88 |

This capture does not demonstrate lower process memory. Native batches own flat vectors rather than shared rope fragments, and general composition still copies the next payload before committing. Remaining undo metadata and service orchestration are TypeScript. End-to-end keystroke latency, many open undo histories, sustained memory behavior, and whole-application resource savings remain unmeasured. Current raw runs are ignored in `.build/rust/undo-benchmark.json`; initial owning runs are retained in `.build/rust/undo-benchmark-owned-initial.json`.

## Complete buffer transaction observation

Measured on November 6, 2026, Windows x64, Node `24.22.1`, Rust `1.99.1`, and release storage ABI 4 bindings. The dedicated `--edits` runner alternates three fresh processes for each of three engines: the existing buffer, Rust storage with the original TypeScript transaction path, and the complete native transaction. Each timed pair applies a fixed batch and its inverse with undo generation enabled. Three pairs warm the implementation; range/input construction and the final restored-document checksum are outside the timer. Metadata checksums and restored document checksums match across all engines. Times are medians in milliseconds.

| Fixture | Apply/reverse pairs | Existing | Rust storage with TypeScript transactions | Complete Rust/WASM transaction |
| --- | ---: | ---: | ---: | ---: |
| Single-character typing | 10,000 | 27.22 | 53.50 | 58.13 |
| 1,024 tracked cursors | 50 | 144.72 | 274.20 | 236.09 |
| 512 fragmented ASCII replacements | 30 | 445.32 | 101.25 | 93.81 |
| 512 fragmented Unicode replacements | 30 | 504.03 | 116.32 | 96.22 |

The fragmented fixtures replace six-unit spans of a 98,304-unit source with `changed` followed by LF. The Unicode source contains paired and lone surrogates and BOM. Tracked operations retain separate metadata rather than invoking the thousand-edit reduction path. Existing input strings are reused for unchanged normalized text, original deleted ranges serialize directly from shared leaves, and one/two-unit results decode without temporary typed-array views. Other short UTF-16 results decode directly; larger results retain the lossless span decoder.

Process peak RSS and final native-transaction WASM linear memory are medians in MiB, including setup, warm-up, and final checksum work.

| Fixture | Existing process peak RSS | Rust storage process peak RSS | Complete transaction process peak RSS | Complete transaction linear memory |
| --- | ---: | ---: | ---: | ---: |
| Single-character typing | 62.98 | 73.84 | 74.92 | 1.13 |
| 1,024 tracked cursors | 90.40 | 82.63 | 77.73 | 1.56 |
| Fragmented ASCII | 237.87 | 73.98 | 74.57 | 1.81 |
| Fragmented Unicode | 303.74 | 82.92 | 74.63 | 2.44 |

The complete transaction improves on the storage-only path for cursor and fragmented workloads in this capture. Fragmented workloads are also faster than the existing editor buffer and have lower peak RSS. Typing and cursor latency remain slower than the existing buffer, and typing peak RSS is higher. Intermediate captures varied substantially: cursor medians for the initial native transaction, direct short decoding, and final allocation reuse were 295.05, 423.23, and 236.09 milliseconds. Unicode decoding improved from 329.03 to 105.24 and then 96.22 milliseconds. These variations limit cross-capture attribution; the final within-capture comparisons are the relevant evidence. This stage remains opt-in and does not establish whole-editor resource savings or input-to-paint latency. Raw captures are ignored in `.build/rust/edits-benchmark.json`, `.build/rust/edits-benchmark-initial.json`, and `.build/rust/edits-benchmark-decoding.json`.

## Buffer workload with complete transactions

The general buffer runner was repeated with the same November 6 toolchain and final transaction/short-decoding implementation. All checksums matched. The following rows summarize editing and random-line access; other raw measurements remain in the ignored `.build/rust/benchmark.json`. Times are medians in milliseconds.

| Fixture | Workload | Existing | Rust/WASM |
| --- | --- | ---: | ---: |
| ASCII | 200 batches of 32 cursor insertions | 18.19 | 25.45 |
| Latin-1 | 200 batches of 32 cursor insertions | 20.48 | 25.10 |
| Unicode | 200 batches of 32 cursor insertions | 17.64 | 27.19 |
| Long lines | 200 batches of 32 cursor insertions | 20.34 | 25.38 |
| ASCII | 2,000 distributed insertions | 4.27 | 10.52 |
| Latin-1 | 2,000 distributed insertions | 4.03 | 11.18 |
| Unicode | 2,000 distributed insertions | 4.12 | 11.73 |
| Long lines | 2,000 distributed insertions | 3.86 | 10.10 |
| ASCII | Random line reads | 4.03 | 18.90 |
| Latin-1 | Random line reads | 3.77 | 45.41 |
| Unicode | Random line reads | 4.10 | 49.30 |
| Long lines | Random line reads | 9.55 | 24.17 |

These workloads retain regressions in editing and line transfer. Distributed insertions and random line reads still cross coordinate/text boundaries; occasional surrogate splits require lossless decoding. Literal search and immutable snapshot creation remain faster in the raw capture, while construction, snapshot draining, and full extraction retain their earlier costs. The initial ABI 4 capture before allocation/short-decoding changes is retained in `.build/rust/benchmark-model-edits-initial.json`; the ABI 3 capture is retained in `.build/rust/benchmark-storage.json`. No default promotion follows from these subsystem measurements.

## Scalar model query observation

Measured on November 6, 2026, Windows x64, Node `24.22.1`, Rust `1.99.1`, and release storage ABI 5 bindings. Three fresh processes alternate per engine using `--queries`. Whitespace queries request both first and last columns for deterministic line indices; character queries reuse twenty preconstructed visible-line ranges for 200 calls, cycling the three existing EOL preferences. Setup and warm-up are outside the timer. Every workload checksum matched. Times are medians in milliseconds.

| Fixture | Whitespace queries | Existing columns | Rust/WASM columns | Existing 200 counts | Rust/WASM 200 counts |
| --- | ---: | ---: | ---: | ---: | ---: |
| Short lines | 10,000 | 2.76 | 4.64 | 6.52 | 1.45 |
| Unicode lines | 10,000 | 3.34 | 4.89 | 6.57 | 1.18 |
| Long line | 1,000 | 110.65 | 24.84 | 30.80 | 8.05 |
| Whitespace-heavy source | 10,000 | 6.84 | 6.23 | 15.04 | 4.07 |

The long line contains 65,536 leading spaces, unmatched/paired surrogate units, and 65,536 trailing tabs. Other sources include 8,192 short/Unicode lines or 1,024 whitespace lines with a BOM sentinel. Native queries borrow persistent leaf data rather than decoding complete lines. Character counts improve in every fixture; whitespace-column queries improve on long and whitespace-heavy sources but remain slower on short lines. Separate WASM calls and rope coordinate traversal remain visible for short scalar queries.

Process peak RSS and final WASM linear memory are medians in MiB.

| Fixture | Existing process peak RSS | Rust process peak RSS | Rust linear memory at completion |
| --- | ---: | ---: | ---: |
| Short lines | 58.19 | 66.63 | 1.69 |
| Unicode lines | 58.34 | 67.02 | 1.44 |
| Long line | 55.35 | 65.69 | 1.50 |
| Whitespace-heavy source | 57.80 | 67.33 | 1.75 |

This capture demonstrates faster counting and long-line column queries, while peak process memory is higher. Avoided decoded line transfers do not establish total memory savings; the shared WASM runtime and persistent rope remain part of the measured process. Whole-editor input latency, supported platforms, and the full resource gate remain pending. Raw runs stay ignored in `.build/rust/queries-benchmark.json`.
