# Rust Editor

This workspace starts the Rust migration of Code OSS. The full editor has not been rewritten. The current implementation replaces text storage when explicitly enabled; the existing workbench, editor rendering, edit validation, undo service, extension host, and desktop shell remain in place.

See [Architecture](ARCHITECTURE.md) for the complete target, subsystem boundaries, migration order, and acceptance gates. See [Contributing](CONTRIBUTING.md) for formatting, validation, and compatibility requirements.

## Structure

| Directory | Responsibility | Status |
| --- | --- | --- |
| `editor-core/` | Platform-independent UTF-16 storage, positions, edits, literal search, immutable snapshots, sequence alignment, and character diff refinement | Implemented and tested natively |
| `editor-wasm/` | Typed WebAssembly bindings for the same Rust core | Implemented and tested against existing editor models |
| `../src/vs/editor/common/model/rustTextBuffer/` | Storage adapter beneath `PieceTreeTextBuffer` | Implemented; opt-in |
| `../src/vs/editor/browser/model/` | Browser resource loading of generated bindings | Implemented for desktop startup |
| `../src/vs/editor/common/services/textModelSync/` | Rust-backed editor worker mirror storage and lifecycle | Implemented; follows the renderer's opt-in initialization |
| `../src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/` | Native dynamic/Myers alignment, scored shift/join optimization, and owning character refinement | Implemented; follows the core registration |
| `../build/rust/` | Binding generation and compatibility test runner | Implemented |
| `../test/rust/` | Tests against the existing buffer and text model | Implemented |
| `../.github/workflows/rust-editor.yml` | Native OS matrix and WebAssembly compatibility CI | Configured; remote runs not verified locally |

The workspace is independent of `cli/`, `copilot_shim/`, and `build/win32/`. Their existing manifests and lockfiles are retained.

## Setup

Install Rust through Rustup and use its `cargo` and `rustc` shims. The workspace pins Rust **1.99.1**, the latest stable release verified on November 5, 2026, together with `rustfmt`, Clippy, and `wasm32-unknown-unknown`. Rustup selects this toolchain when commands run in `rust/`. A separately installed compiler earlier in `PATH` must not shadow the Rustup shims.

Install the matching binding generator from this workspace:

```sh
cd rust
cargo install wasm-bindgen-cli --version 0.2.130 --locked
```

Use the repository's pinned pnpm version for JavaScript dependencies. The compatibility runner also uses the existing `build/` package's esbuild dependency. No npm or yarn installation is required.

## Build

From the repository root:

```sh
pnpm run build-rust-editor
```

The command builds a release WebAssembly module and generates JavaScript bindings and declarations under `out/vs/editor/common/model/rustTextBuffer/`. Generated files are ignored by Git. The generator must exactly match the pinned `wasm-bindgen` crate version. Registration validates storage ABI version 3 and sequence diff ABI version 5; stale assets are rejected atomically, and desktop startup retains the existing implementations. Run this command after any client build that replaces `out/`.

From `rust/`, a native build of the core is also available:

```sh
cargo build --locked -p vscode-editor-core
```

## Run

Build and launch Code OSS using its existing development workflow, adding the internal flag:

```powershell
.\scripts\code.bat --enable-rust-text-buffer
```

On Linux or macOS:

```sh
./scripts/code.sh --enable-rust-text-buffer
```

Desktop startup initializes the module before restoring editor documents. Successfully initialized windows log `Rust text buffer initialized`. If loading fails, the existing storage remains available and the error is logged. Without the flag, no WebAssembly asset is loaded and the current storage is used. This change does not add settings, commands, menus, or alter CSS, fonts, themes, or layout.

The flag applies to desktop renderer models and their editor worker mirrors. The worker client initializes the same generated core before synchronizing documents; a failed initialization retains the existing mirror storage. Synchronous worker fallback reuses the renderer's registration. Web startup, the server, extension-host models, and TextMate mirror subclasses are not switched. Existing models keep their storage after registration is disposed. Generated assets are not yet integrated into distributable release packaging.

## Test

From `rust/`:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

From the repository root, after building the bindings:

```sh
pnpm run test-rust-editor
```

The compatibility runner bundles the current TypeScript sources with the repository's existing esbuild dependency and runs them in Node against the generated WebAssembly module. It does not require Electron to test the storage boundary. It checks chunked input, BOM, UTF-16, default EOL selection, positions, edits, inverse edits, events, snapshots, literal and public regex search, model undo/redo, version tracking, and repeated document disposal. It also checks all Latin-1 values, bounded line-cache invalidation, long lines, and lossless transfers with surrogate pairs spanning leaves and snapshot batches. Batch checks cover malformed bindings without partial text changes, touching/equal-offset insertions, and more than 1,000 tracked edits. Native tests check AVL balance, shared leaf indexes, cached metadata, atomic invalid batches, immutable range snapshots, cross-leaf CRLF, and seeded edits and literal queries against flat references.

These checks establish compatibility for the covered scenarios. They do not establish complete feature parity, desktop visual parity, or an application-wide performance improvement. Those remain migration gates in [Architecture](ARCHITECTURE.md).

Mirror checks cover sequential dependent events, real-model edit traces with EOL changes and undo/redo, word/regex consumers, nonstandard input compatibility, and native allocation release on replacement, removal, and worker disposal. An isolated Node worker loads the actual generated module and uses the existing worker protocol. To verify the production browser transport and bootstrap in Chromium:

```sh
pnpm exec playwright install chromium
pnpm run test-rust-editor -- --browser
```

The browser fixture checks model synchronization, UTF-16 coordinates, failed WASM loading, and disposal during initialization with real browser APIs. It does not launch the workbench or establish visual parity.

