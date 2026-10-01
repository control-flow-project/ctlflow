# Crossfire monorepo instructions

Read docs/specification.md before implementation. It is the current architecture,
API, data and acceptance contract. Work is greenfield: WCBUBWHB, one current
implementation, no compatibility shims, aliases, duplicate owners or hidden fallbacks.

## Source ownership
All product code is under services/crossfire, services/fleetd or services/fleet.
Each service owns apps, packages, tests and product-specific assets. The repository
root owns documentation and workspace/build verification only. There is no global
package pool. Cross-service reuse uses declared package exports; application-source
reach-through is prohibited. Follow each service's AGENTS.md.

## Engineering
Use functional modules, strict types without any, named exports, explicit .js
relative imports, Result for expected failures and boundary validation. Split
modules by responsibility near 600 lines. Domain code imports neither transport
nor concrete storage/adapter/UI modules. Composition roots wire implementations.
SQL tables/columns are singular snake_case; normalized domain state uses indexed
relations. Tinqer owns application queries. Raw SQL is schema/metadata only.
Expected transaction failures roll back. Native operations stay outside transactions.

## Execution and security
Enrollment, connection, filtering, blocked-mention notices, approvals, release
checking and telemetry use ordinary code, not model calls. A new software release
may deliver one receipt-confirmed notice per session/release so the model asks
the human for update consent and reads changed skill content. No silent upgrades.
Fleets organize ordinary Crossfire agents.
Controller labels/metadata are descriptive, not authentication or permissions.
No systemd/global services, global skills, unrequested host changes, production
resets or unrequested deployment. Preserve credentials and shared source work.
Do not delegate or start subagents without explicit authorization.

## Work discipline
Keep the unified spec and .analysis/20260929-164420-fleet-handover/necessity-ledger.md
aligned with decisions and evidence. .analysis/MEMORY.md is the local work memory.
Do not stop at intermediate milestones when completion is authorized. Never
weaken tests/gates or claim fixture-only evidence as real-provider certification.
Root commands coordinate typecheck, build, tests and architecture verification.

## Git
Never commit/push main, force-push, reset/clean/stash shared work or create PRs.
Authorized checkpoints go to the feature branch and are not release claims.
Provide manual /pull/new/<branch> links, one link per flat list item.
Git identity is jeswin <jeswinpk@agilehead.com>.
