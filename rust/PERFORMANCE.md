# Rust Editor Performance

## Phase 1 implementation policy

Complete the integrated Rust core migration before extensive profiling or performance optimization. During Phase 1, fix correctness defects, memory safety issues, and critical performance regressions immediately, but continue to the next subsystem after successful functional and canonical validation. Retain existing measurements as historical evidence; do not repeatedly benchmark or micro-optimize functioning modules. Phase 2 will compare representative whole-application CPU, memory, allocation, latency, and throughput workloads against the original implementation under identical conditions, prioritize measurable end-to-end improvements, and continue while useful opportunities remain without unacceptable compatibility trade-offs.

Tokens ABI 7 serializes directly into one JavaScript output byte array and retains no persistent native serialization handle. Its supported decoder still copies the input byte stream temporarily for header parsing, retains temporary descriptors, and creates source-view objects across the boundary. Size calculation and writing retain per-block/per-line object property access. These are Phase 2 profiling and optimization opportunities; no new performance or resource improvement is claimed for this migration. Existing subview and unsupported-state fallbacks remain necessary for behavioral compatibility.

Tokens ABI 8 reads existing token ends directly for binary lookup, avoiding an O(n) transfer for an O(log n) query. Each read still crosses the JavaScript/WebAssembly boundary. Equality and range extraction copy source words temporarily; offset conversion includes mutable copyback. Ordered insertion packs original/inserted UTF-16 text and numeric parameters, then copies and decodes the composed output. These allocations, result-object construction, and repeated source transfers are Phase 2 opportunities. No new benchmark campaign or performance/resource improvement claim accompanies this Phase 1 migration.

Tokens ABI 9 still packs source lengths and transfers clipping results for sequence slices; line conversion copies encoded source words. Complete text construction retains temporary host string references and native parameter/output vectors, then joins the primitive strings in JavaScript without decoding them into Rust strings. Descriptor preflight and per-token property access add boundary work. Shared ownership, fused slice/conversion, and reduced result-object/parameter allocation are Phase 2 opportunities. No performance improvement is claimed, and no benchmark campaign is started during Phase 1.

Tokens ABI 10 preserves the original live JavaScript iterator and callback result array without a native duplicate. Iterator steps, field reads, range construction, callback dispatch, and map pushes still cross the boundary per token. Descriptor preflight scans the initial sequence, and callback-installed nonnumeric values require a caught host coercion. Fusing compatible callback-free consumers and retaining shared token ownership remain Phase 2 opportunities. No performance improvement is claimed for this correctness-focused traversal migration.

Tokens ABI 11 avoids a full sparse record transfer for line selection. Each binary-search/duplicate-expansion read still crosses the host boundary, and each successful query returns a two-number typed array before the existing source-view construction. Shared piece ownership and fused selection/composition remain Phase 2 opportunities. No new benchmark or performance improvement claim accompanies this Phase 1 boundary.

Cursor-columns ABI 1 borrows primitive host strings and reads only units required for a prefix or inverse query, avoiding an O(full line) transfer when the original operation visits a short prefix. Traversal retains per-unit host calls and prototype-descriptor preflight; public tab-stop calls add a scalar boundary. The native indexed grapheme table is static and adds module data. Chunked borrowed access, shared model storage, batched column queries, and reduced descriptor checks remain Phase 2 opportunities. No performance or application-memory improvement is claimed for this functional migration.

Cursor-columns ABI 2 borrows initial-whitespace text for atomic indentation movement. The original second scan for full-stop validation remains, and every requested unit crosses the host boundary. Whitespace queries allocate and transfer a three-number result; atomic movements return one scalar. Shared model text access, fused cursor consumers, and reduced descriptor/result overhead remain Phase 2 opportunities. No performance gain is claimed, and no benchmark campaign accompanies this Phase 1 migration.

Unicode ABI 1 returns scalar code points or grapheme offsets without copying complete strings or retaining native iterator state. Original iterator objects remain in JavaScript; supported grapheme steps preflight method/field descriptors and read host units individually. Weak sets retain only weak instance membership and reject proxies before preflight; the disabled core skips the reflective checks. Fused character-count/range consumers, shared model text access, and reduced per-step preflight remain Phase 2 opportunities. No performance or memory improvement is claimed for this functional migration.

