# Rust Editor

This workspace starts the Rust migration of Code OSS. The full editor has not been rewritten. The current implementation replaces text storage, buffer edit transactions, indentation queries/folding/guides, cursor columns and atomic-tab movement, Unicode iterator and Backspace kernels, token adjustment and syntax line-state ownership, the advanced document diff pipeline, and open undo batch storage when explicitly enabled; the existing workbench, editor rendering, higher-level model validation/versioning, undo service, extension host, and desktop shell remain in place.

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
| `../src/vs/editor/common/core/rustCursorColumns.ts` | Native visible/status-bar columns, UTF-16/grapheme traversal, tab stops, atomic indentation movement, and word-part scans | Implemented; follows the core registration |
| `../src/vs/base/common/rustUnicode.ts` | Borrowed-string code-point, forward/backward grapheme, and Unicode Backspace kernels | Implemented; follows the core registration |
| `../src/vs/editor/common/model/rustDecorations.ts` | Historical marker-affinity and collapse behavior for decoration edits | Implemented; follows the core registration |
| `../src/vs/editor/common/core/rustTextShape.ts` | UTF-16 line-ending counts and leading indentation normalization | Implemented; follows the core registration |
| `../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketEdits.ts` | Composition of queued bracket-tree edits | Implemented; follows the core registration |
| `../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketLengths.ts` | Packed length arithmetic and coordinate/text-length conversions | Implemented; follows the core registration |
| `../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustSmallImmutableSet.ts` | Immutable bracket identifier set operations | Implemented; follows the core registration |
| `../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketTrees.ts` | In-place bracket AST grouping and append/prepend balancing | Implemented; follows the core registration |
| `../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketNodeReader.ts` | Longest-node cache lookup and live reader-stack advancement | Implemented; follows the core registration |
| `../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketPositionMapper.ts` | Edit cursor advancement, coordinate translation, and next-change distances | Implemented; follows the core registration |
| `../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketParser.ts` | Document/list/child parsing and incremental cache acceptance | Implemented; follows the core registration |
| `../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketTokenizer.ts` | Line-aware text/bracket scanning, peekable reads, and token cursor positioning | Implemented; follows the core registration |
| `../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustFastBracketTokenizer.ts` | Complete initial bracket token-stream construction | Implemented; follows the core registration |
| `../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketCollection.ts` | Colorized bracket range traversal and nesting | Implemented; follows the core registration |
| `../src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/rustBracketPairCollection.ts` | Pair range traversal and optional minimum indentation | Implemented; follows the core registration |
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

The command builds a release WebAssembly module and generates JavaScript bindings and declarations under `out/vs/editor/common/model/rustTextBuffer/`. Generated files are ignored by Git. The generator must exactly match the pinned `wasm-bindgen` crate version. Registration validates storage ABI version 8, sequence diff ABI version 8, undo-change ABI version 2, tokens ABI version 11, cursor-columns ABI version 3, Unicode ABI version 2, decorations ABI version 1, text-shape ABI version 1, bracket-edits ABI version 1, bracket-lengths ABI version 1, small-set ABI version 1, bracket-trees ABI version 2, bracket-node-reader ABI version 1, bracket-position-mapper ABI version 1, bracket-parser ABI version 1, bracket-tokenizer ABI version 1, fast-bracket-tokenizer ABI version 1, bracket-collection ABI version 1, and bracket-pair-collection ABI version 1; stale assets are rejected atomically, and desktop startup retains the existing implementations. Run this command after any client build that replaces `out/`.

The build also verifies the checked-in Rust grapheme table against the original indexed data in `src/vs/base/common/strings.ts`. If that data changes, regenerate it with `node build/rust/unicode.ts --write`, then format Rust and run the exhaustive Unicode differential check. The existing table layout and boundary rules are retained exactly.

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

Line-token algorithm checks compare 512 seeded UTF-16 insertion/range/slice traces and 1,024 source-offset conversions against the existing API. They retain ordered and unsorted insertions, source-before-insertion ties, duplicate/zero boundaries, substring clamping, metadata wrapping, cached slice selection, later source mutation, lone surrogates, nonzero backing offsets, detached-buffer behavior, equality coercion, callback failure identity, and getter read counts. Unsupported numeric domains and malformed binding packets are checked. Tokens ABI 8 passes 85 differential tests, 59 native tests, 499 canonical tests per implementation, and the Chromium worker bootstrap test. Token object ownership, remaining TokenArray algorithms, metadata presentation, tokenizers, and rendering remain separate work.

