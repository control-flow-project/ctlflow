# Rust implementation

This is the independent, in-progress native Rust implementation of Crossfire.
It is not yet a deployable server, fleet controller or CLI. A generated operation
catalog is not an implementation of its handlers. The complete Node contract is
the parity target, not the partial C# checkpoint.

The repository Cargo workspace coordinates service-owned crates. There is one
shared React UI and wire contract. Rust does not launch Node or C# as a product
implementation fallback. Both Codex and Pi have real native adapter/owned-runtime
integration and acceptance coverage. Complete listener/controller composition
and cloud-provider certification remain outstanding.
The common service/layer map is
[Native implementation structure](../../../docs/architecture/native-layout.md).
Rust follows the same high-level owners as C# without copying EF-specific
compiler machinery or .NET class patterns.

## Database ownership

Knex is the sole creator and migrator of every database. The shared database
hierarchy and upgrade containers belong to the parallel database track. There
is no Rust initializer, DDL asset, migration ladder, startup migration or second
reference-data writer. Rust requires the exact current application/schema IDs
and completed Knex migration records. Missing or unsupported storage is rejected
without creating or repairing it.

`packages/adapter-sqlite` owns backend configuration, the native connection,
generated snake_case tables, transaction machinery, domain queries and row/entity
mapping, matching C#'s SQLite adapter boundary. Application queries use typed Diesel
builders; raw SQL is limited to schema metadata. Native Matrix operations stay
outside SQL transactions. Expected failures and nested transactions roll back.

Only the actual SQLite backend is implemented. Other backends must have real
adapters before becoming selectable; none is represented by an empty adapter or
silently mapped to SQLite.

## Source ownership

| Directory | Responsibility |
| --- | --- |
| `packages/kernel` | Failures, secrets and cryptographic primitives |
| `packages/domain` | Typed ports, identity/authority, policy, agent and fleet operations |
| `packages/contracts` | Wire validation, events, room state and generated operation declarations |
| `packages/adapter-sqlite` | Prepared connection, schema, transactions, typed queries and normalized persistence |
| `packages/adapter-http` | Same-origin, bounded and cancelable native HTTP |
| `packages/adapter-matrix` | Native account, room, invitation, owner conversation and event authority |
| `packages/adapter-schedule` | Native calendar recurrence and timezone calculations |
| `packages/agent-core` | Pure native runtime, decision and observation ports |
| `packages/adapter-runtime` | Durable journals, receipt recovery, bounded history reads and restart context |
| `packages/adapter-process` | Bounded native commands and owned process-group lifecycle |
| `packages/adapter-toml` | Bounded native TOML configuration parsing and formatting |
| `packages/adapter-codex` | Native protocol, exact model admission, sessions, instructions and owner decisions |
| `packages/adapter-pi` | Verified Pi 1.0.0 RPC, private native correlation, histories and owner decisions |
| `tests/support` | Private disposable database and HTTP fixtures; never a production dependency |

The current domain/storage port includes human membership and sessions, agent
wake selections, controller leases, session-operation requests/claims/receipts,
native questions and owner answers, status/settings projections, incidents and
hourly traffic/token summaries. Native state summaries retain uncertainty:
stopping a listener alone does not prove a native process stopped; current
controller stop evidence is required. A newer run supersedes old stop evidence.

Enrollment has one persisted owner-review workflow: exact controller/private
identity proofs, global name claims, capacity, repeatable introductions,
approval/rejection, expiry, binding, coordination policy and credential exchange.
Native account and room reconciliation release database ownership before I/O,
then recheck principal, owner, revision and membership generation. Account setup
does not create owner DMs until requested. Renames preserve identities, logins and
private room bindings. Unknown/quoted names never become controls; blocked actual
Matrix mentions produce cooldown-limited native notices marked as control output.