Unicode ABI 2 computes a complete Backspace boundary through one scalar binding, without transferring an entire source line or creating native iterator state. Every preceding UTF-16 unit still uses a host read, and code-point method descriptors are checked before fusing the original algorithm. Shared model storage and coarser command/edit boundaries remain Phase 2 opportunities. No benchmark campaign or performance improvement claim accompanies this Phase 1 migration.

Decorations ABI 1 performs endpoint computation in Rust while original interval nodes and tree state remain in JavaScript. Each affected node incurs descriptor preflight, a scalar-parameter binding, and a two-number result allocation/copyback. Whole-tree edit ownership and a coarser decoration transaction boundary remain Phase 2 opportunities. No performance gain is claimed, and no benchmark campaign accompanies this Phase 1 migration.

Cursor-columns ABI 3 scans word-part boundaries through borrowed host units and returns one scalar column. Adjacent pairs and acronym lookahead still require individual host reads, while model callbacks, Position construction, and higher-level word segmentation remain in JavaScript. Shared model storage and complete cursor-operation ownership remain Phase 2 opportunities. No benchmark campaign or performance gain claim accompanies this migration.

Text-shape ABI 1 encodes/transfers complete UTF-16 input for EOL counts and reuses the model scanner, including its text-flag classification. This keeps the exact model contract but adds temporary copying and unnecessary flags for count-only consumers. Indentation normalization uses per-prefix host reads and transfers a newly allocated ASCII prefix plus its suffix coordinate. Shared model text, fused edit/token consumers, a count-only scanner mode, and reduced prefix/result allocation remain Phase 2 opportunities. No performance improvement is claimed for this Phase 1 boundary.

Bracket-edits ABI 1 composes prepared queued edits in Rust and retains the original provider traversal in JavaScript. Each call allocates two numeric mapping packets, a temporary native queue/result vector, and a returned numeric packet before constructing the original edit objects. Mapping descriptors and overridden helper methods retain fallback compatibility. Persistent bracket-tree/edit ownership and a coarser parser transaction boundary remain Phase 2 opportunities. No benchmark campaign or performance/resource improvement claim accompanies this Phase 1 migration.

Bracket-lengths ABI 1 integrates scalar arithmetic and packed-coordinate conversion beneath existing bracket, parser, tokenizer, and position-mapping consumers. Each arithmetic operation crosses a scalar boundary; object conversions allocate a two-number result before constructing the existing host objects. Text-length queries reuse the native EOL scanner and transfer complete UTF-16 source temporarily. Fusing complete parser/position-map transactions, sharing model text, and reducing per-operation preflight/results remain Phase 2 opportunities. No benchmark campaign or performance improvement claim accompanies this Phase 1 migration.

Small-set ABI 1 keeps the original cached set objects and additional-word arrays while Rust executes add, merge, membership, intersection, and equality. Queries read only required words through host callbacks; mutation constructs a temporary numeric result and the original host word array. Descriptor preflight and per-word callback access still cross the boundary, and set object/cache ownership remains in JavaScript for existing aliases. Fused parser operations, native immutable set ownership, and reduced mutation result copying remain Phase 2 opportunities. No benchmark campaign or performance/resource improvement claim accompanies this Phase 1 migration.

Bracket-trees ABI 1 constructs equal-height lists through ordered host factory/slot-write callbacks. Rust retains no duplicate node index and holds the final node reference only in a result handle that is consumed and immediately freed. Every parent construction still crosses the host boundary and can invoke nested length/set kernels through the original AST factory. Native AST ownership, fused construction/metadata updates, and reduced result-handle overhead remain Phase 2 opportunities. No benchmark campaign or performance/resource improvement claim accompanies this Phase 1 migration.

Bracket-trees ABI 2 owns height-run concatenation and append/prepend balancing through live AST capabilities. Original parent arrays and their push/index behavior remain in the host, preserving externally observed virtual-method and partial-mutation semantics. Native control flow retains only scoped node references; property comparisons, mutable-edge access, child removal/insertion, and metadata updates still cross the boundary. Complete native AST/parent-stack ownership and fused mutation/metadata operations remain Phase 2 opportunities. No benchmark campaign or performance/resource improvement claim accompanies this Phase 1 migration.