Token-sequence construction and slicing checks compare 1,024 seeded text/length sequences, including fractional/negative/zero lengths, NaN/infinite values, metadata coercion, UTF-16 substring swapping, empty fragments, source-array mutation, independent slice objects, builder sharing, detached views, custom iterators, and accessor read counts. Both TokenArray and TokenWithTextArray conversions use the integrated native kernels. Tokens ABI 9 passes 89 differential tests, 59 native tests, 499 canonical tests per implementation, and the Chromium worker bootstrap test. Callback traversal, append/builder orchestration, persistent token ownership, tokenizers, and presentation remain separate boundaries.

Token callback traversal checks compare 512 live-array traces for both sequence types and both forEach/map, verifying 2,048 actual native dispatches. They retain callback result identity, recursive traversal, array append/splice during callbacks, current/future accessor installation, second length reads, exceptional numbers, callback-installed JavaScript coercion, and initial accessor fallback. Direct iterator checks compare original step/body error handling, iterator closing, and exception identity when return getters/methods fail. Tokens ABI 10 passes 92 differential tests, 59 native tests, 499 canonical tests per implementation, and the Chromium worker bootstrap test. Append/builder orchestration, persistent token ownership, line-view callback traversal, tokenizers, and presentation remain separate work.

Sparse line-selection checks compare 1,024 seeded record streams before/after external mutation and removal. They retain duplicate boundaries, incomplete ordering, inactive record suffixes, original byte offsets, held view mutation, zero-active-count reads, provider subarray failures, detached sources, malformed encodings, and unsupported numeric states. Native dispatch is verified through public SparseMultilineTokens queries. Tokens ABI 11 passes 94 differential tests, 60 native tests, 499 canonical tests per implementation, and the Chromium worker bootstrap test. Persistent piece ownership, diagnostic traversal, tokenizers, and rendering remain separate work.

Cursor column checks compare every Unicode code point with the original grapheme classifier and 2,048 seeded UTF-16 texts across visible/status-bar/inverse queries, verifying 51,200 actual native dispatches. They retain surrogate-interior prefixes, combining/spacing marks, Hangul, regional indicators, ZWJ sequences, approximate width rules, midpoint preference, fractions, negative sizes, NaN/infinities, signed zero, subclass callbacks, detached calls, and atomic registration rollback. Native tests verify short traversal over a million-unit source and reader failure propagation without unrelated reads. Cursor-columns ABI 1 passes 98 differential tests, 62 native tests, 508 canonical tests per implementation, and the Chromium worker bootstrap test. Existing CursorColumns and atomic-tab unit suites are included in the canonical selector. General grapheme iterators, other cursor movement/state, view coordinates, and rendering remain separate work.

Atomic-tab checks compare 2,048 seeded indentation streams across ten positions, thirteen tab-size domains, and eight directions, verifying 20,480 native whitespace queries and 163,840 native movements. They retain strict position equality, complete-stop validation, partial-indentation fallback, midpoint ties, line-end checks, exceptional numbers, signed zero, invalid-direction behavior, base-class overrides, string accessors, subclass and detached calls, and registration rollback. Cursor-columns ABI 2 passes 100 differential tests, 64 native tests, 508 canonical tests per implementation, and the Chromium worker bootstrap test. General grapheme iterators, other cursor movement/state, view coordinates, and rendering remain separate work.

Unicode iterator checks compare 2,048 seeded UTF-16 texts through code-point iteration, forward/backward graphemes, next/previous character lengths, containing ranges, and character counts. They retain surrogate interiors, stateless boundary quirks, iterator coordinates, fractional/out-of-range offsets, cached lengths, boxed strings, external field accessors, read-only offsets, subclass callbacks, proxy trap order, and atomic registration rollback. Unicode ABI 1 passes 104 differential tests, 65 native tests, 556 canonical tests per implementation, and the Chromium worker bootstrap test. The unchanged base string suite joins the canonical selector. Existing JavaScript iterator objects retain their public state; Rust owns code-point and complete supported grapheme-step computation. Unicode-aware deletion, remaining cursor state, view coordinates, and rendering remain separate work.

