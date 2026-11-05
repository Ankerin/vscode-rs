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

## Current observation

Measured on November 5, 2026, Windows x64, repository-pinned Node `24.22.1`, Rust `1.99.1`, wasm-bindgen `0.2.130`, js-sys `0.3.107`, and memchr `2.8.3`. The implementation uses compact Latin-1 leaves with shared backing/indexes, lazy sequential snapshots, storage ABI 3, atomic model batch application, direct single-leaf transfers, adaptive line caching, and native literal search. ASCII output uses the binding's string path; non-ASCII output uses UTF-16 typed arrays and native JavaScript decoding. All six runs per fixture produced matching checksums. Times below are medians of three processes, in milliseconds.

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

## Sequence diff observation

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