Bracket-node-reader ABI 1 owns longest-node lookup, child scanning, and stack advancement through live reader capabilities. Original arrays, field/slot reads, predicate calls, and state mutations still cross the boundary; normal advancement can enter a nested native call through the existing overridable method. Results use a consumed/freed scoped reference handle and retain no persistent duplicate traversal index. Native AST/reader ownership, fused lookup/advancement, shared model coordinates, and reduced callback/result-handle overhead remain Phase 2 opportunities. No benchmark campaign or performance/resource improvement claim accompanies this Phase 1 migration.

Bracket-position-mapper ABI 1 drives complete edit transitions and numeric translation arithmetic through the original live caches and cursor fields. Ordered property reads/writes, packed-coordinate helpers, and virtual translations still cross the boundary; normal translations can enter nested native calls. Each translation/distance creates a consumed/freed result reference, and every native entry creates temporary host capabilities. Remaining Phase 1 work includes persistent mapper/cache ownership and parser integration at coarser boundaries. After functional migration, profiling can assess callback/result allocation, fused coordinate arithmetic, and shared edit/model storage. No benchmark campaign or performance/resource improvement claim accompanies this Phase 1 migration.

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

This capture demonstrates faster counting and long-line column queries, while peak process memory is higher. Avoided decoded line transfers do not establish total memory savings; the shared WASM runtime and persistent rope remain part of the measured process. Whole-editor input latency, supported platforms, and the full resource gate remain pending. Raw runs stay ignored in `.build/rust/queries-benchmark-scalar.json`.

## Indentation detection observation

The `--queries` runner was expanded on November 6, 2026 with release storage ABI 6 bindings and the same Windows x64, Node `24.22.1`, and Rust `1.99.1` environment. It now additionally runs 100 indentation detections with tab-size default 4 and alternating space preferences. Two detections warm the implementation before timing. Other scalar queries retain the same workloads, and all complete checksums match. Three alternating fresh processes per engine provide the following medians in milliseconds.

| Fixture | Existing 100 detections | Rust/WASM 100 detections | Existing columns | Rust/WASM columns | Existing 200 counts | Rust/WASM 200 counts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Short lines | 44.78 | 17.95 | 1.87 | 4.62 | 6.51 | 1.34 |
| Unicode lines | 45.96 | 18.65 | 1.96 | 4.84 | 6.30 | 1.36 |
| Long line | 98.52 | 6.86 | 109.96 | 23.37 | 30.25 | 7.47 |
| Whitespace-heavy source | 40.80 | 10.70 | 7.41 | 6.52 | 15.47 | 4.32 |

The first native implementation repeatedly resolved line coordinates and was slower on short lines: 127.99 versus 45.46 milliseconds, and 121.99 versus 45.35 milliseconds on Unicode. Replacing that traversal with a sequential borrowed leaf cursor avoids separate line lookups and decoded strings. The final detection capture improves on the existing implementation for every fixture; short scalar column queries retain their earlier regression. The long-line fixture slows within the native implementation because the cursor scans content/prefixes sequentially, while the previous implementation used indexed line ends. The final within-capture comparisons remain the relevant evidence.

| Fixture | Existing process peak RSS MiB | Rust process peak RSS MiB | Rust linear memory MiB |
| --- | ---: | ---: | ---: |
| Short lines | 63.84 | 67.02 | 1.69 |
| Unicode lines | 64.04 | 67.14 | 1.44 |
| Long line | 63.51 | 66.54 | 1.50 |
| Whitespace-heavy source | 58.87 | 66.99 | 1.75 |

Process peak RSS remains higher with Rust. These figures include setup, warm-up, all query workloads, and checksum construction; they do not isolate the indentation algorithm's live allocations. Application startup/input latency and whole-editor resource improvements remain unverified. Final runs are ignored in `.build/rust/queries-benchmark.json`; the initial coordinate-based traversal is retained in `.build/rust/queries-benchmark-indentation-initial.json`.

## Indentation folding observation

Measured on November 6, 2026, Windows x64, Node `24.22.1`, Rust `1.99.1`, and release storage ABI 7 bindings. The dedicated `--folding` runner alternates three fresh processes per engine. Each workload computes 100 folding results, alternating off-side handling, with/without regex markers and limits 5,000/32. Two computations per workload warm the model before timing. Model setup and the final complete endpoint checksum are outside the timer; result creation and the original limit-report callback remain inside. Checksums match across engines. Times are medians in milliseconds.

