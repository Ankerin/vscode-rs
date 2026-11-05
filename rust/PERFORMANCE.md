# Rust Text Storage Performance

## Method

Run `pnpm run build-rust-editor` followed by `pnpm run benchmark-rust-editor`. The benchmark alternates the original and Rust implementations in three fresh Node processes per fixture each. Both use the actual existing `PieceTreeTextBuffer` wrapper and its model construction path. Rust uses a release WebAssembly build; the reference uses the current TypeScript sources bundled with the same esbuild recipe. Eight construction/disposal iterations warm the adapter and allocator before timing. The runner verifies matching workload checksums within each fixture. Keep other builds and workload-heavy processes stopped during measurement.

Each workload creates and disposes 20 documents, performs 2,000 distributed insertions in a fresh document, resolves 20,000 offsets, reads consecutive and distributed random lines, runs 20 present and 20 absent literal searches, retains 1,000 snapshots of the fragmented document, drains ten snapshots, and extracts the whole document. Searches stop at 1,000 results. The inserted ASCII text is `inserted`; Unicode edits may split surrogate pairs, so their subsequent transfers must preserve lone surrogates. Raw results and process-memory observations are stored in `.build/rust/benchmark.json`, which is ignored by Git.

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

Measured on November 5, 2026, Windows x64, repository-pinned Node `24.22.1`, Rust `1.99.1`, wasm-bindgen `0.2.130`, js-sys `0.3.107`, and memchr `2.8.3`. The implementation uses compact Latin-1 leaves with shared backing/indexes, lazy sequential snapshots, storage ABI 2, direct single-leaf transfers, adaptive line caching, and native literal search. ASCII output uses the binding's string path; non-ASCII output uses UTF-16 typed arrays and native JavaScript decoding. All six runs per fixture produced matching checksums. Times below are medians of three processes, in milliseconds.

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
| Create 20 documents | 47.58 | 94.45 |
| Perform 2,000 edits | 10.51 | 11.92 |
| Resolve 20,000 positions | 4.25 | 7.12 |
| Read consecutive lines | 2.76 | 2.46 |
| Read random lines | 3.57 | 16.39 |
| Run 20 present literal searches | 6.09 | 4.39 |
| Run 20 absent literal searches | 5,714.41 | 9.51 |
| Retain 1,000 snapshots | 83.02 | 0.49 |
| Drain ten snapshots | 1.70 | 3.99 |
| Extract the entire document | 0.44 | 0.70 |

### Latin-1 source

| Workload | Existing | Rust/WASM |
| --- | ---: | ---: |
| Create 20 documents | 36.13 | 91.30 |
| Perform 2,000 edits | 9.84 | 11.25 |
| Resolve 20,000 positions | 4.20 | 6.38 |
| Read consecutive lines | 2.50 | 3.58 |
| Read random lines | 3.90 | 27.28 |
| Run 20 present literal searches | 6.26 | 4.17 |
| Run 20 absent literal searches | 4,773.53 | 8.88 |
| Retain 1,000 snapshots | 86.35 | 0.65 |
| Drain ten snapshots | 1.80 | 18.51 |
| Extract the entire document | 3.67 | 1.64 |

### Unicode source

| Workload | Existing | Rust/WASM |
| --- | ---: | ---: |
| Create 20 documents | 109.43 | 149.85 |
| Perform 2,000 edits | 11.05 | 12.96 |
| Resolve 20,000 positions | 4.52 | 6.91 |
| Read consecutive lines | 2.52 | 5.48 |
| Read random lines | 4.17 | 26.60 |
| Run 20 present literal searches | 6.10 | 4.62 |
| Run 20 absent literal searches | 4,694.67 | 10.24 |
| Retain 1,000 snapshots | 82.56 | 0.49 |
| Drain ten snapshots | 1.65 | 37.68 |
| Extract the entire document | 0.49 | 3.11 |

### Long lines

| Workload | Existing | Rust/WASM |
| --- | ---: | ---: |
| Create 20 documents | 48.23 | 110.29 |
| Perform 2,000 edits | 10.34 | 12.15 |
| Resolve 20,000 positions | 3.34 | 5.26 |
| Read consecutive lines | 1.02 | 1.23 |
| Read random lines | 6.41 | 23.32 |
| Run 20 present literal searches | 4.45 | 5.19 |
| Run 20 absent literal searches | 3.60 | 3.72 |
| Retain 1,000 snapshots | 83.72 | 0.46 |
| Drain ten snapshots | 1.67 | 3.91 |
| Extract the entire document | 0.50 | 0.64 |

## Interpretation and next work

- Persistent-root snapshots retain their substantial creation advantage in all four fixtures. Snapshot consumption still regresses, particularly for Unicode after edits split surrogate pairs. Efficient creation alone does not make saving efficient.
- Native literal search avoids per-line string extraction. The absent-marker scan improves substantially on the fragmented short-line fixtures, while both long-line searches remain close to the reference. Present short-line searches reach the result limit early; these timings do not describe a full scan or regex/word-boundary performance.
- Consecutive ASCII line reads improve, but random line reads still regress on every fixture. Keep batching at meaningful model/view boundaries rather than growing a cache to hide distributed-read costs or retaining all decoded lines.
- Construction and position lookup remain slower, as do distributed edits in this observation. Reduce tree/index allocation and binding-call overhead, and consider moving the consuming view/model algorithms into Rust before promotion.
- One-byte Latin-1 payloads halve that leaf's text bytes compared with the previous Rust representation. This is a representation fact, not a measured total-memory saving; nodes, shared indexes, retained versions, decoding buffers, and allocator capacity still contribute.
- Extend measurements to non-ASCII content, large and long-line files, many documents, actual editor interaction, Electron process trees, workers, remote models, notebooks, and extensions before assigning product promotion budgets.

These results are not sufficient to promote Rust storage as the default or claim that the application is faster or uses fewer resources overall. The historical and current tables use different Node versions and implementation stages; use the existing/Rust pair within the current run for direct comparisons.

Process RSS and heap observations in the raw artifact are sampled at one workload point while most snapshots remain retained. They are not a peak-memory profiler or an application-wide memory baseline. V8 and WebAssembly allocators can retain capacity after disposal, and submillisecond measurements and GC-sensitive extraction timings vary between runs. Do not interpret a smaller JavaScript heap as equivalent total-memory savings.
