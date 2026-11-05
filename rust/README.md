# Rust Editor

This workspace starts the Rust migration of Code OSS. The full editor has not been rewritten. The current implementation replaces text storage, buffer edit transactions, indentation queries/folding/guides, token adjustment and syntax line-state ownership, the advanced document diff pipeline, and open undo batch storage when explicitly enabled; the existing workbench, editor rendering, higher-level model validation/versioning, undo service, extension host, and desktop shell remain in place.

See [Architecture](ARCHITECTURE.md) for the complete target, subsystem boundaries, migration order, and acceptance gates. See [Contributing](CONTRIBUTING.md) for formatting, validation, and compatibility requirements.

## Structure

| Directory | Responsibility | Status |
| --- | --- | --- |
| `editor-core/` | Platform-independent UTF-16 storage, positions, model edit transactions, indentation, literal search, immutable snapshots, token metadata overlays, advanced document diff, and undo-change composition | Implemented and tested natively |
| `editor-wasm/` | Typed WebAssembly bindings and Rust syntax line-state ownership over existing browser token buffers | Implemented and tested against existing editor models |
| `../src/vs/editor/common/model/rustTextBuffer/` | Storage and model edit transaction adapter beneath `PieceTreeTextBuffer` | Implemented; opt-in |
| `../src/vs/editor/browser/model/` | Browser resource loading of generated bindings | Implemented for desktop startup |
| `../src/vs/editor/common/services/textModelSync/` | Rust-backed editor worker mirror storage and lifecycle | Implemented; follows the renderer's opt-in initialization |
| `../src/vs/editor/common/diff/defaultLinesDiffComputer/` | Complete native advanced diff with display ranges, moves, and raw edits | Implemented; follows the core registration |
| `../src/vs/editor/common/core/rustTextChanges.ts` | Native composition and owning storage for open undo batches | Implemented; follows the core registration |
| `../src/vs/editor/common/tokens/rustTokens.ts` | Native metadata composition, sparse/contiguous editing, and syntax store creation | Implemented; follows the core registration |
| `../build/rust/` | Binding generation and compatibility test runner | Implemented |
| `../test/rust/` | Tests against the existing buffer and text model | Implemented |
| `../.github/workflows/rust-editor.yml` | Native OS matrix and WebAssembly compatibility CI | Configured; remote runs not verified locally |

The workspace is independent of `cli/`, `copilot_shim/`, and `build/win32/`. Their existing manifests and lockfiles are retained.

## Setup

Install Rust through Rustup and use its `cargo` and `rustc` shims. The workspace pins Rust **1.99.1**, the latest stable release verified against the official stable channel on November 6, 2026, together with `rustfmt`, Clippy, and `wasm32-unknown-unknown`. Rustup selects this toolchain when commands run in `rust/`. A separately installed compiler earlier in `PATH` must not shadow the Rustup shims.

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

The command builds a release WebAssembly module and generates JavaScript bindings and declarations under `out/vs/editor/common/model/rustTextBuffer/`. Generated files are ignored by Git. The generator must exactly match the pinned `wasm-bindgen` crate version. Registration validates storage ABI version 8, sequence diff ABI version 8, undo-change ABI version 2, and tokens ABI version 4; stale assets are rejected atomically, and desktop startup retains the existing implementations. Run this command after any client build that replaces `out/`.

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

Line refinement checks compare 512 seeded document pairs and the dynamic/Myers transition around 1,700 combined lines. They preserve exact/trimmed identity assignment, weighted equality, negative scores for very long indentation, short unchanged line handling, surrogate distinctions, callback errors, custom timeout fallback, and expiration latching. The same identities feed native move detection.

Move checks directly compare native results for 512 seeded block permutations, repeated triples, and approximate moves. They also cover malformed packets, expiration latching, and custom timeout or unsupported-state fallback. Native checks cover half-open range subtraction/intersection, UTF-16 histograms with one newline per line, short-block filtering, and the existing line-similarity tail, trimming, and denominator quirks. Ordered candidate queues preserve first-match selection while avoiding repeated linear searches through previous matches. Histograms and all candidate state are local to the native call.