| Fixture | Existing plain, limit 5,000 | Rust plain, limit 5,000 | Existing plain, limit 32 | Rust plain, limit 32 | Existing markers, limit 5,000 | Rust markers, limit 5,000 | Existing markers, limit 32 | Rust markers, limit 32 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Short lines | 41.66 | 22.47 | 49.16 | 20.65 | 68.98 | 125.90 | 79.35 | 119.23 |
| Unicode lines | 42.55 | 24.99 | 51.45 | 22.05 | 74.12 | 343.79 | 82.51 | 330.32 |
| Long mixed prefixes | 41.20 | 23.81 | 35.67 | 24.43 | 69.73 | 84.53 | 69.85 | 84.98 |
| Deep indentation | 142.17 | 93.43 | 213.74 | 93.99 | 291.50 | 378.71 | 361.98 | 365.06 |

Short/Unicode fixtures repeat 2,048 five-line blocks, including region markers, blank lines, and lone/paired surrogate units. The long fixture contains 65,536 space/tab pairs in one prefix. Deep indentation repeats 128 blocks with 1,500–1,504 spaces. Native plain folding borrows source leaves and avoids the original line decoding and second limit-selection pass; it improves in every fixture. Marker folding retains regressions from lossless text transfer, JavaScript regex evaluation, and whitespace classification.

Initial per-line callbacks took 592.11 milliseconds on short-line markers and 716.77 on Unicode, while floating-point tab modulo took 140.55 on plain long prefixes. Bounded backward line transfer reduced callbacks' text cost; batches of marker bytes then reduced cross-boundary calls. Checked integer tab arithmetic reduced the long-prefix path. The final marker results remain slower than the original, and intermediate deep/long marker timings varied substantially. The final within-capture comparisons are the relevant evidence; the stage remains opt-in.

| Fixture | Existing process peak RSS MiB | Rust process peak RSS MiB | Rust linear memory MiB |
| --- | ---: | ---: | ---: |
| Short lines | 80.21 | 78.14 | 1.31 |
| Unicode lines | 80.75 | 78.46 | 1.44 |
| Long mixed prefixes | 67.68 | 73.57 | 1.56 |
| Deep indentation | 73.22 | 77.14 | 2.69 |

Peak RSS is slightly lower for the short/Unicode fixtures and higher for long/deep prefixes. These process observations include setup, all four workloads, warm-up, and endpoint checksum work; they do not establish whole-editor memory savings. Temporary native candidate/region storage is released on return or callback failure, and one decoded line cache remains in the existing adapter. Raw runs are ignored in `.build/rust/folding-benchmark.json`; earlier captures remain in `.build/rust/folding-benchmark-initial.json` and `.build/rust/folding-benchmark-backward-cache.json`.

## Indentation guide observation

Measured on November 6, 2026 with Windows x64, Node `24.22.1`, Rust `1.99.1`, and release storage ABI 8 bindings. The `--guides` runner alternates three fresh processes per engine. Viewport queries reuse twenty preconstructed windows of up to 128 lines for 100 calls; active queries use the same starting lines with full-document bounds. Twenty viewport/active pairs warm the model before timing. Model setup is outside the timer; result consumption contributes to the complete matching checksum inside the timer. Times are medians in milliseconds.

| Fixture | Existing 100 viewports | Rust 100 viewports | Active queries | Existing active | Rust active |
| --- | ---: | ---: | ---: | ---: | ---: |
| Short lines | 1.62 | 1.56 | 1,000 | 1.07 | 3.02 |
| Unicode lines | 1.31 | 1.51 | 1,000 | 0.94 | 2.67 |
| Long mixed prefixes | 14.54 | 8.94 | 1,000 | 253.59 | 182.91 |
| Long whitespace run | 27.53 | 14.57 | 100 | 80.03 | 45.52 |

Short/Unicode fixtures repeat 2,048 four-line blocks, with blank lines and paired/lone surrogates. The long prefix contains 65,536 space/tab pairs; the whitespace fixture contains 8,192 blank tab/space lines between content. Initial native queries repeatedly resolved line bounds and regressed on whitespace: 75.43 milliseconds for viewports and 223.52 for active queries versus 25.76/76.84 existing. Scoped borrowed cursors now reuse adjacent line bounds and leaf text. The final capture improves both long-prefix and whitespace workloads. Short active queries remain slower because small scopes still allocate/transfer a result and cross the WASM boundary; short viewport timings are close, with a Unicode regression. No default promotion follows.

