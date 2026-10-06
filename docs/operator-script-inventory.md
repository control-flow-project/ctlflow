# Reusable operator check inventory

## Current ownership

Generic verification belongs to Crossfire/fleetd, not deployment scratch files.
Fleet CLI owns setup and lifecycle; all agents are controller-managed, including
one-agent fleets. Probes inspect the same private state and native adapter ports,
not an independently attached coding session.

Only `@ctlflow/fleet` and `@ctlflow/fleetd` are public npm products. Other modules
stay private. Updates consume installed version-pinned assets before explicit
daemon restart. No HTTP installer, optional launcher or alternate runtime
activation script exists. Read-only diagnostics do not start sessions, answer
decisions, advance unread positions, make model calls or create conversations.

## Capability disposition

The October 2026 consolidation reviewed Crossfire, GAAP and agents `.analysis/`
directories and deployment scratch files. The inventory records capability
families rather than committing private evidence, credentials, generated SDKs
or copied test checkouts. One current implementation owns each reusable check.

| Session/script family | Current owner and disposition |
| --- | --- |
| Adapter-review diagnostic probes | Existing adapter/listener regression tests; obsolete reproduction scripts are not another runtime implementation |
| Agreement native models and skills | `services/fleetd/tools/runtime/codex.ts` and `tools/verify.ts`: exact session, model/effort and actual Git/ancestor skill inspection |
| Fleet control-plane install/setup/activate/update scripts | Normal public-package build/installation gates and Fleet CLI own managed setup/lifecycle; operator `source`, `files`, `archive`, `host` and fleet preservation own reusable checks |
| Managed readiness | `fleet test FLEET` and intentional `agent test` inspect actual existing shared-host bindings without models, cursor changes or lifecycle mutation |
| Fleet-map administrator/API/approval/agent-visibility checks | Crossfire `server`, `enrollment` and `browser`; exact dynamic owner/code/roster instead of fixed deployment names |
| Management deployment/status/software/runtime checks | Crossfire `release`, `server`, shared `browser/layout.ts` and fleetd verification; Session owns native parameters, Settings owns current/latest software |
| Approval readiness and observation checks | Existing native/approval/observation regressions plus fleetd read-only native inspection; no operator prompt/answer injection |
| Invitation/discovery/native-room checks | Crossfire `server` native directory checks and fleetd `--no-rooms`; mutating invite/wake/delivery proofs stay in isolated application tests |
| Protected owner-DM, lazy-conversation and database snapshots | Crossfire `database` and `preservation` against consistent SQLite snapshots; schema14's 63 normalized tables with immutable historical archives and Tinqer ownership, not copied raw domain SQL |
| Controller/fleet/provider preservation scripts | fleetd `--snapshot`/`--preserve`, exact current bindings and native IDs, private provider file fingerprints |
| Source/artifact/image/host evidence scripts | Crossfire `source`, `release`, `files`, `archive`, `host`; expectation-driven revision/tree/image/labels |
| Production desktop/mobile layout scripts | One Crossfire `tools/browser/layout.ts` shared by real-browser operator checks and all existing application browser suites |
| GAAP room-scope/agreements/control-plane generic host and database scripts | Consolidated in Crossfire tools above; GAAP retains only site/theme/TLS/deployment inputs and activation ownership |
| Destructive database reset, obsolete-room cleanup and broad process kill | Not promoted. Production resets are banned; verified backups and forward migrations preserve deployed state. Confirmed fresh native history is a separate controller operation. |
| Regex-redacted evidence scripts | Replaced by typed allowlisted reports and normalized transport failures; no reliance on guessed secret patterns |
| Archived replacement application scripts | Not promoted. Bootstrap, enrollment, listener, lease, room and version behavior belongs to current product packages/tests |
| Agents document review/extract/index/bundle helpers | Remain domain-specific in the agents repository; not Crossfire tools |
| Native generated SDKs, binaries, fixture checkout copies, provider/cache state | Not source tools. Pin/install through their current owners when required; private/generated copies remain untracked |

Configuration-specific branding, Conduit/Element assets, nginx/TLS routing and
image activation remain deployment-project responsibilities. Site-specific UI
assertions and one-off reset evidence are not generic Crossfire contracts.
Reusable functional checks do not contain GAAP hosts, hardcoded human identities,
fleet names, twenty-agent assumptions or historical release hashes.

## Running checks

Use strict documented service commands with explicit host, owner, fleet, release
and source expectations. Keep credentials, screenshots and evidence private and
outside tracked source. Typed allowlisted reports avoid raw tokens, native
endpoints and filesystem dumps. Native settings/skill inspection is read-only;
inert Linux evidence does not certify paid providers, document quality or macOS.

Before an authorized update, verify a consistent backup, desired Stop/Resume
intent and exact saved native context IDs. Compare retained state after explicit
daemon restart. Optional native workspace does not relocate private state;
inspection/recovery cannot upgrade software or revive explicitly stopped agents.
Builds/tests use verified finite process-group memory/swap/task limits, not heap
flags alone. Mutating regressions run in isolated fixtures, not production.

- [Generic operator workflow and resource guards](operator-tools.md)
- [Crossfire command and input schemas](../services/crossfire/tools/README.md)
- [fleetd native verification and preservation](../services/fleetd/tools/README.md)
- [Managed setup and pinned updates](../services/crossfire/docs/onboarding/README.md)
- [Current schema and authorization contract](specification.md)