Document checks directly compare the complete native result for all 58 fixtures, both whitespace modes, 1,024 seeded document pairs, and the line-algorithm transition. They check that one call owns line alignment, whitespace scanning, character refinement, detailed line grouping, move detection, and refinement inside moves, with no separate source transfers. Native tests reconstruct lossless UTF-16 text from display and raw changes, verify first/last-line insertion/deletion coordinates, retain empty-document shortcuts, and preserve the existing document timeout flag when expiration occurs only during move detection.

Undo composition checks compare exact results over 2,048 seeded pairs of real edit batches, then apply each composed batch forward and backward to reconstruct both versions. They compare existing binary serialization bytes, retain empty-batch array identity, preserve BOM and unpaired surrogates through shared lossless UTF-16 decoding, and check malformed packets, invalid offsets, unsupported-state fallback, and atomic registration rollback. Native split and merge stages retain borrowed text fragments, concatenating only during result serialization. The canonical runner includes the unchanged `TextChange` and `TextChangeCompressor` suites as well as edit-stack tests.

Owning undo checks compare the same seeded results against persistent native batches and exercise 256 sixteen-batch traces, reconstructing both document versions after every append. Repeated aligned cursor replacements and contained fragmented edits cover allocation reuse with changing lengths and lossless Unicode. A 1,000-character append trace verifies that exactly 1,000 new UTF-16 units cross the boundary and that serialization releases the native batch. Reading or replacing public change arrays also releases it. Tests cover history replacement and model disposal, while the canonical undo service suite checks resource release when future entries or snapshot tails are discarded. Native checks retain old state after invalid/oversized appends. Single-change edits wholly within the accumulated payload update its vector in place when their coordinate and text contracts match; aligned replacements reuse per-change allocations, contained batches reuse scratch storage, and general composition constructs the next state before committing.

Complete buffer transaction checks cover 1,024 seeded batches across LF/CRLF, inverse-generation, and automatic-whitespace modes, comparing exact result objects, text, sticky flags, and retained snapshots. All 65,536 UTF-16 code units and the existing supplementary RTL pair ranges are checked against the original string classifiers. Tests cover shuffled/touching ranges, null and empty text, inverse application, the 999/1,000/1,001 reduction threshold, tracked identifiers, marker movement, malformed packets, oversized input, and unchanged-state fallback. A transaction-only binding fixture rejects separate coordinate, old-text, and application calls to verify the single native boundary.

Scalar model query checks compare 4,096 seeded visible-line ranges across all three EOL preferences, before and after edits. They preserve the original unmatched-high-surrogate skip behavior, reset it at line boundaries, and retain the existing path for CRLF-interior endpoints. Native whitespace checks run against flat references throughout seeded storage edits and shared leaf splits. A binding fixture rejects decoded line transfers during whitespace and character-count queries.

Indentation detection checks compare 768 seeded documents across fourteen numeric/space defaults, preserving mixed prefixes, comma alignment, score ties, and the two-thirds preference for size 2 over 4. They retain fractional, negative-zero, NaN, and infinite defaults when the source has no winning score. Long-line and 10,000-line-limit fixtures reject decoded line and separate line-length transfers. The unchanged canonical model tests exercise construction and explicit indentation detection through the same entry point.

Indentation folding checks compare 512 seeded documents before and after edits, with both off-side modes, five limits, and seven marker configurations. They preserve nested/incomplete markers, combined/different regex flags, empty start matches, lookbehind, tab stops, parent indices, and exact limit reports. Deep-indent fixtures preserve the existing zero-filled limit slots; long prefixes and unsupported options retain their existing behavior. Native tests cover backward line walking and bounded complete-line transfers, shared leaf splits, CRLF, and integer-to-floating-point tab arithmetic. A fixture rejects line transfers without markers, counts marker batches, and exercises malformed packets and callback exceptions. The canonical runner also executes the unchanged indentation folding and folding-region suites.