| Fixture | Existing process peak RSS MiB | Rust process peak RSS MiB | Rust linear memory MiB |
| --- | ---: | ---: | ---: |
| Short lines | 70.00 | 72.17 | 1.19 |
| Unicode lines | 69.98 | 72.31 | 1.38 |
| Long mixed prefixes | 67.98 | 69.82 | 1.38 |
| Long whitespace run | 75.55 | 70.73 | 1.19 |

Peak RSS is lower for the whitespace fixture and higher for the others. These observations include setup, warm-up, both query workloads, and checksum consumption; they do not isolate guide allocations or establish whole-editor resource improvement. No persistent query state or decoded source line cache is added by native guides. Current raw runs stay ignored in `.build/rust/guides-benchmark.json`, with the initial capture in `.build/rust/guides-benchmark-initial.json`.

## Semantic metadata overlay observation

Measured on November 6, 2026 with Windows x64, Node `24.22.1`, Rust `1.99.1`, and release tokens ABI 1 bindings. The `--tokens` runner alternates three fresh processes per implementation and fixture. It warms 128 merges, then times calls through the actual `SparseTokensStore.addSparseTokens`, including input/output conversion, result construction, and checksum consumption of every output word. Setup remains outside the timer. Complete checksums match; times are medians in milliseconds.

| Fixture | Calls | Syntax/semantic tokens per line | Existing merge | Rust merge |
| --- | ---: | ---: | ---: | ---: |
| Short lines | 100,000 | 8 / 4 | 110.72 | 107.65 |
| Dense line | 1,000 | 2,048 / 1,024 | 180.43 | 128.69 |
| Unicode dense line | 1,000 | 2,048 / 1,024 | 174.09 | 135.07 |
| Clamped provider spans | 1,000 | 2,048 / 1,024 | 145.13 | 115.17 |

Short lines contain 32 UTF-16 units; dense lines contain 8,192. Unicode retains paired/lone surrogate units, while clamped spans extend beyond the line. All six semantic fields participate. Rust avoids the temporary JavaScript number array and its subsequent typed-array conversion. Dense merges improve in this capture; the short-line difference is small and does not establish a reliable application improvement. The implementation retains source ownership and aliases, so both encoded inputs still cross the generated binding on every call.

| Fixture | Existing process peak RSS MiB | Rust process peak RSS MiB | Rust linear memory MiB |
| --- | ---: | ---: | ---: |
| Short lines | 52.93 | 63.41 | 1.13 |
| Dense line | 57.07 | 62.67 | 1.19 |
| Unicode dense line | 57.13 | 62.28 | 1.19 |
| Clamped provider spans | 65.40 | 62.50 | 1.19 |

Process peak RSS is higher with Rust in three fixtures and lower in the clamped fixture. These observations include module loading, setup, warm-up, and all measured merges. Temporary native result state is dropped after each call; no persistent token store is added. This is metadata composition evidence, not tokenization/rendering latency or whole-editor resource evidence. Raw runs remain ignored in `.build/rust/tokens-benchmark.json`.

## Sparse semantic token adjustment observation

Measured on November 6, 2026 with Windows x64, Node `24.22.1`, Rust `1.99.1`, and release tokens ABI 2 bindings. The `--sparse-tokens` runner alternates three fresh processes per engine. It warms 32 edit/split pairs, then times operations through actual `SparseMultilineTokens` methods. Editing includes insertion and its inverse deletion; splitting creates independent blocks and reads all resulting line-token views. Every backing/output word contributes to identical checksums inside timing. Record/position setup remains outside timing. Times are medians in milliseconds.

| Fixture | Calls per workload | Tokens | Existing edit pairs | Rust edit pairs | Existing splits | Rust splits |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Small block | 10,000 | 8 | 8.37 | 27.50 | 3.27 | 8.25 |
| Dense block | 1,000 | 8,192 | 406.28 | 407.91 | 706.18 | 642.91 |
| Multiline insertion | 1,000 | 8,192 | 424.79 | 426.12 | 741.90 | 627.58 |
| Unicode insertion | 1,000 | 8,192 | 402.83 | 410.53 | 701.24 | 617.02 |