Unicode Backspace checks compare every UTF-16 offset across 2,048 seeded emoji/modifier/joiner streams. They retain approximate emoji-base selection, isolated modifier fallback, optional preceding ZWJ removal, surrogate interiors, single-code-point fallback, unusual offsets, original iterator callbacks, boxed strings, and registration validation. Unicode ABI 2 passes 106 differential tests, 67 native tests, 556 canonical model/string tests and 263 canonical Chromium cursor tests per implementation, plus the Chromium worker lifecycle test. The browser runner initializes the same compiled core before loading the unchanged cursor suite and removes its generated bootstrap afterward. Cursor configuration, command orchestration, selection state, view coordinates, and rendering remain separate work.

Run the canonical browser cursor suite after the current client build and binding generation:

```sh
pnpm run test-rust-editor-cursor
```

The runner uses Chromium and runs both implementations in fresh browser sessions. An optional `--grep` selects the same original cases for both engines.

Decoration edit checks compare 65,536 native node edits and 4,096 numeric-edge cases against the original two-marker algorithm. They retain all four affinities, forced movement, collapsed replacements, partial/common replacement boundaries, unsigned metadata coercion, NaN/infinities, fractional values, signed zero, original node identity/caches/links, accessor effects, partial writes on exceptions, subclass behavior, proxy traps, and atomic registration rollback. Decorations ABI 1 passes 110 differential tests, 68 native tests, 581 canonical model/string/interval tests and 263 canonical Chromium cursor tests per implementation, plus the Chromium worker lifecycle test. Existing tree topology, queries, decoration ownership, cache orchestration, and rendering remain separate boundaries.

Word-part checks compare both directions at every position in 512 seeded mixed-case, digit, delimiter, whitespace, and Unicode lines through existing WordOperations. They retain directional snake/kebab affinity, acronym boundaries, digit-to-upper transitions, model callback and position getter order, line-edge identity, fractional/out-of-range fallback, string callbacks, and binding validation. Cursor-columns ABI 3 passes 112 differential tests, 70 native tests, 581 canonical model/string/interval tests and 278 canonical Chromium cursor/word-part tests per implementation, plus the Chromium worker lifecycle test. The browser selector includes the unchanged word-part navigation and deletion suite. General word segmentation, command orchestration, cursor state, view coordinates, and rendering remain separate boundaries.

Text-shape checks compare 2,048 seeded CR/LF/CRLF, surrogate, unusual-terminator, and indentation inputs through the original countEOL/normalizeIndentation APIs. They retain first/last line lengths, ending masks, the unchanged Unicode suffix, fractional repeat counts, negative/zero/NaN/infinite sizes, original string/tab-stop callbacks, boxed strings, bounded-output fallback, and atomic registration rollback. Text-shape ABI 1 passes 115 differential tests, 72 native tests, 581 canonical model/string/interval tests and 278 canonical Chromium cursor/word-part tests per implementation, plus the Chromium worker lifecycle test. EOL queries reuse the existing native model-edit scanner; normalization borrows only the needed prefix and returns ASCII whitespace plus the suffix coordinate. File encoding, settings, command orchestration, and rendering remain separate work.

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

For sparse piece orchestration:

```sh
pnpm run benchmark-rust-editor -- --sparse-store
```

This mode compares edit pairs, partial replacements, and merged line reads through `SparseTokensStore` with small/dense stores, multiline edits, and 4,096 pieces. Original provider arrays remain retained, and every merged word and retained block contributes to matching checksums. Results remain in `.build/rust/sparse-store-benchmark.json`, with the initial nested-binding capture in `.build/rust/sparse-store-benchmark-initial.json`. Standard piece edits now run within the owner call and avoid copying unaffected records, but the current object boundary still has substantial latency and memory regressions. See [Performance](PERFORMANCE.md).

For contiguous token block edits:

```sh
pnpm run benchmark-rust-editor -- --token-block
```