Real pinned Conduit plus the shared Knex SQLite fixture exercises these domain
flows in 38 assertions. This is not a running Rust REST server or full-product
certification. The wire digest uses native ICU collation, not byte-order
substitution; actual Node comparisons verify representative Unicode and exact
serialized enrollment bytes.

Fleetd's native `packages/domain`, `packages/contracts` and `packages/storage`
own configuration, registry and restart checkpoints. Per-instance settings merge
over role defaults through one resolution function; native runtime admission
rejects unavailable combinations. Explicitly empty resume selections stay empty.
Saved restart messages retain exact native context and input identity and ask
the resumed session to reread its current instructions. The daemon and Fleet CLI
remain implementation work.

One logging-retention policy defaults to seven days. Bounded keyset cleanup
rotates settled historical records without deleting pending questions, unsent
notices, unfinished claims, the current run or current stop evidence. Expected
failures roll back the entire cleanup batch. These operations still need the
complete HTTP/controller composition and real-provider acceptance.

Domain dependencies exclude concrete adapters, HTTP, process ownership and UI.
Private filesystem operations reject public permissions and symlink traversal.
Secrets redact debug output and zeroize on disposal. Native HTTP does not follow
redirects, use cookies or system proxies, and validates TLS, deadlines, resource
bounds and Unicode. There is no terminal scraping or model-based housekeeping.

## Build and foundation verification

The Rust toolchain is pinned by `rust-toolchain.toml`. Cargo dependencies and
checksums are locked. All first-party crates forbid unsafe code. Native targets
use the same source for debug and optimized builds.

Prepare a private test SQLite file through the **shared Knex tooling**, then set
`CROSSFIRE_TEST_DATABASE_TEMPLATE` to its absolute path. Tests copy that file into
owned disposable directories; they do not create schemas or skip storage tests.
The shared Knex commit must be integrated before verification is self-contained
from a fresh checkout. Do not add another migration tool to compensate.

```sh
systemd-run --user --scope --quiet \
  --property=MemoryMax=16G --property=MemorySwapMax=0 --property=TasksMax=2048 \
  --working-directory="$(pwd)" \
  env CROSSFIRE_TEST_DATABASE_TEMPLATE="$CROSSFIRE_TEST_DATABASE_TEMPLATE" \
  npm run test:rust
```

The service's `scripts/generate-rust-schema.mjs` read-only introspects the exact
Knex-prepared model. `generate-rust-catalog.mjs` and
`generate-rust-operations.mjs` derive metadata from declared shared package
exports after the Node build. Each has a mandatory drift-check mode. These are
build-time generators, not Rust runtime dependencies or migration owners.

The verifier checks its aggregate memory/swap/task bounds, builds shared assets
once, compiles every test, runs isolated test binaries across available cores
without ignored cases, and reports per-file timings. Every test has a private
temporary directory removed on completion. It also runs native executable ↔
Node repository checks on the same prepared SQLite file, including questions,
answers, settings, traffic and cumulative token checkpoints. Neither side
initializes or migrates schema during that proof. This is storage interchange,
not full server, C# or provider certification.

Foundation gates are not full-product certification. Remaining required work
includes all REST handlers and workers, complete enrollment/access/publication/
wake delivery composition and fleet policy operations, complete Codex/Pi receipt,
interrupt, approval, recovery and sleep protocols, fleetd, the fleet CLI and
unchanged real-browser workflows. Do not deploy or publish this partial port.

The verifier also runs real Conduit authority checks and stock Codex private
process/session/instruction/resumption checks. Those do not run model inference
and do not certify the complete native listener or fleet controller. Calendar
parity compares more than two thousand cases against the actual Node export.
Journal interchange verifies both serialization and real cross-process ownership
locks. Lock files contain no application schema or persistent data tables;
SQLite is used only as the same native locking primitive as Node and C#.

Remove recreated fixtures and obsolete compiler output after their last use.
Preserve authored inputs, worktrees, credentials, production data and histories.
