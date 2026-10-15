# Implementation structure and ownership

Node, C# and Rust implement the same three products. Selecting an implementation
does not change the UI, wire contracts, database or product responsibilities.
This document describes the current model, not historical unfinished checkouts.
Verification evidence is recorded separately in the implementation reviews.

## Source tree

```text
services/
  crossfire/
    apps/web/                         one React application
    database/
      management/sqlite/
        migrations/                   Knex only
        seeds/
    knexfile.management.mjs
    node/
      apps/server/
      packages/
      tests/
      scripts/
      tools/
      Dockerfile
    csharp/
      apps/Crossfire.Server/
      packages/
      tests/
      build/
        Crossfire.EfCompiler/          design-time query generation
        Crossfire.EfHost/              design-time host
      scripts/
      Dockerfile
    rust/
      apps/server/
      packages/
      tests/
      Dockerfile
    tests/contracts/                  implementation-independent assertions
    scripts/                          shared asset/schema generators
  fleetd/
    node/{apps/daemon,packages,tests,scripts,tools}/
    csharp/{apps/Fleetd.Daemon,packages,tests}/
    rust/{apps/daemon,packages}/
    tests/contracts/
  fleet/
    node/{apps/cli,packages,tests,scripts}/
    csharp/{apps/Fleet.Cli,packages}/
    rust/{apps/cli,packages}/
    tests/contracts/
scripts/                              workspace/build/verification only
```

Only implemented owners receive directories. Rust integration tests belong to
their crates; there is no empty service test directory added for visual symmetry.
Node TypeScript and Rust modules use their language conventions; C# uses .NET
project/namespace/file conventions. Semantic ownership, rather than matching
class names or artificial files, is authoritative.

## Semantic package map

| Responsibility | Node | C# | Rust |
| --- | --- | --- | --- |
| Primitive results, identity and time | kernel | Crossfire.Kernel | kernel |
| Rules and repository ports | domain | Crossfire.Domain | domain |
| Wire validation and views | contracts | Crossfire.Contracts | contracts |
| Filesystem authority | adapter-filesystem | Crossfire.AdapterFilesystem | adapter-filesystem |
| REST client and transport | client + native HTTP | Crossfire.AdapterHttp | adapter-http |
| Native Matrix authority | adapter-matrix | Crossfire.AdapterMatrix | adapter-matrix |
| SQLite connections, query metadata and transactions | adapter-sqlite | Crossfire.AdapterSqlite | adapter-sqlite |
| Calendar scheduling | adapter-schedule | Crossfire.AdapterSchedule | adapter-schedule |
| Pure listener/runtime coordination | agent-core | Crossfire.AgentCore | agent-core |
| Journals, exact receipts and restart state | adapter-runtime | Crossfire.AdapterRuntime | adapter-runtime |
| Codex integration | adapter-codex | Crossfire.AdapterCodex | adapter-codex |
| Earendil Pi integration | adapter-pi | Crossfire.AdapterPi | adapter-pi |
| Enrollment, fleet connection and private listener host | adapter-crossfire | Crossfire.AdapterCrossfire | adapter-crossfire |
| Fleet lifecycle and pure ports | fleetd/domain | Fleetd.Domain | fleetd/domain |
| Fleet configuration and API contracts | fleetd/contracts | Fleetd.Contracts | fleetd/contracts |
| Fleet private persisted state | fleetd/storage | Fleetd.Storage | fleetd/storage |
| Concrete runtime/listener composition | fleetd/adapter-execution | Fleetd.AdapterExecution | fleetd/adapter-execution |
| Daemon client | fleet/daemon-client | Fleet.DaemonClient | fleet/daemon-client |
| Strict SSH transport | fleet/ssh-transport | Fleet.SshTransport | fleet/ssh-transport |

Domain code depends on kernel values and declared pure ports, never concrete
transport, SQLite, runtime, filesystem or UI implementations. Composition roots
assemble adapters. Applications are not reusable dependencies and product
dependencies cannot reference test fixtures or build tooling.

Fleetd owns one shared listener host and native lifecycle. Its daemon application
owns the user-scoped private API, configuration, signals and composition only.
Fleet uses that API even locally; SSH wraps the same private API remotely.
Crossfire coordinates leases, authorization, activity and receipts but never
launches an agent. Native adapters encapsulate engine-specific protocols.

Knex alone creates and migrates databases. Tinqer, EF and Diesel own their
respective application queries over the exact same schema. Generated entities,
tables and precompiled queries remain inside the SQLite adapter. No native ORM
creates a schema or silently migrates on startup. The shared one-shot migration
container runs after writers stop and a required backup is verified.
Filesystem-state conversions are explicit operations, not alternate runtime
readers, SQL migration owners or permission to reset a database.

## Required target differences

- C# owns its EF design-time compiler projects; Rust uses generated Diesel table
  metadata and typed native query expressions. Neither creates imitation packages
  for a compiler mechanism it does not use.
- Native targets own process and TOML libraries because those runtimes require
  them. Node uses its platform process/HTTP APIs and pinned TOML dependency.
- Rust domain orchestration uses Tokio concurrency and serde_json values as
  native primitives, equivalent to Promise/Task and native JSON values in the
  other targets. The graph names these dependencies explicitly; unknown external
  libraries and concrete Tokio/std filesystem, transport and process operations
  remain rejected. No facade hides such operations behind a purported pure port.
- Rust owns a Linux pidfd-based readiness reactor and native process-group guard.
  The guard is a process-adapter executable, not another product, listener or
  service. It runs only with an active engine, holds an exact private lock and
  terminates the owned native group if fleetd exits, including SIGKILL.
  No terminal scraping, history rewriting, global service or unsafe first-party
  Rust is introduced.
- Native distributions select the shared pinned IANA timezone data explicitly;
  there is no silent host-timezone fallback. Browser assets, Element, Conduit and
  onboarding releases are shared build inputs, not separately maintained copies.
- Managed and NativeAOT outputs use one C# implementation. Rust uses one
  ahead-of-time native implementation. None falls back to another backend.

Credential refresh copies only the selected model/provider configuration and
login, never unrelated MCP servers, profiles or host permission overrides.
Every native activation refreshes that login; removing host login removes the
stale native copy. Corrupt/public/hard-linked/symlinked private state fails closed.
Native HTTP/WebSocket transports explicitly avoid proxy-mediated private traffic.

## Architecture and verification gates

`scripts/verify-implementation-layout.mjs` checks every product/application and
19 semantic package pairs, rejects superseded service-level source owners and
keeps one UI and one common assertion bank. `scripts/native-architecture.mjs`
checks the Cargo/.NET graphs, pure-domain boundaries, build/dev edges and
application reach-through. Negative fixtures prove that violations are rejected.

`npm run verify:parity -- /absolute/new-evidence-directory` builds and exercises
Node, managed C#, NativeAOT C# and Rust. The same installed-product assertions run
against all selected products; native unit/adapter tests remain language-owned.
Container, exact same-file SQLite and shared Knex migration proofs are additional
gates, not inferred from directory shape or focused fixture success.