Tokens are distributed eight per line. Positions cycle through 32 preconstructed interior ranges; insertions contain one ASCII character, two lines, or lone/paired surrogate units. Multiline insertion intentionally cuts the enclosing semantic token with the original affinity rule; inverse deletion preserves that adjusted state. Dense split timings improve while edit timings remain close, including a Unicode regression. Small blocks are slower because allocation and generated transfers dominate their few records. No default promotion follows.

| Fixture | Existing process peak RSS MiB | Rust process peak RSS MiB | Rust linear memory MiB |
| --- | ---: | ---: | ---: |
| Small block | 50.61 | 63.61 | 1.13 |
| Dense block | 97.96 | 67.93 | 1.44 |
| Multiline insertion | 97.77 | 68.38 | 1.44 |
| Unicode insertion | 97.95 | 68.02 | 1.44 |

Dense runs have lower process peak RSS in this capture; small blocks have higher RSS. Native splits avoid the two intermediate JavaScript number arrays, but generated input/result transfers and independent output buffers still allocate. Mutable input views retain JavaScript ownership and copy back after edits/removals; native adjustment adds no persistent store or duplicate document. These observations include module loading, warm-up, both workloads, and result consumption. They do not establish whole-editor memory or typing-latency improvement. Raw runs remain ignored in `.build/rust/sparse-tokens-benchmark.json`.

## Contiguous syntax token adjustment observation

Measured on November 6, 2026 with Windows x64, Node `24.22.1`, Rust `1.99.1`, and release tokens ABI 3 bindings. The `--contiguous-tokens` runner alternates three fresh processes per engine, warms 32 edit/append pairs, and times actual `ContiguousTokensEditing` calls. Each edit inserts one character and deletes it again without changing token topology. Concatenation creates an independent double-length encoding. Every output word contributes to identical checksums inside timing; input setup remains outside timing. Times are medians in milliseconds.

| Fixture | Calls per workload | Tokens | Existing edit pairs | Rust edit pairs | Existing concatenation | Rust concatenation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Small line | 10,000 | 8 | 4.41 | 10.01 | 8.13 | 11.46 |
| Dense line | 1,000 | 8,192 | 211.85 | 213.07 | 439.09 | 452.18 |
| Dense line, suffix edit | 1,000 | 8,192 | 202.78 | 207.18 | 466.75 | 448.30 |
| Long line, one token | 10,000 | 1 | 1.81 | 7.84 | 3.52 | 6.92 |

Ordinary token widths are eight UTF-16 units; the one-token line has 1,048,576 units. Edits occur at offset 2, except the suffix fixture, which edits two units before the final end. Generated mutable input transfer/copyback still processes whole streams even for narrow edits. Small/one-token paths regress, dense timings are close, and only suffix-fixture concatenation is faster in this capture. These observations do not justify promoting the stage by default.

| Fixture | Existing process peak RSS MiB | Rust process peak RSS MiB | Rust linear memory MiB |
| --- | ---: | ---: | ---: |
| Small line | 49.83 | 61.70 | 1.13 |
| Dense line | 53.04 | 65.94 | 1.50 |
| Dense line, suffix edit | 53.06 | 65.80 | 1.50 |
| Long line, one token | 50.04 | 61.66 | 1.13 |

Process peak RSS is higher with Rust in every fixture. Existing concatenation already allocates typed output directly, so this port does not remove a temporary JavaScript number array. Native mutation returns a scalar and retains no persistent token state; aliases keep existing JavaScript buffers. Observations include loading, warm-up, both workloads, and checksum consumption, and do not establish whole-editor resource improvement. Raw runs remain ignored in `.build/rust/contiguous-tokens-benchmark.json`.

## Owning syntax line-store observation

Measured on November 6, 2026 with Windows x64, Node `24.22.1`, Rust `1.99.1`, and release tokens ABI 4 bindings. The `--token-store` runner alternates three fresh processes per engine, warms 32 edit/equality pairs, then times 1,000 insert/delete pairs, 1,000 equality updates, and 10,000 line reads through actual `ContiguousTokensStore` methods. Every result word contributes to matching checksums. Store population and provider input construction remain outside timing. Provider arrays remain retained throughout, exercising their existing alias ownership. Times are medians in milliseconds.

