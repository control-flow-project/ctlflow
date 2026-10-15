# Shared external scenarios

These tests select backend executables, not backend-specific expected values.
Run through the root coordinators in a finite resource scope.

| Capability | Scenario owner | Evidence |
| --- | --- | --- |
| Authentication | server.contract.ts | Unauthenticated refusal for every protected route |
| Successful REST operations | resources.contract.ts, server.contract.ts, fixture.ts | Every declaration receives a success decoded by its canonical output schema; missing coverage fails |
| Malformed query input | resources.contract.ts | Every declaration rejects an unknown query before mutation |
| Pagination | test-support/contract-pagination | Canonical lexical values, bounds, duplicates and empty collection metadata on server and daemon |
| Trusted ingress | ingress.contract.ts | Two actual TLS clients, overwritten spoofed headers, untrusted peer and missing/chained forwarding refusal |
| Human enrollment | fixture.ts, resources.contract.ts | Native invited registration, owner approval, roles, claim/exchange and unique names |
| Room authorization | resources.contract.ts | Native room application, full-plan preview/apply, scoped delegation and addition provenance |
| Native decisions | server.contract.ts, management-browser.contract.ts | Exact review/answer/receipt, read-only links and explicit browser selection |
| Scheduled input | resources.contract.ts | Rule CRUD, due claim, exact-session validation and acknowledgment |
| Publications | server.contract.ts, management-browser.contract.ts | Upload/commit, inventory, opaque script origin, owner deletion and durable files view |
| Management navigation | management-browser.contract.ts | Main/detail routes and mobile/desktop geometry |
| Management mutations | management-browser.contract.ts | Wake drafts/conflicts, delegation, schedule CRUD, decisions, dialog focus/cancel and report deletion |
| Native chat and interruption | fleetd/tests/contracts/messages.contract.ts | Actual Codex/Pi input, source attribution, held-turn interruption and owner notices |
| History/lifecycle | fleetd/tests/contracts/daemon.contract.ts | Saved contexts, controller restart, explicit stopped intent and management receipts |
| CLI and SSH | fleet/tests/contracts/cli.contract.ts | Installed commands, private API, host-key refusal and noninteractive setup |
| Data interchange | server.contract.ts | Every selected implementation reopens the same SQLite file |
| Container deployment | container.contract.ts | Actual operator/image, Element login/room/media, assets and persisted restart |
| Operator recovery | container-recovery.contract.ts | Concurrent refusal, real launcher death, running/exited orphans and foreign-ownership fencing |

An authentication check is not successful-operation coverage. A decoded success
is not proof of every possible state transition. Language-local suites retain
internal failure-injection, compiler and algorithm checks. Paid-provider quality,
arbitrary subprocess containment and unselected platforms are outside this bank.

The installed ingress fixture uses a real TLS proxy that overwrites the peer IP;
its immediate application peer is explicitly trusted. Container deployment tests
separately exercise rootless port publication and persistent data. Migration-orphan
fixtures represent abandoned native-container states; they do not simulate every
possible interrupted Knex statement.

- [Execution and matrix format](../../../../docs/verification/shared-contracts.md)