This mode compares 1,000 same-line replacements and 200 fresh multiline edits through `ContiguousMultilineTokens`. Fixtures cover small/dense blocks, prefix removal, and 32,768 lines. Provider and fresh-block preparation stay outside timing, while result consumption is included. Results remain in `.build/rust/token-block-benchmark.json`. The native path retains small-edit regressions; large-block edits are close to the reference. Tokens ABI 6 also uses shared host-array slice/concat/splice operations for sparse partial updates, reducing per-slot transfers while retaining the original aliases. The ABI 5 sparse capture remains in `.build/rust/sparse-store-benchmark-abi5.json`. See [Performance](PERFORMANCE.md).

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
- Tokens ABI 5 owns sparse completion, binary piece selection, partial replacement/removal/splitting/insertion, and edit traversal in Rust. It retains the caller's original piece array and objects, including duplicate references, external array edits, self-aliasing partial input, and mutations to previously returned token views. Partial insertion creates a separate array after mutating the previous one, matching the existing contract. Standard piece edits invoke the native kernel directly within this scope, update existing scalar fields, and copy only affected active streams; exterior edits refresh the cached end from the current backing delta without copying records. Overridden piece methods retain their original callbacks and exception identity. Unsupported ranges/capacities export the same array and completion state, then free the owner. Piece count is bounded to 262,144, partial preflight uses twice the existing count plus incoming count, and numeric magnitudes are bounded to 2^40. Model disposal releases its semantic owner. Persistent piece scalar/record ownership, token block serialization, tokenizer engines, styling, and rendering remain separate work. This port retains substantial measured regressions and remains opt-in.
- Tokens ABI 6 adjusts complete contiguous token blocks in one synchronous native scope beneath `ContiguousMultilineTokens.applyEdit`. It retains original block-coordinate rebasing, token-source mutations, trimmed/empty/null result shapes, middle-array splices, leading/trailing slices, and absolute insertion positioning. Same-line replacement reuses the existing alias-preserving owner kernel without nested bindings. There is no persistent block handle or second encoded store. Unsupported numeric, source-shape, line-capacity, concatenation, and truncated-prefix insertion domains fall back before source mutation. Line count is bounded to 262,144, affected streams/joins to 4,194,304 words, and integer parameter magnitudes to 2^40. Shared generated host-array operations also replace per-slot sparse index transfers. Differential tests retain complete provider arrays and backing buffers; original model-line token suites run against both engines. Block serialization, persistent piece ownership, tokenizers, and rendering remain separate boundaries.
- Tokens ABI 7 performs contiguous block size calculation, serialization, and deserialization beneath the existing block/builder APIs. Rust writes the existing big-endian headers and raw record bytes directly into the caller's byte view, or allocates one JavaScript byte array for a complete builder stream. Decoding uses a temporary bounded header snapshot and returns the original mutable source-buffer views. Existing block constructors remain at the bridge. Original unsigned start-line coercion, complete stream bytes, nonzero output offsets, provider aliases, grouping, and decoded-view offsets remain unchanged. Method descriptors retain overridden/accessor callbacks without invoking them during native preflight. Non-full source views, unaligned/malformed decode packets, unsupported token types, overridden methods, short destinations, oversized packets, and unsupported offsets retain the original implementation before source/destination mutation, including its whole-backing-buffer serialization and permissive decode behavior. Byte streams are bounded to 16 MiB, aggregate blocks/lines to 262,144, and integer parameter magnitudes to 2^40. No persistent token serialization handle or second encoded output is retained. Persistent piece state, line-view algorithms, tokenizers, styling, and rendering remain separate work. Extensive profiling is deferred to Phase 2.
- Tokens ABI 8 migrates binary line-token search, fixed slice selection, start-to-end offset conversion, word-slice equality, range extraction, and complete ordered UTF-16 insertion beneath the existing LineTokens APIs. Binary lookup reads the original typed-array ends directly without copying the complete encoding. Conversion copies back into the original view; cached slices keep their existing selection and live source metadata. Equality, extraction, and insertion use bounded temporary native streams and retain no persistent line-token handle. Source streams and composed text are limited to 4,194,304 words/code units, insertions to 262,144, and integer magnitudes to 2^40. Virtual/accessor callbacks, detached sources, malformed ranges, coercion, and unsupported domains retain the existing path. Token objects, remaining TokenArray operations, presentation, tokenizers, and rendering remain separate work; no performance gain is claimed for this stage.
- Tokens ABI 9 migrates complete token-sequence construction and slicing. Rust computes every source token length or clamped substring endpoint, clips TokenArray/TokenWithTextArray sequences with the original floating-point arithmetic, and constructs encoded boundaries and unsigned metadata for complete text fragments. Primitive host strings are joined without Rust string decoding, preserving lone surrogates. Existing TokenInfo, TokenWithTextInfo, and LineTokens constructors remain at the bridge. Slices create independent objects; append and builder aliases retain their current behavior. Custom/inherited iterators, sparse/accessor input slots, getter fields/ranges, detached sources, and unsupported input types fall back before provider reads or mutation. Temporary sequences are bounded to 262,144 tokens and composed text to 4,194,304 UTF-16 units. Callback traversal, append/builder orchestration, persistent ownership, tokenizers, and presentation remain separate work. Extensive profiling remains deferred to Phase 2.
- Tokens ABI 10 owns TokenArray/TokenWithTextArray forEach/map traversal. It retains the original live iterator and cached next method, accumulates numeric lengths in Rust, constructs existing ranges through the bridge, and rereads each length after its callback. Callbacks may append/remove tokens, install getters, recurse, or change the declared numeric field to another JavaScript value; caught coercion preserves that exceptional path. Result arrays contain the exact callback-returned objects. Consumer-body errors close the original iterator while preserving the original thrown value; iterator-step errors do not close it. No persistent iterator, duplicate native sequence, or native result vector is retained. Initially unsupported arrays/iterators/fields use the original path before callbacks. Append/builder state, persistent token ownership, line-view callbacks, presentation, and tokenizers remain separate boundaries.
- Tokens ABI 11 migrates sparse per-line record selection. Rust reads existing delta-line words directly, preserves binary-search bounds and duplicate expansion, and returns only the original view's two word offsets. Existing SparseLineTokens constructors and provider subarray methods preserve source aliases and exceptions. Cached active counts remain authoritative, including the existing zero-count first-record read; inactive suffixes are not discarded. Unsupported/fractional active counts, malformed or oversized streams, detached sources, and NaN targets fall back before querying. Streams are bounded to 4,194,304 words. No full-record transfer, persistent selection index, or duplicate encoding is introduced. Persistent piece ownership, diagnostic traversal, tokenizers, and rendering remain separate work.
- `getPieceTree()` is an existing implementation-specific test helper. It is available only for the original storage; Rust models expose the normal `ITextBuffer` API instead.
- Open undo batches retain their composed UTF-16 payloads in Rust and transfer only newly appended changes. Whole results convert when serialization or a public change-array consumer needs them. Matching single edits and aligned replacements reuse vectors; contained fragmented edits reuse scratch storage. General multi-change composition still copies the next owned payload before committing. Batches are bounded to 4,194,304 input text units and 262,144 changes. Serialization/materialization, history replacement/removal, snapshot trimming, workspace splitting, model detachment/disposal, and closed workspace groups release native storage without invalidating remaining undo records. Abandoned standalone open data outside those existing lifecycle paths relies on generated binding finalization. Closed-history bytes, stack grouping, inverse edit generation, cursor restoration, notifications, and workspace undo ownership remain in TypeScript. Unsupported offset/allocation domains retain the existing compressor.
- The advanced document diff runs line alignment, whitespace scanning, character refinement, detailed line grouping, move detection, and refinement inside moves in one native call. Source lines cross the boundary once, and native stages share borrowed UTF-16 source views and line identities. Character slices own compact elements and metadata only for their refinement scope. Rust preserves boundary classification, ECMAScript trimming, word/subword expansion, short-match removal, document-edge range translation, stable move selection, and separate raw edits. JavaScript supplies logarithmic equality weights to preserve its numeric semantics and constructs the existing result objects. The legacy diff algorithm remains in TypeScript. Arbitrary dynamic equality-score callbacks, custom refinement timeout orchestration, and sequences without a strong-identity contract retain the existing path. Native directions, frontiers, path arenas, character slices, and move candidates are bounded; unsupported full-document states retain the staged implementations. Input/output conversion still allocates typed arrays. Models/worker callers still extract source line arrays before diffing; sharing immutable storage versions directly with diff remains future work.
- Tauri is not introduced. Changing the rendering engine is a separate decision that must pass the cross-platform visual and interaction gates.