| Fixture | Lines | Tokens per line | Existing edit pairs | Rust edit pairs | Existing equality updates | Rust equality updates | Existing line reads | Rust line reads |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Small store | 32 | 4 | 1.25 | 4.31 | 0.72 | 1.49 | 2.70 | 2.67 |
| Dense store | 1,024 | 128 | 6.04 | 8.17 | 3.57 | 3.59 | 30.60 | 31.46 |
| Multiline edits | 32 | 4 | 1.52 | 2.83 | 0.82 | 1.90 | 2.95 | 2.71 |
| Many short lines | 32,768 | 1 | 0.88 | 3.17 | 0.39 | 0.49 | 0.89 | 1.18 |

Tokens span eight UTF-16 units. Positions cycle through 32 preconstructed interior ranges; multiline insertion joins back through an unknown inserted line and retains the original token loss/default metadata behavior. Single-line replacements now reuse one temporary native stream, and identical reference equality avoids two copied comparisons. Initial small/many-line equality timings were 2.19/0.83 milliseconds versus final 1.49/0.49; dense equality became close to the reference. Edit timings still regress. Line reads are close in two fixtures and slower in dense/many-line fixtures. The index owner preserves compatibility but does not yet improve these representative resource/latency workloads.

| Fixture | Existing process peak RSS MiB | Rust process peak RSS MiB | Rust linear memory MiB |
| --- | ---: | ---: | ---: |
| Small store | 50.56 | 61.84 | 1.13 |
| Dense store | 54.69 | 64.58 | 1.13 |
| Multiline edits | 50.96 | 62.27 | 1.13 |
| Many short lines | 78.45 | 89.39 | 1.81 |

Process peak RSS remains higher with Rust in every fixture. The owner replaces the JavaScript line-reference index with a Rust vector and generated external references; encoded buffers retain JavaScript ownership, and temporary native streams still copy for mutation. Flush and disposal release references/index capacity without invalidating held buffers. Observations include loading, population, warm-up, all workloads, and checksum consumption; they do not establish whole-editor improvement. Final raw runs remain ignored in `.build/rust/token-store-benchmark.json`, with the initial capture in `.build/rust/token-store-benchmark-initial.json`.

## Sparse piece-orchestration observation

Measured on November 6, 2026 with Windows x64, Node `24.22.1`, Rust `1.99.1`, and release tokens ABI 5 bindings. The `--sparse-store` runner alternates three fresh processes per engine, warms 32 edit/partial-update pairs, and times 200 insert/delete pairs, 200 partial replacements, and 10,000 merged line reads through actual `SparseTokensStore` methods. Provider inputs and replacement pieces are constructed outside timing. Every merged word and returned partial range contributes to matching checksums inside timing; retained input arrays and remaining block records also contribute to the final checksum. Times are medians in milliseconds.

| Fixture | Initial pieces | Lines per piece | Tokens per line | Existing edit pairs | Rust edit pairs | Existing partial updates | Rust partial updates | Existing line reads | Rust line reads |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Small store | 8 | 4 | 4 | 1.72 | 7.32 | 0.96 | 2.75 | 9.98 | 16.95 |
| Dense store | 64 | 8 | 32 | 2.73 | 18.08 | 1.56 | 4.47 | 29.96 | 32.77 |
| Multiline edits | 64 | 8 | 4 | 3.05 | 17.67 | 1.39 | 4.36 | 10.16 | 16.69 |
| Many pieces | 4,096 | 1 | 1 | 21.27 | 509.12 | 3.68 | 44.98 | 4.76 | 14.35 |

Positions cycle through 32 preconstructed interior ranges. Single-line insertion/deletion preserves topology; multiline insertion joins back through the existing token-adjustment behavior. Each partial update replaces one complete line and can split a piece. The owner keeps original arrays and piece objects; semantic merging and affected piece edits use their native kernels. Initial edits nested a JavaScript piece callback and a second native call for every block; the many-piece median was 1,298.57 milliseconds. Direct standard-piece editing now runs within the owner and avoids copying unaffected record streams, reducing that median to 509.12 milliseconds. It remains roughly 24 times slower than the reference, because numerous generated object-property accesses still cross the boundary for each piece. Partial updates retain a large many-piece regression, and reads also regress. Persistent native piece state and a coarser object boundary remain necessary before promotion.

