# Shared implementation contracts

Node, C# managed, C# NativeAOT and Rust implement the same Crossfire, fleetd and
Fleet contracts. External behavior has one assertion owner. An implementation
target supplies only three executable/argument vectors; it cannot replace tests,
change expected values or skip either supported native engine.

The complete Node/managed/NativeAOT matrix is mandatory for Node/C# sign-off.
Current-source results and diagnostic limits are recorded in the native readiness
report; a build or an earlier passing checkpoint alone is not certification.

## Owners

```text
scripts/
  contract-matrix.mjs            explicit executable-matrix assembly
  contract-targets.mjs           one strict matrix boundary for every worker
  verify-contracts.mjs           bounded build/assets/worker coordination
  contract-worker.mjs            identical ordered suite for every target
  verify-container.mjs           finite Docker slice and identical container suite
  container-worker.mjs           same API/SQLite/React/Element cases in real images
  verify-parity.mjs              serialized complete Node/C# release verification
services/
  crossfire/
    node/packages/test-support/src/
      contract-process.ts       isolated processes and bounded observations
      contract-http.ts          actual HTTP and private Unix-socket transport
      contract-platform.ts      cross-product fixture port
    tests/contracts/
      fixture.ts                actual Conduit, Knex database and shared assets
      server.contract.ts        API, identity, authority and same-file behavior
      browser.contract.ts       unchanged React on mobile and desktop
      container-fixture.ts      actual selected operator, Knex and native Conduit
      container.contract.ts     real Element signup, room/media and restart checks
  fleetd/tests/contracts/
    daemon.contract.ts          actual daemon API and Codex/Pi lifecycle
    messages.contract.ts        actual chat, hard steering and history tools
  fleet/tests/contracts/
    cli.contract.ts             actual CLI against its own private daemon
    ssh-fixture.ts              isolated real SSH with explicit host-key trust
```

Language-specific unit tests remain responsible for compiler generation, EF
mapping, protocol parsing and internal state transitions. They do not define a
different public contract. Existing lower-layer parity tests remain mandatory.
For example, `services/fleetd/csharp/tests/Fleetd.Domain.Tests` exercises a held
startup racing with individual stop, whole-fleet stop and daemon shutdown, then
checks exact-history explicit resume. Its in-memory ports prove controller state
transitions, not real native integration; the shared daemon scenarios supply the
separate actual Codex/Pi evidence when executed.
The shared suite complements them; it is not a substitute for all unit,
architecture, container, warning-audit and performance gates.
The root structure gate also validates native C# project ownership and rejects
domain-to-contract/adapter imports, application-source references and product
dependencies on build/test projects. Its negative fixtures remain part of the
ordinary root test bank.

## Explicit target matrix

The JSON document has `schemaVersion: 1` and a `targets` array. Each target has
exactly `name`, `implementation`, `server`, `daemon` and `cli`. Implementation is
`node`, `csharp` or `rust`. Each command has an absolute executable `binary` and an
explicit string-array `arguments`. No shell parsing or command-string expansion
occurs. For example:

```json
{
  "name": "csharp-nativeaot",
  "implementation": "csharp",
  "server": { "binary": "/opt/ctlflow/nativeaot/crossfire/Crossfire.Server", "arguments": [] },
  "daemon": { "binary": "/opt/ctlflow/nativeaot/fleetd/fleetd", "arguments": [] },
  "cli": { "binary": "/opt/ctlflow/nativeaot/fleet/fleet", "arguments": [] }
}
```

Every matrix includes Node as the direct same-file reference. A matrix containing
C# must contain both `csharp-managed` and `csharp-nativeaot`. All configured
executables must exist; no failed or unavailable target is silently omitted.
Each target runs both actual Codex and Pi, regardless of its implementation.
The evidence lists exactly which targets ran. A Node/C# run is not a Rust pass.
Rust's separate PR can use the same suite as soon as its binaries are available;
its source does not need to be merged into this C# worktree first.

Build both C# distributions before assembling the matrix. Supply `--rust` when
the separate Rust distribution is ready; omit it for the C# PR's Node/managed/AOT
gate. Commands:

```sh
node scripts/contract-matrix.mjs \
  --managed /opt/ctlflow/managed \
  --nativeaot /opt/ctlflow/nativeaot \
  --rust /opt/ctlflow/rust \
  --output /tmp/crossfire-implementation-matrix.json
systemd-run --user --scope --quiet \
  --property=MemoryMax=32G --property=MemorySwapMax=0 --property=TasksMax=8192 \
  --working-directory=/absolute/path/to/crossfire \
  node scripts/verify-contracts.mjs /tmp/crossfire-implementation-matrix.json
```

`npm run verify:container -- /absolute/matrix.json` runs the same public API,
same-file SQLite, management and actual Element scenarios through each selected
operator's real rootless Docker image. The one-shot Knex migration container runs
before activation. Managed/native C# image selection comes from the verified
distribution metadata, not its descriptive target label. There are no alternate
expected values or backend-specific skips. Containers retain production read-only
roots, dropped capabilities, explicit loopback ports and a finite aggregate slice.

For the complete Node/C#/Rust gate, use an existing parent and a new evidence directory:

```sh
systemd-run --user --scope --quiet \
  --property=MemoryMax=16G --property=MemorySwapMax=0 --property=TasksMax=2048 \
  --working-directory=/absolute/path/to/crossfire \
  npm run verify:parity -- /absolute/new-evidence-directory
```

This serializes architecture, all Node tests, C# core/native acceptance, Rust
internal/native tests, all three native distributions, shared executable contracts, actual containers
and migration-container acceptance. It retains bounded logs and scalar results;
its temporary distributions are removed after successful verification. Failed-gate
distributions remain only for immediate bounded diagnosis and must be removed
after their last diagnostic use. Do not run another
build against the same worktree while any gate is using its compiled artifacts.

The coordinator verifies aggregate cgroup limits, builds shared packages/assets
once, prepares pinned Conduit and Pi once, and runs isolated target workers up
to the available CPU count. Target executables inherit the bounded scope. Browser
assets and the supported Codex executable must be installed through the existing
repository prerequisite process. Inert loopback providers avoid paid model calls.
Per-target deadlines and bounded evidence are retained; disposable databases,
native test homes, processes and fixture trees are removed in reverse ownership
order. Cleanup failure is a test failure, not a reason to discard an assertion.

## Covered behavior

- Canonical protected routes authenticate without leaking resources; output
  envelopes are checked through the common contract parsers.
- Same-origin/CSRF/cookie behavior, explicit invitation signup, exact agent-name
  collisions, owner isolation, native room invitation/grant and private DMs.
- Controller leases, actual listener/native observations, explicit owner answers,
  fleet message receipts and native-close proof.
- Static publication staging/upload/commit, actual browser opaque-origin sandbox,
  isolated content response and deletion;
  scheduled wake-up revision handling; unchanged mobile/desktop React.
- Actual per-instance native effort over role defaults, model-free inspection,
  exact saved history, deliberate stop intent and daemon restart/resume.
- Real source-attributed messages, native interruption of a held provider request,
  private owner-DM receipt/acceptance evidence, large-message files and scoped/global
  history queries, including explicit unread acknowledgment without inference.
  Large input is queued while delivery is paused, then resumed, so correctness
  does not depend on two network requests arriving inside a debounce window.
- Real CLI controller reuse, private socket ownership, stopped-roster changes,
  history inspection, unsupported-option rejection and resumable daemon shutdown;
  actual SSH private-API forwarding and untrusted host-key rejection.
- Actual noninteractive CLI setup, explicit human enrollment approval, repeated
  exact-history setup and preservation of deliberate stop without model prompts;
  management session requests completed by the actual controller/native runtime.
- Every configured server reopens the same management SQLite file without an
  importer, ORM migration, reset or alternate storage representation.

This is the shared integration layer, not an assertion that every edge case or
every production provider has been certified. Complete release evidence must name
the tested source revision, target outputs and remaining diagnostic findings.