Indentation guide checks compare 256 seeded models before and after edits/option changes. They cover viewport levels, active scope preferences, both off-side modes, differing tab/indent sizes, fractional/unbounded active limits, and NaN limits. Long whitespace runs, the 50,000-distance cutoff, mixed prefixes, empty windows, invalid-range errors, and malformed binding results retain the original behavior. Native cursor checks compare adjacent/random reads after shared CRLF/UTF-16 edits. A binding fixture rejects source-line transfer during viewport and active queries. The canonical runner includes the unchanged model-with-tokens suite and its guide cases.

Semantic overlay checks compare the actual original merge for 512 seeded syntax/semantic streams across all 64 presentation-mask combinations. They preserve language/type/bracket metadata, high-bit colors, duplicate/empty/overlapping/reversed semantic ranges, clamping, nonzero typed-array offsets, and unchanged source aliases. Real model checks cover edits, partial semantic updates, option changes, and language changes. Identity shortcuts, unsupported fallback, malformed bindings, and atomic registration rollback are checked. The canonical runner includes the unchanged token-store, text-model-token, and line-token suites: 446 tests pass per implementation.

Sparse token adjustment checks compare 1,024 sixteen-edit traces and 2,048 four-removal/split traces with the original implementation. They verify block coordinates, every word in the original backing arrays, previously returned line views, inactive suffixes, independent split storage, ASCII-word edge affinity, multiline insertion, and modulo-2^32 assignment. Malformed packets retain unchanged source arrays; unsupported numeric/allocation domains retain the original implementation. The complete differential suite has 61 passing tests, and 57 native tests pass.

Contiguous syntax adjustment checks compare 1,024 seeded token streams for insertion, deletion, prefix/suffix deletion, and concatenation. They retain duplicate/zero boundaries, typed-array and ArrayBuffer input identity, mutable source suffixes, high-bit metadata, wrapped endpoints, and the distinction between the shared empty-line sentinel and independently allocated empty results. Multiline blocks preserve original rebasing/line insertion and held source views. Missing/empty shortcuts, malformed bindings, and unsupported fallback are checked. The complete suite has 64 passing differential tests and 59 passing native tests; 446 canonical tests pass per implementation.

Owning syntax-store checks compare 256 sixteen-edit real-model traces, following the model's actual UTF-16-adjusted content events. They retain line indexing, null slots, token massage/equality, source mutations after publication, all retained source buffers, shared-buffer joins, and original diagnostic messages. Supported traces retain native ownership until disposal; unsupported operations materialize only the reference index and release the native store. Model disposal and twenty verification-tokenizer replacements retain only current foreground/debug stores and release both at shutdown. The complete differential suite has 67 passing tests; 446 canonical tests still pass per implementation.

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

For consecutive undo-change composition:

```sh
pnpm run benchmark-rust-editor -- --undo
```

This mode compares small typing batches, 1,024 cursor changes, a large inserted payload with 512 later replacements, and the same fragmented shape with Unicode and unpaired surrogates. It measures both stateless pair composition and an owning append stream with one final serialization. It alternates three fresh processes per engine, verifies identical complete result checksums, and stores timings and process memory observations in `.build/rust/undo-benchmark.json`. The optimized owning streams were faster in this capture; the cursor difference was small. Stateless composition remains slower, and combined process peak RSS remains higher. See [Performance](PERFORMANCE.md) for measurements and limits; these subsystem observations do not meet the whole-product promotion gate.

For complete buffer edit transactions with inverse records:

```sh
pnpm run benchmark-rust-editor -- --edits
```