Sequence diff checks compare both native algorithms with the real existing implementations over seeded numeric sequences, including NaN, infinities, fractional values, and surrogates. They check weighted line preference, timeout callback order and exceptions, expiration latching, long/equal inputs, and bounded-state fallback. All 58 repository diff fixtures are compared for display ranges, moved lines, and raw character edits with both trim-whitespace modes. The inputs and expected fixture files remain unchanged. Browser workers also compute string edits with and without a deadline through the existing RPC.

Character refinement checks compare 1,024 seeded slices with the existing complete character pipeline, including partial document ranges, empty and trimmed endpoints, ECMAScript whitespace, unpaired surrogates, ASCII words, uppercase subword boundaries, and separate raw edits. Packed line offsets and settings are validated before slice construction. Native tests also reconstruct lossless UTF-16 text from display and raw mappings. Custom timeout implementations keep the existing orchestration; standard deadlines and unlimited computation use the owning native pipeline.

The initial November 5, 2026 desktop attempt exited before workbench restoration because existing native bindings were missing and MSBuild reported `MSB8040` for required Spectre libraries. After installing the matching Visual Studio component and rebuilding native dependencies for the repository-pinned Electron `43.8.6`, isolated Rust and reference windows restored successfully with Node `24.22.1`. The Rust renderer logged successful core initialization. UI-driven typing, undo, redo, and save passed, and the saved file contained the expected text. Screenshots were opened and inspected; editor text, syntax colors, icons, and layout rendered. A normalized 1,200 by 800 Windows capture retained 1,176 differing pixels within the editor region, concentrated in outlines and scrollbar state after cursor-guide state was aligned. This limited comparison is not a passed exact-visual-parity gate. Remaining focus/animation normalization, other UI surfaces, composition/accessibility, and other platforms still need validation. Local screenshots and launch evidence remain ignored under `.agent-validation/`.

To run the existing model, search, edit, undo, decoration, and editor worker suites through the canonical Node unit runner with both storage implementations:

```sh
pnpm run build-fast --client-only
pnpm run build-rust-editor
pnpm run test-rust-editor-models
```

The Rust run preloads the same compiled adapter used by the unit runner. The existing tests are unchanged. The original piece-tree structural tests continue to run on the default implementation.

## Benchmark

From the repository root, after building the bindings:

```sh
pnpm run benchmark-rust-editor
```

The runner alternates three fresh processes for each implementation and fixture: ASCII source, Latin-1, Unicode with supplementary characters, and long lines. It exercises the same input and operations, checks a matching output checksum within each fixture, prints median timings, and saves raw runs plus process-memory observations to the ignored `.build/rust/benchmark.json`. A separate document exercises 200 batches of 32 cursor insertions. Literal searches cover both present and absent results after distributed editing. See [Performance](PERFORMANCE.md) for the current measurements and their limits. Timings are diagnostic and are not flaky pass/fail assertions.

For sequence alignment and the complete existing display/raw diff pipeline:

```sh
pnpm run benchmark-rust-editor -- --diff
```

This mode alternates three fresh processes per engine and fixture, checks identical results, and records raw timings and process peak RSS in `.build/rust/diff-benchmark.json`. It includes real deadlines; deadline checks stay at the original cell/frontier frequency. Custom timeout implementations keep their callback contract.

## Current limits

- The Rust rope uses one-byte Latin-1 leaves when all units fit, and two-byte UTF-16 leaves otherwise. Split leaves share their backing and line-ending indexes. The compact encoding reduces that leaf's text payload by half compared with the previous Rust representation; node, index, allocator, snapshot, and application overhead must still be measured before making total-memory claims.
- Surrogate-free input uses UTF-8 bindings, while surrogate-bearing input retains the UTF-16 path. ASCII output uses strings; other output retains UTF-16 typed arrays and native JavaScript decoding, preserving lone surrogates explicitly. Snapshot traversal is lazy and sequential; consecutive line reads prefetch a single batch of up to 64 lines and 32,768 units, allowing an untruncated first long line. Isolated reads copy one line directly. Whole-document extraction and EOL normalization still allocate document-sized output.
- Drained snapshots explicitly release their Rust version. An abandoned snapshot is retained until its generated binding is collected through `FinalizationRegistry`, because the existing `ITextSnapshot` contract has no disposal method.
- Rust performs the storage adapter's plain literal search without copying lines, with nonoverlapping matches and existing start-column range semantics. The core uses KMP across leaf boundaries and the `memchr` safe API to skip compact-leaf prefixes. The model submits validated replacement batches in one binding call; Rust validates all original ranges before committing. Single edits use one replacement instead of separate deletion/insertion calls. Case folding, word boundaries, capture groups, public regex/multiline search, inverse edit generation, notifications, and undo orchestration remain in their existing JavaScript implementations.
- `getPieceTree()` is an existing implementation-specific test helper. It is available only for the original storage; Rust models expose the normal `ITextBuffer` API instead.
- Dynamic/Myers alignment and both shift/join optimization passes execute in Rust. The complete character refinement additionally owns compact UTF-16 elements and line metadata, performs ECMAScript trimming and boundary classification, expands words/subwords, removes short matches, and translates display/raw ranges inside one call. Character alignment and strong equality share the same UTF-16 elements. Source lines cross the boundary once per refinement and are released at the native call's end. Line hashing/scoring, line-level short-match removal, move detection, and line-range orchestration remain in TypeScript. Arbitrary dynamic equality-score callbacks, custom character timeout orchestration, and sequences without a strong-identity contract retain the existing path. Native directions, frontiers, path arenas, and character slices are bounded; unsupported states retain the existing fallback. Input/output conversion still allocates typed arrays.
- Tauri is not introduced. Changing the rendering engine is a separate decision that must pass the cross-platform visual and interaction gates.
