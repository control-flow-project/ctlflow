# Native implementation structure

Node, C# and Rust implement the same three products with the same ownership
boundaries. Language selection changes the implementation, not the UI, API,
database model or responsibility of a service. This review covers the parallel
C# and Rust tracks as inspected on 14 October 2026; neither inspection nor a
shared directory shape establishes complete product parity.

## Common product layout

```text
services/
  crossfire/
    apps/
      server/                       Node composition
      web/                          The only React management UI
    packages/                       Node libraries and adapters
    database/
      management/
        sqlite/
          migrations/               Shared Knex owner
          seeds/
    knexfile.management.mjs
    csharp/
      apps/Crossfire.Server/
      packages/
        Crossfire.Kernel/
        Crossfire.Domain/
        Crossfire.Contracts/
        Crossfire.AdapterFilesystem/
        Crossfire.AdapterHttp/
        Crossfire.AdapterMatrix/
        Crossfire.AdapterSqlite/
        Crossfire.AdapterSchedule/
        Crossfire.AgentCore/
        Crossfire.AdapterRuntime/
        Crossfire.AdapterCodex/
        Crossfire.AdapterProcess/
        Crossfire.AdapterToml/
      build/
        Crossfire.EfCompiler/        EF query generation only
        Crossfire.EfHost/            Design-time compiler host only
      tests/
    rust/
      apps/server/
      packages/
        kernel/
        domain/
        contracts/
        adapter-filesystem/
        adapter-http/
        adapter-matrix/
        adapter-sqlite/
        adapter-schedule/
        agent-core/
        adapter-runtime/
        adapter-codex/
        adapter-process/
        adapter-toml/
      tests/
  fleetd/
    apps/daemon/                    Node composition
    packages/                       Node domain, contracts and file storage
    csharp/
      apps/Fleetd.Daemon/
      packages/
      tests/
    rust/
      apps/daemon/
      packages/
      tests/
  fleet/
    apps/cli/                       Node composition
    packages/                       Node daemon client and SSH transport
    csharp/
      apps/Fleet.Cli/
      packages/
      tests/
    rust/
      apps/cli/
      packages/
      tests/
```

This is the final responsibility map, not an inventory of completed modules.
Only implemented capabilities receive directories and manifests. Native listener,
client, Codex and Pi packages follow their existing Crossfire service owners;
fleetd consumes those packages rather than creating another listener or runtime
integration. Fleet talks to fleetd even locally and owns neither native processes
nor private daemon state.

## Equivalent boundaries

| Responsibility | Node | C# | Rust |
| --- | --- | --- | --- |
| Primitive results and identities | `kernel` | `Crossfire.Kernel` | `kernel` |
| Rules and pure ports | `domain` | `Crossfire.Domain` | `domain` |
| Wire validation and views | `contracts` | `Crossfire.Contracts` | `contracts` |
| Filesystem authority | `adapter-filesystem` | `Crossfire.AdapterFilesystem` | `adapter-filesystem` |
| Native Matrix authority | `adapter-matrix` | `Crossfire.AdapterMatrix` | `adapter-matrix` |
| Connection, schema validation, transactions and queries | `adapter-sqlite` | `Crossfire.AdapterSqlite` | `adapter-sqlite` |
| Calendar schedules | `adapter-schedule` | `Crossfire.AdapterSchedule` | `adapter-schedule` |
| Listener/runtime pure ports | `agent-core` | `Crossfire.AgentCore` | `agent-core` |
| Journals, receipts and restart context | `adapter-runtime` | `Crossfire.AdapterRuntime` | `adapter-runtime` |
| Codex native integration | `adapter-codex` | `Crossfire.AdapterCodex` | `adapter-codex` |
| Owned process primitives | Native platform API | `Crossfire.AdapterProcess` | `adapter-process` |
| Native configuration parsing | Native TOML dependency | `Crossfire.AdapterToml` | `adapter-toml` |
| Application composition | `apps/server` | `apps/Crossfire.Server` | `apps/server` |
| Database creation and upgrades | Shared Knex `database` | Same owner | Same owner |
| Browser application | Shared `apps/web` | Same UI build | Same UI build |