This mode compares the existing buffer, Rust storage with the existing transaction implementation, and the complete native transaction. It alternates three fresh processes per engine and applies/reverses the same short typing, 1,024-cursor, fragmented ASCII, and fragmented Unicode batches. It records `.build/rust/edits-benchmark.json`, verifying matching metadata and restored-document checksums. Results and remaining regressions are documented in [Performance](PERFORMANCE.md).

For scalar model queries:

```sh
pnpm run benchmark-rust-editor -- --queries
```

This mode compares whitespace-column, character-count, and indentation queries across short lines, Unicode, long lines, and whitespace-heavy sources. It stores timing and memory observations in `.build/rust/queries-benchmark.json` and verifies matching complete workload checksums. Character counting, indentation detection, and long-line whitespace queries were faster in the measured captures; short-line whitespace queries and process peak RSS retain regressions. See [Performance](PERFORMANCE.md).

For indentation folding:

```sh
pnpm run benchmark-rust-editor -- --folding
```

This mode compares 100 folding calculations per workload with and without markers, at limits 5,000 and 32. It includes short/Unicode lines, long mixed prefixes, and indentation beyond the limit histogram's 1,000-column domain. Raw timing and process-memory observations stay in `.build/rust/folding-benchmark.json`, with matching complete checksums. Plain indentation improves in every measured fixture; regex/UTF-16 transfers retain marker-path regressions. See [Performance](PERFORMANCE.md).

For indentation guides:

```sh
pnpm run benchmark-rust-editor -- --guides
```

This mode compares viewport and active guide queries over short/Unicode lines, long mixed prefixes, and long whitespace runs. Complete checksums and process observations stay in `.build/rust/guides-benchmark.json`. Long-prefix and whitespace queries improve in the measured capture; short active queries retain a boundary-cost regression. See [Performance](PERFORMANCE.md).

For syntax/semantic metadata overlays:

```sh
pnpm run benchmark-rust-editor -- --tokens
```

This mode compares 100,000 short-line merges or 1,000 dense-line merges, including lossless Unicode and clamped provider spans. It alternates three fresh processes, consumes every output word in the matching checksum, and records `.build/rust/tokens-benchmark.json`. Dense merges improve in the measured capture; process peak RSS remains higher in three of four fixtures. See [Performance](PERFORMANCE.md).

For sparse semantic token adjustment and partial-update splits:

```sh
pnpm run benchmark-rust-editor -- --sparse-tokens
```

This mode times insert/delete pairs and independent block splits over eight or 8,192 tokens. It includes multiline and lone/paired surrogate insertions and verifies complete backing/output checksums. Raw timing and memory observations stay in `.build/rust/sparse-tokens-benchmark.json`. Dense splits improve with lower process peak RSS; small blocks retain boundary overhead, and dense edit timings are close. See [Performance](PERFORMANCE.md).

For contiguous syntax token adjustment and concatenation:

```sh
pnpm run benchmark-rust-editor -- --contiguous-tokens
```

This mode compares insert/delete pairs and line concatenation over small/dense streams, edits near the last token, and a long line with one token. It records matching complete checksums and memory observations in `.build/rust/contiguous-tokens-benchmark.json`. Generated transfers retain small-stream regressions, and dense timings are close. See [Performance](PERFORMANCE.md).

For the owning syntax line store:

```sh
pnpm run benchmark-rust-editor -- --token-store
```

This mode compares edits, equality updates, and line reads over small/dense stores, multiline edits, and 32,768 lines. Encoded provider inputs remain retained to exercise alias ownership. Complete checksums and process observations stay in `.build/rust/token-store-benchmark.json`. The current owner retains edit and memory regressions; identity-based equality avoids redundant copying, and dense equality timings are close. See [Performance](PERFORMANCE.md).

## Current limits