Queued bracket edit checks compare 2,048 seeded eight-batch multiline/Unicode streams, exact edit values and prototypes, and restoration of the original document after every composition. They cover empty-input alias identity, unsupported numeric domains, input iterator/accessor/proxy observations, callback-installed mapping prototypes, original split failures, malformed binding packets, and atomic core registration rollback. Bracket-edits ABI 1 passes 120 differential tests, 73 native tests, 642 canonical model/string/interval/bracket tests per implementation, 278 canonical Chromium cursor/word-part tests per implementation, and the Chromium worker lifecycle test. Formatting, Clippy, targeted TypeScript typechecking, ESLint, and module layer checks pass. Full migration, extension/platform acceptance, exact UI parity, and default promotion remain unfinished.

Packed bracket length checks compare 4,096 seeded numeric snapshots, including NaN/infinities/fractions/negative values/signed zero, exact Position/Range/TextLength construction, host coercion order, provider getters, and reduction callbacks. Text checks compare 2,048 mixed-EOL/Unicode inputs and retain overridden string/regular-expression split failures. An additional 1,024 seeded position-mapper traces exercise the integrated arithmetic. Bracket-lengths ABI 1 passes 125 differential tests, 74 native tests, 651 canonical model/string/interval/bracket/position-map tests per implementation, and the Chromium worker lifecycle test. Formatting, Clippy, targeted TypeScript typechecking, ESLint, and module layer checks pass. The earlier 278-per-engine canonical Chromium cursor/word-part validation remains applicable to unchanged cursor sources. Full position-mapper ownership and the rest of the migration remain unfinished.