| Fixture | Existing process peak RSS MiB | Rust process peak RSS MiB | Rust linear memory MiB |
| --- | ---: | ---: | ---: |
| Small store | 55.32 | 63.36 | 1.13 |
| Dense store | 56.15 | 64.44 | 1.13 |
| Multiline edits | 54.58 | 63.80 | 1.13 |
| Many pieces | 60.94 | 78.28 | 1.13 |

Process peak RSS is higher with Rust in every fixture. The owner keeps the original JavaScript array, objects, and encoded buffers, preserving existing external aliases without retaining a second persistent encoding. Temporary streams are copied only for affected standard pieces. Flush/disposal release the owner references, and unsupported-state fallback exports the same array before freeing the native owner. Observations include loading, population, warm-up, all workloads, and checksum consumption; they do not establish application resource improvements. ABI 5 raw runs remain ignored in `.build/rust/sparse-store-benchmark-abi5.json`, with the initial capture in `.build/rust/sparse-store-benchmark-initial.json`.

## Contiguous token block observation

Measured on November 6, 2026 with Windows x64, Node `24.22.1`, Rust `1.99.1`, and release tokens ABI 6 bindings. The `--token-block` runner alternates three fresh processes per engine, warms 32 replacements and fresh multiline edits, and times 1,000 same-line replacements plus 200 multiline edits through actual `ContiguousMultilineTokens.applyEdit` calls. Each multiline edit starts with a freshly cloned provider index and records prepared outside its timer; it replaces a three-line span or removes the block prefix. Timers include changed boundary-line consumption and block coordinates. Complete retained provider records also contribute to identical final checksums. Times are medians in milliseconds.

| Fixture | Lines | Tokens per line | Existing replacements | Rust replacements | Existing multiline edits | Rust multiline edits |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Small block | 8 | 4 | 1.19 | 3.39 | 0.63 | 2.06 |
| Dense block | 64 | 128 | 5.07 | 8.10 | 1.48 | 2.60 |
| Prefix removal | 8 | 4 | 1.22 | 3.91 | 0.27 | 0.65 |
| Many lines | 32,768 | 1 | 0.84 | 3.25 | 27.98 | 30.39 |

Same-line replacements delete one interior character and insert it again, preserving topology while mutating retained inputs. Dense records and all changed boundaries cross the native scope once without nested kernel bindings. Multiline operations retain original splices, slices, and absolute insertion positions. Shared generated host-array operations create one final concatenated index without transferring each slot or creating an extra concatenation index. Small calls remain slower due to preflight and binding overhead. Large-block edits are close to the reference; this does not establish an application performance improvement.

| Fixture | Existing process peak RSS MiB | Rust process peak RSS MiB | Rust linear memory MiB |
| --- | ---: | ---: | ---: |
| Small block | 46.81 | 60.27 | 1.13 |
| Dense block | 53.66 | 67.88 | 1.13 |
| Prefix removal | 46.36 | 60.05 | 1.13 |
| Many lines | 339.50 | 349.39 | 1.13 |

Peak RSS is higher with Rust in every fixture. Fresh-block preparation dominates the many-line process memory observations and remains outside timing; these figures do not measure persistent block state or whole-editor memory. The native call retains no block handle or second encoded representation after return. Raw runs remain ignored in `.build/rust/token-block-benchmark.json`, with the initial two-concatenation capture in `.build/rust/token-block-benchmark-initial.json`.

## Sparse host-array operation observation

Tokens ABI 6 also replaces individual sparse piece slot shifts/copies with the existing host-array splice/slice/concat primitives called from Rust. Under the same `--sparse-store` method and fixtures, current existing/Rust partial-update medians are 1.22/2.28 milliseconds for small stores, 1.56/3.33 for dense stores, 1.24/3.11 for multiline edits, and 3.69/15.98 for 4,096 pieces. The many-piece Rust partial-update median decreased from 44.98 milliseconds in the ABI 5 capture to 15.98, while still regressing against the reference. Complete checksums match. Many-piece edit pairs remain 20.73/505.00 milliseconds, and merged reads remain 4.83/13.85; the per-piece scalar/object boundary is still expensive. Peak RSS remains higher with Rust in every fixture; many-piece process medians are 60.77/78.10 MiB, and native linear memory remains 1.13 MiB. No default promotion follows. Current raw runs remain ignored in `.build/rust/sparse-store-benchmark.json`; the ABI 5 capture remains in `.build/rust/sparse-store-benchmark-abi5.json`.
