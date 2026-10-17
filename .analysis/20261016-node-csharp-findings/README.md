# Node/C# findings for the main session

Date: 16 October 2026. Reference: origin/main `09fec7c`.

This is the earlier baseline report, not the current verification verdict.
Main a9c7c42 is now integrated. The current findings, resolved upstream items and
Rust-only evidence are in `../20261016-rust-main-integration/verification.md`.
In particular, the common external TLS fixture no longer blocks installed Rust
contracts; its authority/leaf correction does not disable native TLS validation.

The owner restricted this fork to Rust. Every Node/C# product file, test, asset,
Dockerfile, the C# solution and the C# publisher now match that reference exactly.
This includes removing earlier branch changes, not just the last uncommitted
edits. Shared Rust verification/build wiring remains. Nothing here is deployed.

`proposed-changes-not-applied.diff.gz` preserves the removed proposals and tests for
review. It is evidence, not an instruction to apply the entire patch: inspect
each owning implementation, reconcile the main session's current work and rerun
the relevant gates. Do not reintroduce a second owner or compatibility path.
Read it with `gzip -cd .analysis/20261016-node-csharp-findings/proposed-changes-not-applied.diff.gz`.
Proposed calls to String.isWellFormed need ES2024 TypeScript declarations on the
selected Node 26 runtime; this fork restores the root/web compiler settings to
main and does not apply that accompanying declaration change.

## Findings and required owner work

| Area | Finding | Correct owner and verification |
| --- | --- | --- |
| Unicode boundary validation | Node accepts JSON strings/property names containing lone UTF-16 surrogates; C# validation and some native Matrix text truncations can also admit/split them | Contract validators and scalar-safe truncation at producers; test string/key/identifier/control cases and Matrix names/error text in each mode |
| HTTP UTF-8 | Node's public body decoder and some persisted/native JSON readers replace malformed bytes; C# public JSON also needs explicit strict decoding | Reject at byte-to-text boundaries without rewriting corrupt files; submit malformed byte sequences and prove unchanged identity/revision |
| SQLite search | Tinqer includes compiles to SQLite LIKE, EF Contains to instr; discovery/fleet add host-specific lowercasing | One bound SQLite LIKE rule, ASCII case folding only, literal non-ASCII case, percent/underscore patterns, no interpolated SQL; same-file agent/discovery/fleet/wake/report cases |
| HTTP response bounds | Native public/private clients disagree on default body/deadline limits | Match declared 32 MiB/30 s public and 16 MiB/120 s private bounds; actual HTTP boundary/oversize/cancellation tests |
| Ambient proxies | C# HTTP, Codex WebSocket and private daemon clients can use ambient proxies | Disable proxies explicitly in native adapters; real rejecting proxy with a positive proxy-using control |
| Empty-page metadata | Native clients can accept zero totalPages although empty canonical collections have one page | Align producers/validators and reject zero; test empty, first, later and out-of-range pages |
| Listener telemetry | Some labels can split a scalar or exceed wire bounds; an overflowing sum can poison future heartbeats | Scalar-safe labels and atomic bounded count admission; reject one bad sample while preserving the last valid summary and delivery |
| CLI fleet listing | Node name lookup reads one page | Bounded complete directory acquisition using the existing API client; lookup beyond the first page |
| CLI input validation | Native start syntax must fail before starting a controller | Validate complete arguments before lifecycle calls; invalid start/agent-start must leave no controller, native request or private root |
| Daemon labels | C#/Node accept a label without the complete shared Unicode/text rule | Validate a supplied label at the boundary, keeping omitted/default distinct from invalid; scalar/control/length tests |
| Matrix effects | Room names, chat publication and Matrix failure text need consistent native bounds | Truncate at the producer using whole scalars; preserve configured limits and test actual room/publication paths |
| SSH cleanup | C# stderr/exit completion can race tunnel observation | Own a bounded exact child lifetime and drain its streams before outcome; real SSH acceptance, not sleeps |
| Element extraction | Existing shared extraction cleanup has a 30 s Docker client timeout that was exceeded while Docker removed the exact ID | Preserve exact ownership and both primary/cleanup errors; finite deadline, no readiness before cleanup, real browser and forced cleanup failures |
| Fixture shutdown | Shared ContractProcess only allows a hardcoded 10 s cleanup; Docker operator grace can be longer | Main-owned fixture deadline contract, bounded and explicitly selected by the container fixture; prove cleanup failure stays visible |
| TLS fixture | `services/crossfire/node/tests/support/tls.ts` uses one CA:TRUE certificate as the HTTPS server leaf. Rust rustls correctly returns CaUsedAsEndEntity; native controller enrollment and CLI setup then fail before creating their fleet bindings | Main-owned test fixture must issue a separate CA:FALSE server certificate with serverAuth, localhost/IP SANs and a valid chain. Trust only the fixture CA. Do not disable certificate/hostname/chain verification or special-case Rust |
| Timezone preparation | C# verification compiles host tzdata and requires it to equal Node ICU; host is now 2026e, Node remains 2026c | Use the checksum-pinned source owner already used by Rust, remove duplicate host loader; retain every calendar comparison, do not modify host data |
| Timezone image metadata | Node's assets image verifies/compiles the pinned IANA data but does not retain its version file | Make the asset owner retain pin metadata when the main session updates it; Rust currently stages its own required version descriptor from the same pin without changing Node Docker |
| Distribution docs | C# publisher copies its implementation README, whose source-relative links are not useful after standalone installation | Main-owned publisher should stage a standalone target guide; verify exact bytes and links in managed and AOT bundles |

## Evidence boundaries

Before the restriction, full attempt 10 passed architecture, 912 Node tests,
both C# modes, 260 Rust tests, all three native distributions and all installed
four-target contracts. That was proposed cross-target source, not the restored
source. The owner-directed scope change stopped its still-running container
phase. Its earlier results must not be used to certify unchanged main or the
final Rust-only branch. Final Rust verification is recorded separately.

After restoring Node/C#, the scoped gate passes architecture, type checking,
all 260 Rust tests/133 binaries, 2,072 calendar comparisons, bidirectional SQLite
and journal/lock checks, real Conduit authority and a release distribution.
Its installed product bank reproduces the TLS fixture failure above. HTTP/server,
browser and ingress assertions run, but native controller/CLI setup cannot be
certified through that invalid fixture. Follow-up Rust container and Knex checks
remain independent and must still finish; they are not substitutes for that bank.

The .NET 11/EF preview diagnostics remain visible. Successful owned queries do
not establish arbitrary reflection/plugin support or all-host crash behavior.
Node/C# controller SIGKILL can leave a native writer; native locks refuse a
competing writer. Rust has its own exact-parent Linux process guard. No claim
that this difference is architecturally impossible for the other targets is made.

## Main-session checklist

Final independent follow-up: all 29 Rust container assertions pass after correcting
this branch's directory fixture to stop its old controller/listener before long
restarts and register fresh generations afterward. No server expiry rule or
assertion was relaxed. Actual Element/media, every REST operation, both browser
widths and all four operator/orphan scenarios pass. The Knex container passes
schemas 0/13/17 and rejects future 18. The installed native fleet/CLI TLS fixture
block remains. See `verification.md` for the final scoped verdict.

- Reconcile this report and each proposal against current main before editing.
- Keep Knex as the sole migration owner, existing SQLite files and one React UI.
- Implement each decision once at its actual owner; remove superseded decisions.
- Run shared contracts across Node, managed C#, NativeAOT and Rust after integration.
- Include actual Codex/Pi, Conduit, browser, container/orphan and migration tests.
- Preserve production state, credentials, histories and deliberate stopped agents.