Immutable bracket identifier checks compare 1,024 seeded 64-operation streams, exact words/array shapes, addition/merge result identities, membership, intersection, and equality. They cover key wrapping/fractions/exceptional values, signed shifts, negative keys, provider coercion/read order/failures, dense-provider reverse lookup, proxy/accessor traps, mutable word aliases, sparse holes, exact tail lengths, lazy short-circuit reads, malformed packets, and atomic registration rollback. Small-set ABI 1 passes 130 differential tests, 75 native tests, 662 canonical tests per implementation including all bracket infrastructure suites, and the Chromium worker lifecycle test. Formatting, Clippy, targeted TypeScript typechecking, ESLint, and module layer checks pass. The additional canonical packed-length suite also passed, increasing the previous module's canonical count from 651 to 653. Complete parser/tree ownership, position-map ownership, and the full migration remain unfinished.

Equal-height bracket tree checks compare 512 seeded node-count/height fixtures in both immutable modes, exact trees and mutated input arrays, leaf reference preservation, array proxy/factory getter observation order, readonly-slot partial writes, factory exceptions, unusual cached lengths, undefined factory returns without replay, scoped result release, and atomic registration rollback. Bracket-trees ABI 1 passes 135 differential tests, 76 native tests, 662 canonical tests per implementation, and the Chromium worker lifecycle test. Formatting, Clippy, targeted TypeScript typechecking, ESLint, and module layer checks pass. General balancing and native AST ownership remain unfinished.

Mixed-height bracket tree checks add 1,024 seeded height-run fixtures with both mutable and immutable inputs, exact trees/mutated input arrays, leaf identity/order, proxy/virtual/factory observations, live parent-stack pushes, and append/prepend failure identity with partial mutations. Bracket-trees ABI 2 passes 138 differential tests, 76 native tests, 662 canonical tests per implementation, 278 canonical Chromium cursor/word-part tests per implementation, and the Chromium worker lifecycle test. Formatting, Clippy, targeted TypeScript typechecking, ESLint, and module layer checks pass. Native AST ownership and the full core migration remain unfinished.

Bracket node-reader checks compare 512 seeded 192-query multiline trees, exact returned node identities, predicate traces, and independent reader-state snapshots. They cover receiver/node/array proxy observations, advancement overrides, reentrant predicates, predicate failure identity, readonly-stack partial writes, monotonic errors, unusual offsets, BigInt/undefined/negative child index state with original invalid-index errors, scoped result release, and atomic registration rollback. Bracket-node-reader ABI 1 passes 143 differential tests, 76 native tests, 662 canonical tests per implementation, and the Chromium worker lifecycle test. Formatting, Clippy, targeted TypeScript typechecking, ESLint, and module layer checks pass. The earlier 278-per-engine Chromium cursor/word-part validation remains applicable to unchanged cursor sources. Native AST ownership and the full core migration remain unfinished.

