# Rust Text Storage Performance

## Method

Run `pnpm run build-rust-editor` followed by `pnpm run benchmark-rust-editor`. The benchmark alternates the original and Rust implementations in three fresh Node processes each. Both use the actual existing `PieceTreeTextBuffer` wrapper and its model construction path. Rust uses a release WebAssembly build; the reference uses the current TypeScript sources bundled with the same esbuild recipe. Warm-up is performed before timing. The runner verifies that all runs produce the same checksum.

The workload creates a document with 20,000 repeated ASCII source lines, performs 2,000 distributed insertions, resolves 20,000 offsets, reads 20,000 lines, retains 1,000 snapshots of the fragmented document, drains ten snapshots, and extracts the whole document. Raw results and process-memory observations are stored in `.build/rust/benchmark.json`, which is ignored by Git.

## Local observation

Measured on November 5, 2026, Windows x64, Node `24.14.0`, Rust `1.99.1`, wasm-bindgen `0.2.130`, with the existing adapter's UTF-16 fast decoding and leaf line indexes. Times are medians of three processes, in milliseconds.

| Workload | Existing | Rust/WASM |
| --- | ---: | ---: |
| Create 20 documents | 48.55 | 100.34 |
| Perform 2,000 edits | 10.44 | 14.46 |
| Resolve 20,000 positions | 4.12 | 6.82 |
| Read 20,000 lines | 2.53 | 17.81 |
| Retain 1,000 snapshots | 84.75 | 0.52 |
| Drain ten snapshots | 1.67 | 22.68 |
| Extract the entire document | 0.51 | 1.64 |

Persistent-root snapshots make snapshot creation substantially cheaper for this fragmented-document workload. Other measured operations still regress through the transitional WebAssembly/string adapter. This result is not sufficient to promote the Rust storage as the default or to claim that the application is faster or uses fewer resources overall.

## Interpretation and next work

- Preserve the snapshot advantage while reducing document construction allocations and fragmented-leaf overhead.
- Evaluate compact ASCII/Latin-1 leaves against UTF-16 storage without changing editor coordinates or surrogate preservation.
- Batch line and position reads or keep the view model in Rust, so rendering does not repeatedly cross the WebAssembly boundary for tiny operations.
- Optimize snapshot iteration and text transfer. Efficient snapshot creation alone does not make saving or snapshot consumption efficient.
- Extend measurements to non-ASCII content, large and long-line files, many documents, actual editor interaction, Electron process trees, workers, remote models, notebooks, and extensions before assigning product promotion budgets.

Process RSS and heap observations in the raw artifact are sampled at one workload point, not a peak-memory profiler or an application-wide memory baseline. V8 and WebAssembly allocators can retain capacity after disposal. Do not interpret a smaller JavaScript heap as equivalent total-memory savings.