- The Rust rope uses one-byte Latin-1 leaves when all units fit, and two-byte UTF-16 leaves otherwise. Split leaves share their backing and line-ending indexes. The compact encoding reduces that leaf's text payload by half compared with the previous Rust representation; node, index, allocator, snapshot, and application overhead must still be measured before making total-memory claims.
- Surrogate-free input uses UTF-8 bindings, while surrogate-bearing input retains the UTF-16 path. ASCII output uses strings; other output retains UTF-16 typed arrays and native JavaScript decoding, preserving lone surrogates explicitly. Snapshot traversal is lazy and sequential; consecutive line reads prefetch a single batch of up to 64 lines and 32,768 units, allowing an untruncated first long line. Isolated reads copy one line directly. Whole-document extraction and EOL normalization still allocate document-sized output.
- Drained snapshots explicitly release their Rust version. An abandoned snapshot is retained until its generated binding is collected through `FinalizationRegistry`, because the existing `ITextSnapshot` contract has no disposal method.
- Rust performs the storage adapter's plain literal search without copying lines, with nonoverlapping matches and existing start-column range semantics. The core uses KMP across leaf boundaries and the `memchr` safe API to skip compact-leaf prefixes. Case folding, word boundaries, capture groups, and public regex/multiline search retain their existing JavaScript implementations.
- Storage ABI 4 performs complete buffer edit transactions in one native scope: text classification/EOL normalization, stable range sorting, overlap detection, thousand-edit reduction, inverse coordinates/text records, replacement, and automatic whitespace candidates. Original deleted text is serialized directly from shared source leaves; normalized/reduced text alone returns as new payload. Existing input strings are reused when unchanged. The bridge constructs existing result objects and the wrapper emits the existing content event. Higher-level range validation, CRLF input adjustment, model versions, decorations, notification orchestration, and undo groups remain TypeScript. Non-normalized source state or unsupported coordinate/allocation domains retain the previous transaction path. Input and deleted-text budgets are each 4,194,304 UTF-16 units; operation and whitespace-candidate counts are bounded to 262,144. No native transaction handle persists after the synchronous call.
- Storage ABI 5 additionally computes first/last non-tab-or-space columns from borrowed leaf suffixes/prefixes and counts selected characters without decoding source lines. Character counting preserves the existing rule that every high surrogate skips the next visible unit, even when it is unmatched; separators reset that rule and contribute the requested EOL length. Endpoints inside line separators retain the existing compatibility path. Plain basic-ASCII counts retain their existing length shortcut. Full line reads remain a separate transfer cost.
- Storage ABI 6 adds complete indentation detection over the first 10,000 lines. A sequential borrowed leaf cursor scans prefixes and separators, keeping only current/previous metadata and the original alignment/score preferences. Only the detected tab size and space preference cross the boundary. The original implementation remains available for buffers without this capability.
- Storage ABI 7 adds indentation folding over the existing document. Rust owns bottom-to-top traversal, marker nesting, off-side handling, candidate collection, and limit selection. Regular-expression classification remains in JavaScript, with batches of up to 64 preceding lines and 32,768 units; a long requested line is never truncated. Native temporary state is dropped on return or callback failure. Persistent collapsed/manual folding state, syntax providers, decorations, and guide rendering remain separate work.
- Storage ABI 8 adds viewport indentation levels and active guide scope selection. Scoped borrowed line cursors walk adjacent bounds without repeated tree lookups; cached nearest-content state preserves blank-line rules, off-side handling, scope-start/end preference, and the 50,000-distance cutoff. Only levels and active coordinates return. Existing DOM guide rendering, bracket guides, and model range-error checks remain in place.
- Tokens ABI 1 composes existing syntax and semantic encoding views synchronously in Rust. Sources remain read-only; external aliases, token ownership/editing, tokenization engines, styling, and rendering retain their existing contracts. Unsupported syntax endpoints or result allocations above 4,194,304 words retain the original implementation. Native output replaces the temporary JavaScript number array; generated input/output transfers still allocate, and no persistent token state is introduced.
- Tokens ABI 2 also applies complete sparse token delete/insert adjustment, touching-range removal, and independent splitting. Block rebasing, ASCII-word edge affinity, inactive record suffixes, and typed-array assignment wrapping retain their original behavior. Generated mutable-slice copyback updates existing arrays so external aliases remain valid. A complete edit transfers active records once; native loops allocate no extra record storage. Splits use one bounded result packet, then independent existing storage objects. Numeric values outside the supported integer domain or packets above 4,194,304 words retain the original implementation. Sparse piece indexing, completion/partial-update orchestration, syntax token editing, and tokenization engines remain separate work.
- Tokens ABI 3 adds contiguous syntax token insertion/deletion and concatenation. Mutable copyback retains existing input aliases and stale suffixes; scalar result lengths preserve original input identity, trimming, and the shared empty-line sentinel. Rust retains boundary affinity and modulo-2^32 assignment without coalescing metadata. Null/empty/no-delete shortcuts remain before native invocation. Unsupported numeric/allocation or malformed source shapes retain the original path. Persistent token stores, line/block orchestration, serialization, tokenization engines, and rendering remain separate boundaries.
- Tokens ABI 4 owns the contiguous syntax line index, token massage/equality, and complete edit/line-slot orchestration in Rust. It holds existing JavaScript token-buffer references so external mutation and returned views retain their exact contracts; it does not maintain another persistent encoded copy. Same-line replacement uses one temporary native stream, retaining deletion-only mutation on trimmed source aliases and insertion on the result. Identity equality avoids redundant conversion. Foreground and verification stores are explicitly disposed by the tokenizer backend; flush releases references/index capacity. Unsupported operations export only the existing reference index and free the native owner. Index state is bounded to 262,144 lines, token streams to 4,194,304 words, and numeric parameters to finite integers of magnitude at most 2^40. Sparse store/piece ownership, multiline block orchestration, serialization, tokenizer engines, and rendering remain separate work.
- `getPieceTree()` is an existing implementation-specific test helper. It is available only for the original storage; Rust models expose the normal `ITextBuffer` API instead.
- Open undo batches retain their composed UTF-16 payloads in Rust and transfer only newly appended changes. Whole results convert when serialization or a public change-array consumer needs them. Matching single edits and aligned replacements reuse vectors; contained fragmented edits reuse scratch storage. General multi-change composition still copies the next owned payload before committing. Batches are bounded to 4,194,304 input text units and 262,144 changes. Serialization/materialization, history replacement/removal, snapshot trimming, workspace splitting, model detachment/disposal, and closed workspace groups release native storage without invalidating remaining undo records. Abandoned standalone open data outside those existing lifecycle paths relies on generated binding finalization. Closed-history bytes, stack grouping, inverse edit generation, cursor restoration, notifications, and workspace undo ownership remain in TypeScript. Unsupported offset/allocation domains retain the existing compressor.
- The advanced document diff runs line alignment, whitespace scanning, character refinement, detailed line grouping, move detection, and refinement inside moves in one native call. Source lines cross the boundary once, and native stages share borrowed UTF-16 source views and line identities. Character slices own compact elements and metadata only for their refinement scope. Rust preserves boundary classification, ECMAScript trimming, word/subword expansion, short-match removal, document-edge range translation, stable move selection, and separate raw edits. JavaScript supplies logarithmic equality weights to preserve its numeric semantics and constructs the existing result objects. The legacy diff algorithm remains in TypeScript. Arbitrary dynamic equality-score callbacks, custom refinement timeout orchestration, and sequences without a strong-identity contract retain the existing path. Native directions, frontiers, path arenas, character slices, and move candidates are bounded; unsupported full-document states retain the staged implementations. Input/output conversion still allocates typed arrays. Models/worker callers still extract source line arrays before diffing; sharing immutable storage versions directly with diff remains future work.
- Tauri is not introduced. Changing the rendering engine is a separate decision that must pass the cross-platform visual and interaction gates.