Bracket position-mapper checks compare 512 seeded 128-query multiline edit streams, exact old offsets, next-change distances, and every cursor/delta snapshot. They cover receiver/cache/coordinate proxy observations, virtual translation getter order, adjustment overrides, exceptional/fractional/signed-zero offsets, string/undefined/BigInt/coercing mutable fields, readonly-field partial writes, cache getter failure identity at successive transition sites, scoped result release, and atomic registration rollback. Bracket-position-mapper ABI 1 passes 148 differential tests, 77 native tests, 662 canonical tests per implementation, and the Chromium worker lifecycle test. Formatting, Clippy, targeted TypeScript typechecking, ESLint, and module layer checks pass. The earlier Chromium cursor/word-part validation remains applicable to unchanged sources. Original cache objects and cursor fields remain at their existing owner; native persistent ownership, parser orchestration, and the full core migration remain unfinished.

Bracket parser checks compare 512 seeded initial documents in both mutable/immutable modes and 256 seeded incremental edits with exact trees, missing-bracket metadata, reused-node identities, tokenizer offsets, and consumed indices. They cover ambiguous closers, unmatched pairs, the original depth guard, token/provider/factory observations, text-node identities, tokenizer/cache failure identity, partially consumed streams, malformed token kinds, scoped result release, and atomic registration rollback. Bracket-parser ABI 1 passes 153 differential tests, 78 native tests, 662 canonical tests per implementation, and the Chromium worker lifecycle test. Formatting, Clippy, targeted TypeScript typechecking, ESLint, and module layer checks pass. The earlier Chromium cursor/word-part validation remains applicable to unchanged sources. Token scanning and AST/set ownership remain at their existing owners; their migration and the full core migration remain unfinished.

Bracket line-tokenizer checks compare 512 seeded mixed-language/metadata documents with complete token streams and every wrapper/reader cursor snapshot. They cover identical-metadata joining, bracket filtering, long lines and multiline text heuristics, Unicode, cached token identities, repeated reads, skips, unusual position values, receiver/reader/provider/regexp proxy observations, matching getter order, provider/regexp failure identity, readonly-field partial writes, scoped result release, and atomic registration rollback. Bracket-tokenizer ABI 1 passes 158 differential tests, 80 native tests, 662 canonical tests per implementation, and the Chromium worker lifecycle test. Formatting, Clippy, targeted TypeScript typechecking, ESLint, and module layer checks pass. FastTokenizer construction, persistent token/AST ownership, and the full core migration remain unfinished.

Fast bracket-tokenizer checks compare 1,024 seeded complete streams with and without configured brackets, exact token/node types, short-token reference reuse, and final tokenizer state. They cover zero/one/multiple-line spans, the 59/60/61-column cache boundary, long text, Unicode, original no-bracket newline behavior, provider proxy/getter order, coercing source text, provider failure identity without repeated matches, scoped result release, and atomic registration rollback. Fast-bracket-tokenizer ABI 1 passes 162 differential tests, 81 native tests, 662 canonical tests per implementation, and the Chromium worker lifecycle test. Formatting, Clippy, targeted TypeScript typechecking, ESLint, and module layer checks pass. Existing regular-expression creation and scalar token-array read/peek remain at their original API boundary; persistent native token/AST ownership, bracket queries, and the full core migration remain unfinished.

Bracket collection checks compare 256 seeded documents with 16 windows each, both colorization modes, complete nesting metadata, and callback stop order. They cover deep/unclosed/unmatched trees, noncolorized pairs, AST proxy observations, sparse child slots, original tail descent, reentrant callbacks, nonboolean falsy stops, callback failure identity, subsequent query behavior, scoped result release, and atomic registration rollback. Bracket-collection ABI 1 passes 166 differential tests, 82 native tests, 662 canonical tests per implementation, and the Chromium worker lifecycle test. Formatting, Clippy, targeted TypeScript typechecking, ESLint, and module layer checks pass. Pair-range and nearest/unmatched queries, persistent native AST ownership, and the full core migration remain unfinished.

Bracket pair collection checks compare 128 seeded documents with 12 windows each and both indentation modes, complete nesting metadata, and retained AST identities. They cover depth guards, unclosed pairs, proxy/provider/factory observation order, reentrant callbacks, nonboolean falsy stops, callback failure identity, custom iterator steps and closing, invalid close results, original thrown-completion precedence, scoped result release, and atomic registration rollback. Bracket-pair-collection ABI 1 passes 171 differential tests, 85 native tests, 662 canonical tests per implementation, and the Chromium worker lifecycle test. Formatting, Clippy, targeted TypeScript typechecking, ESLint, and module layer checks pass. Nearest/unmatched queries, persistent native AST ownership, and the full core migration remain unfinished.
