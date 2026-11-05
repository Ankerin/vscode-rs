# Rust Editor

This workspace starts the Rust migration of Code OSS. The full editor has not been rewritten. The current implementation replaces text storage when explicitly enabled; the existing workbench, editor rendering, edit validation, undo service, extension host, and desktop shell remain in place.

See [Architecture](ARCHITECTURE.md) for the complete target, subsystem boundaries, migration order, and acceptance gates. See [Contributing](CONTRIBUTING.md) for formatting, validation, and compatibility requirements.

## Structure

| Directory | Responsibility | Status |
| --- | --- | --- |
| `editor-core/` | Platform-independent UTF-16 text storage, positions, edits, literal search, and immutable snapshots | Implemented and tested natively |
| `editor-wasm/` | Typed WebAssembly bindings for the same Rust core | Implemented and tested against existing editor models |
| `../src/vs/editor/common/model/rustTextBuffer/` | Storage adapter beneath `PieceTreeTextBuffer` | Implemented; opt-in |
| `../src/vs/editor/browser/model/` | Browser resource loading of generated bindings | Implemented for desktop startup |
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

The command builds a release WebAssembly module and generates JavaScript bindings and declarations under `out/vs/editor/common/model/rustTextBuffer/`. Generated files are ignored by Git. The generator must exactly match the pinned `wasm-bindgen` crate version. The adapter validates storage ABI version 3 before registering a factory, so stale assets are rejected during initialization and desktop startup retains the existing storage. Run this command after any client build that replaces `out/`.

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

The flag currently applies to desktop renderer models. Editor workers, web startup, the server, and extension-host models are not switched. Existing models keep their storage after registration is disposed. Generated assets are not yet integrated into distributable release packaging.

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

The November 5, 2026 desktop validation attempt used the repository-pinned Node `24.22.1` and Electron `43.8.6` after building the client and built-in extensions. The application exited before workbench restoration because its existing `@vscode/policy-watcher` native binding was missing. Rebuilding the native dependencies reported MSBuild `MSB8040`: the selected MSVC toolset lacks its required Spectre libraries. No desktop screenshot or live editing result was obtained. Prepare the required Visual Studio components and native dependencies through the existing repository setup before repeating this gate.

To run the existing model, search, edit, undo, and decoration suites through the canonical Node unit runner with both storage implementations:

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

## Current limits

- The Rust rope uses one-byte Latin-1 leaves when all units fit, and two-byte UTF-16 leaves otherwise. Split leaves share their backing and line-ending indexes. The compact encoding reduces that leaf's text payload by half compared with the previous Rust representation; node, index, allocator, snapshot, and application overhead must still be measured before making total-memory claims.
- Surrogate-free input uses UTF-8 bindings, while surrogate-bearing input retains the UTF-16 path. ASCII output uses strings; other output retains UTF-16 typed arrays and native JavaScript decoding, preserving lone surrogates explicitly. Snapshot traversal is lazy and sequential; consecutive line reads prefetch a single batch of up to 64 lines and 32,768 units, allowing an untruncated first long line. Isolated reads copy one line directly. Whole-document extraction and EOL normalization still allocate document-sized output.
- Drained snapshots explicitly release their Rust version. An abandoned snapshot is retained until its generated binding is collected through `FinalizationRegistry`, because the existing `ITextSnapshot` contract has no disposal method.
- Rust performs the storage adapter's plain literal search without copying lines, with nonoverlapping matches and existing start-column range semantics. The core uses KMP across leaf boundaries and the `memchr` safe API to skip compact-leaf prefixes. The model submits validated replacement batches in one binding call; Rust validates all original ranges before committing. Single edits use one replacement instead of separate deletion/insertion calls. Case folding, word boundaries, capture groups, public regex/multiline search, inverse edit generation, notifications, and undo orchestration remain in their existing JavaScript implementations.
- `getPieceTree()` is an existing implementation-specific test helper. It is available only for the original storage; Rust models expose the normal `ITextBuffer` API instead.
- Tauri is not introduced. Changing the rendering engine is a separate decision that must pass the cross-platform visual and interaction gates.
