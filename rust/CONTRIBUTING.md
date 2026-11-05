# Contributing to the Rust Editor

Follow [AGENTS.md](../AGENTS.md) and the [Copilot Instructions](../.github/copilot-instructions.md). Keep new source comments, documentation, and commit messages in English. Preserve the existing product localization system and resources.

## Code style

Use Rustup's workspace-pinned stable toolchain. Format Rust with `cargo fmt --all`; `rustfmt.toml` uses tabs, matching the existing Rust crates. Use idiomatic Rust `snake_case` functions/fields and `PascalCase` types. TypeScript bridges retain the repository's existing naming, tabs, import, disposal, and formatting conventions. Keep Microsoft copyright/license headers in source files and use Rust documentation comments for public contracts.

Keep Markdown paragraphs on a single source line. Keep documentation close to the owning crate or subsystem. Update status and limitations whenever a boundary is implemented, connected, promoted, or removed.

## Architecture

Maintain the `base` to `platform` to `editor` to `workbench` dependency direction and the separate sessions layer. Keep `editor-core` independent of DOM, desktop frameworks, asynchronous runtimes, extension hosts, and product services. Add a dependency only for a real requirement. Pin ABI-sensitive tooling and commit Cargo lockfiles. Do not add placeholder crates, duplicate existing utilities, or ship an incomplete replacement as the default.

Preserve UTF-16 coordinates across every boundary. Do not use lossy decoding for model text. Treat immutable document versions and scoped ownership as the basis for background work. Bound queues and memory, propagate cancellation, and release resources at their owning scope. The workspace forbids unsafe Rust; generated binding internals remain the binding generator's responsibility.

## Validation

Complete the Rust core migration before extensive performance engineering. During Phase 1, implement and integrate each applicable core subsystem, preserve strict behavior/API/extension parity, run its canonical tests, and immediately continue to the next subsystem once it is operational. Fix correctness defects, critical performance regressions, and memory safety issues immediately. Record non-critical regressions and optimization opportunities in [Performance](PERFORMANCE.md); do not repeatedly benchmark, polish, or micro-optimize working modules. Keep the application functional throughout.

Begin Phase 2 only after all targeted core subsystems are integrated, validated, and operational. Profile whole-application CPU, memory, allocations, latency, and throughput under representative workloads, compare against the original implementation in identical conditions, and prioritize measurable end-to-end improvements. Continue while useful opportunities remain without unacceptable correctness, stability, or compatibility trade-offs.

From `rust/`, run the smallest applicable native tests, formatting, and Clippy checks. For changes to this workspace, the normal commands are:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

For bindings or storage adapters, build and run the differential suite from the repository root:

```sh
pnpm run build-rust-editor
pnpm run test-rust-editor
pnpm exec tsc --project test/rust/tsconfig.json --noEmit --skipLibCheck
```

After a current client build and binding generation, run `pnpm run test-rust-editor-models` to execute the unchanged canonical model suites against both implementations.

Run targeted repository ESLint and TypeScript formatting checks for changed bridges/build scripts. Use the existing editor test runners for changes to the original buffer/model path. Run layer checks when imports or service boundaries change. Prepare missing development prerequisites through the existing repository tooling; do not change product code to silence environment errors.

Record validation accurately. Passing storage tests does not establish visual parity, extension compatibility, release packaging, or lower application resource usage. Follow the acceptance gates in [Architecture](ARCHITECTURE.md) before default promotion.

## Git

Use the machine's configured Git identity. Do not override author/committer fields or add agent coauthorship. Keep local migration instructions in the ignored root `RUST_MIGRATION.local.md`. Generated builds and local validation evidence stay ignored. Keep commits scoped and do not push or publish without an explicit instruction.
