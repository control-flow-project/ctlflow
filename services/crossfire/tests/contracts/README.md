# Shared external scenarios

These tests select backend executables, not backend-specific expected values.
Run through the root coordinators in a finite resource scope.
This is one acceptance suite across all three products. Product directories
partition source ownership only; every selected Node, managed .NET, NativeAOT
or Rust executable set receives these same assertions. Codex and Pi both run
through the controller and installed CLI scenarios.

| Capability | Scenario owner | Evidence |
| --- | --- | --- |
| Authentication | server.contract.ts | Unauthenticated refusal for every protected route |
| Successful REST operations | resources.contract.ts, server.contract.ts, fixture.ts | Every declaration receives a success decoded by its canonical output schema; missing coverage fails |
| Malformed query input | resources.contract.ts | Every declaration rejects an unknown query before mutation |
| Pagination | test-support/contract-pagination | Canonical lexical values, bounds, duplicates and empty collection metadata on server and daemon |
| Trusted ingress | ingress.contract.ts | Two actual TLS clients, overwritten spoofed headers, untrusted peer and missing/chained forwarding refusal |
| Human enrollment | fixture.ts, resources.contract.ts | Native invited registration, owner approval, roles, claim/exchange and unique names |
| Room authorization | resources.contract.ts | Native room application, full-plan preview/apply, scoped delegation and addition provenance |
| Native decisions | server.contract.ts, management-browser.contract.ts, fleetd/tests/contracts/daemon.contract.ts | Actual Codex/Pi question → owner review → explicit answer → original native tool output; no GET/agent consent, exact history/receipt, explicit browser selection |
| Scheduled input | resources.contract.ts | Rule CRUD, due claim, exact-session validation and acknowledgment |
| Publications | server.contract.ts, management-browser.contract.ts | Upload/commit, inventory, opaque script origin, owner deletion and durable files view |
| Management navigation | management-browser.contract.ts | Main/detail routes and mobile/desktop geometry |
| Management mutations | management-browser.contract.ts | Wake drafts/conflicts, delegation, schedule CRUD, decisions, dialog focus/cancel and report deletion |
| Native chat and interruption | fleetd/tests/contracts/messages.contract.ts | Actual Codex/Pi input, source attribution, held-turn interruption and owner notices |
| History/lifecycle | fleetd/tests/contracts/daemon.contract.ts | Saved contexts, controller restart, explicit stopped intent and management receipts |
| Crash recovery | fleetd/tests/contracts/daemon.contract.ts | Actual idle and in-flight controller SIGKILL, native writer exit, retained desired selection/history and unfinished-input continuation |
| Room-scoped recovery | fleetd/tests/contracts/daemon.contract.ts | Actual Codex/Pi room histories, one completed room and another unfinished room; stop/resume retains exact histories and does not restart completed work or mix room input |
| Upstream recovery | fleetd/tests/contracts/daemon.contract.ts | The actual server stops and restarts; the controller remains observable, closes unavailable delivery and reconnects without replacing histories or calling a model |
| Controller operations | fleetd/tests/contracts/daemon.contract.ts | Declaration coverage, unknown-query/body refusal, roster CRUD, revision fences, idempotent operation replay, explicit update and stopped setup/unregistration |
| Read-only diagnostics | fleetd/tests/contracts/daemon.contract.ts, fleet/tests/contracts/cli.contract.ts | Scoped authenticated reports, unchanged stop/history/configuration, inert provider checks, working state, absent credentials/controller and identical cross-target CLI access |
| CLI and SSH | fleet/tests/contracts/cli.contract.ts | Both native engines; installed setup, per-agent/fleet start/stop/reset/update, replay, delivery, broadcast, daemon restart and host-key refusal |
| Controller authentication | fleetd/tests/contracts/authentication.contract.ts | Mandatory bearer for every daemon operation, duplicate/wrong/missing key refusal, private initialization and browser-header denial |
| Data interchange | server.contract.ts | Every selected implementation reopens the same SQLite file |
| Concurrent storage | server.contract.ts | An open read snapshot does not block a committed controller heartbeat; every backend retains WAL |
| Container deployment | container.contract.ts | Actual operator/image, Element login/room/media, assets and persisted restart |
| Operator arguments | operator.contract.ts | Repeated-option refusal, canonical decimal port bounds, unchanged private state and validation before native operations |
| Operator recovery | container-recovery.contract.ts | Concurrent refusal, real launcher death, running/exited orphans and foreign-ownership fencing |

An authentication check is not successful-operation coverage. A decoded success
is not proof of every possible state transition. Language-local suites retain
internal failure-injection, compiler and algorithm checks. Paid-provider quality,
arbitrary subprocess containment and unselected platforms are outside this bank.
Pi's unsupported terminal attachment is an explicit checked native-capability
refusal on every implementation, never a backend-specific skipped scenario.

The shared `@ctlflow/crossfire-test-support/tls` fixture owns a distinct authority and CA:FALSE server certificate,
with localhost/IP subject alternatives and serverAuth usage. Strict native clients
verify its actual chain; no backend disables TLS verification. The installed
ingress fixture uses a real TLS proxy that overwrites the peer IP;
its immediate application peer is explicitly trusted. Container deployment tests
separately exercise rootless port publication and persistent data. Migration-orphan
fixtures represent abandoned native-container states; they do not simulate every
possible interrupted Knex statement.

- [Execution and matrix format](../../../../docs/verification/shared-contracts.md)