Domain rules depend on kernel values and declared pure ports, never concrete
transport, persistence, native-process or UI modules. Adapters implement the
ports; composition roots select and assemble them. Applications are not reusable
dependencies. Test fixtures are never product dependencies.

Knex alone owns schema creation, reference initialization and forward migrations.
Application adapters validate and open an already prepared store. Generated
Diesel table types and EF entities are query metadata inside the SQLite adapter,
not separate database engines or migration owners. The parallel C# track owns
the shared Knex hierarchy and containers; Rust consumes its coordinated change.

## Language specific structure

Rust uses Cargo crates, snake_case modules, typed Diesel query expressions,
ownership and `Result`. C# uses projects, namespaces, EF entities and the
required DbContext/resource classes. Neither target imitates the other's syntax
or creates duplicate classes to manufacture file-by-file symmetry.

EF's build-only compiler is a .NET requirement, not another runtime service.
Rust does not need a corresponding compiler project. Both targets use the same
schema; generated-file organization differs to match their compilers. Rust's
per-crate integration tests are ordinary Cargo targets within
the service; C#'s acceptance executable is an ordinary test project. These
differences do not change product responsibility or persisted state.

Native HTTP is an adapter boundary in both native targets. Node's Matrix adapter
uses its platform HTTP API directly. No artificial Node HTTP package is needed
solely to match a target-specific HTTP library.

## Inspection and correction

The inspected C# worktree contains kernel, domain, contracts, filesystem, HTTP,
Matrix, SQLite and schedule packages, plus server composition and acceptance
tests. Its native fleetd, fleet CLI and full runtime parity remain unfinished.
Its test results are owned by that track; this review does not rerun or certify
them.

Rust's fourteen Crossfire package boundaries and three fleetd package boundaries
follow the same service/layer ownership. Its unnecessary separate
database runtime crate has been removed: connection, configuration, generated
schema, transactions and repositories now have one SQLite adapter owner. No
alias, transitional facade or second read/write path remains. Rust's server
and native fleet products remain completion work rather than empty
directories advertising unsupported features.

Rust now implements calendar scheduling, wake-up rules/storage/contracts and
native runtime foundations behind these owners. Its real Codex check starts an
authenticated app-server, verifies capabilities, injects receipt-confirmed native
instructions without model inference, closes it and resumes the exact saved
history. Generic journals and ownership locks preserve Node's on-disk format.
Both runtime adapters now use the same owned-runtime ports. Verified native
Pi 1.0.0 acceptance covers saved histories, receipts, instructions, observations,
token counters, per-room contexts, hard interruption and owner questions using
an inert loopback provider. These checks are not cloud-provider or complete
listener/controller/server certification.

The managed native home copies only model/provider settings and the selected
profile, not host permission overrides, MCP servers, unrelated profiles or
other host integrations. Authentication refresh replaces the private native
login on every invocation and removes stale native login when host login is
removed. Corrupt, public, hard-linked or symlinked credentials are rejected
without replacing the previous login or exposing contents in errors.

The Rust process adapter uses Linux pidfd readiness before reaping its owned
process-group leader, then terminates remaining group members. This prevents
abandoned subprocesses and avoids signalling a recycled leader identity. A
safe `AsFd`-based readiness adapter owns those descriptors; first-party unsafe
code remains forbidden. It has one shared readiness reactor, not one blocked
thread per agent. This is a native implementation detail, not another product.

The inspected C# WebSocket transport currently constructs `SocketsHttpHandler`
without explicitly disabling proxies, unlike its HTTP adapter and Rust's direct
loopback socket transport. This is an outstanding peer-track security review
item, not an approved symmetry exception. The peer worktree remains untouched.

`scripts/native-architecture.mjs` validates selected native dependency graphs,
rejects application reach-through, production fixture dependencies, concrete
domain dependencies, duplicate owners, another UI and a separate database
runtime owner. Its explicit `--csharp-root` argument can inspect the other
worktree read-only and report shared and target-only boundaries. Structural
coverage is distinct from the full capability and verification gates.
