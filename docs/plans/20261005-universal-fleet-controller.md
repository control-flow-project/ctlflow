# Universal fleet controller implementation plan

## Objective and approved decisions

Implement one current deployment architecture: every Crossfire agent belongs to
a fleet managed by fleetd. A one-agent fleet is an ordinary fleet, not a second
mode. fleetd hosts the shared listener and owns native lifecycle through runtime
adapter interfaces. Crossfire remains REST and owns identity, authorization,
room access, delivery policy, receipts and management. Fleet is the controller
CLI, not a second lifecycle owner.

The existing coding session only performs setup. It remains independent; no
native session adoption, history import, process discovery or terminal handoff
is implemented. fleetd creates the managed agent's first conversation. Subsequent
starts resume its exact saved histories unless the human explicitly requests
fresh history. Stop intent survives controller restart. No setup creates rooms.

`fleet setup` is noninteractive. It asks no naming, controller, workspace, model,
history or connection-mode questions. Optional explicit configuration supplies
overrides through the same validated configuration owner. Otherwise private,
persisted project-derived identifiers and defaults establish an ordinary fleet.
Repeated setup reuses the same controller, registration, identities and history.
Human enrollment approval remains a separate required authorization: print the
exact approval link/code and wait in code. Missing prerequisites/authentication,
ambiguous saved authority or an invalid configuration produce actionable errors,
not a prompt, guessed identity or silent fresh session.

Use a private user-scoped installation and controller root. Local setup/start
may start or reuse the selected controller; read-only commands never start it.
Remote operation continues through authenticated SSH and the same private API.
Controller startup cannot activate an explicitly stopped agent. No systemd,
public controller socket, sudo installation, global skills or silent upgrades.

Keep runtime adapters. Codex is the only implemented runtime. Remove superseded
Claude/Pi implementations, selectors, entrypoints and tests; unsupported runtime
values fail at boundaries. Do not leave placeholder adapters or disabled old
paths. Linux and macOS support use native portable ownership primitives; native
macOS/provider certification is reported only when actually performed.

All npm package names use the `@ctlflow` namespace. Public distribution is an
explicit allowlist: `@ctlflow/fleet` and `@ctlflow/fleetd`. All other products,
applications and internal modules remain `private: true`, including
`@ctlflow/crossfire` and `@ctlflow/workspace`. Internal names consistently use
`@ctlflow/<service>-<module>`. Publish self-contained runtime builds with exact
public dependency versions, declared executable exports and finite package-file
allowlists. Never publish internal packages or depend on registry copies of them.
No installation lifecycle script starts a controller or agent.

The setup guide supplies the dynamically verified server/owner and pinned npm
release. It describes installing missing prerequisites, new managed sessions,
native provider login, enrollment approval and a model-free readiness check.
There is one canonical installation/setup path, not HTTP-bootstrap versus npm
alternatives. Intentional agent tools remain capabilities behind shared ports;
removing standalone lifecycle does not remove reply, history, invitations,
directory, attachments, report publishing or debugging.

Preserve existing room admission/removal authority, cross-owner invitations,
private owner DMs, bounded large-message file delivery, unread positions,
telemetry, scheduled wake-ups, software consent, decisions, terminal pointers,
30-minute idle sleep and optional per-room histories. Fleet membership never
unions room permissions, credentials or histories.

## Scope and source ownership

| Workstream | Owning source | Required result |
| --- | --- | --- |
| Shared base and integration | Root workspace/build/verification, canonical specification and instructions | Atomic namespace conversion, dependency correctness, publish allowlist, one contract, integrated verification. |
| Fleet-only coordination | Crossfire domain/contracts/SQL/Crossfire coordination adapter and corresponding tests | Mandatory controller/fleet enrollment and active binding, no detach-to-independent operation, server-verified publication gates, truthful projections and forward migration. |
| Controller and CLI setup | Fleet/fleetd products and their tests/docs | Zero-question setup, private defaults, optional config, idempotent controller startup, stable registrations, owned workspace/state and installed public packages. |
| Shared runtime simplification | Crossfire listener/agent core, runtime/filesystem/Codex integration and corresponding tests | One managed runtime path, adapter abstraction, no standalone listener launch or Claude/Pi implementation, portable native ownership and retained receipts. |
| Management UI | Crossfire web application and browser tests | One setup page, no Direct labels/optional fleets, consistent tables, consolidated details and controller-owned controls. |
| Onboarding/tools and consumers | Crossfire client/server onboarding/assets/skills and affected deployment/fleet documentation | npm guide, intentional tools without standalone lifecycle, aligned release metadata/configuration and no misleading current-session connection instructions. |

The coordinator owns the immediately blocking shared base and contract, then
onboarding/client integration and the final actual diff review. Independent
implementation streams use separate Git worktrees and full-context forks. A
worker cannot edit another worker's ownership without an explicit coordinated
handoff. Workers do not publish, deploy, push or activate fleets.

## Management information architecture

- Keep Agents and Fleets as separate useful indexes. Agents always show a fleet
  and controller; there is no independent deployment column/value.
- One Connect/Setup page handles one or many agents. Remove the One agent/Fleet
  advanced split. Show the minimal paste instruction and a concise progress
  explanation. TOML and manual CLI documentation are advanced disclosure, not
  another runtime path.
- Fleet landing shows the agents table immediately. Organize durable URL views
  as Agents, Map, Activity and Settings. Group native lifecycle with agent
  controls; group broadcasts, delivery evidence and statistics within Activity.
  Preserve the dense connection map and ordinary permission boundaries.
- Agent details use Rooms, Session, Activity and Settings. Session owns native
  parameters, terminal pointers and pending decisions. Settings owns current and
  latest software plus configuration. Room access and wake eligibility remain
  clearly distinguished, without redundant status tables or repeated controls.
- Consolidate navigation and reusable presentations in shared components. Keep
  current management colors, paper hierarchy, clear section boundaries, tables,
  responsive layouts and useful empty states; no card nesting or slogans.
- Stop, Resume, Pause delivery and confirmed Fresh history are distinct. Views
  show controller connectivity, native lifecycle and delivery honestly, without
  claiming a successful operation before its receipt. Authorization is enforced
  by the domain/API as well as hiding unavailable controls.

## Sequenced plan

1. **Completed — Lock contracts and shared base.** Verify latest merged source
   and clean trees, inventory affected consumers and data, write this plan/ledger,
   establish a feature branch, convert all npm names consistently, update the
   standing instructions, and prove bounded build/test process groups before
   creating full-context workers.
2. **Completed — Implement the universal controller model.** Complete fleet-only
   coordination, noninteractive setup/distribution and managed runtime ownership
   in disjoint worktrees. Preserve existing identities/history and remove the
   superseded implementation rather than layering a bridge around it.
3. **Completed — Complete UI and consumer replacement.** Integrate simplified
   management, npm onboarding, intentional client tools, CLI examples, skills,
   release artifacts and all affected owned configuration/documentation.
4. **Completed — Integrate and audit actual changes.** Review every worker diff,
   integrate into the feature branch, correct ownership/security/invariant gaps,
   and prove the removed routes/payloads/runtime values cannot still execute.
5. **Completed — Verify the complete installed product.** Run the full bounded
   typecheck/build/test/architecture/installation sequence, native Codex lifecycle
   and real browser checks, clean-directory public-package installation and
   read-only production-state inventory. Publish only verified public artifacts
   if authorized registry credentials permit; otherwise report the exact external
   dependency without claiming publication. No production deployment or fleet
   activation is authorized by this task.

Implementation, integration, installed-package verification and read-only
production preservation are complete. Registry publication is explicitly
deferred: `npm whoami` returned E401 Unauthorized. No package was published and
no production deployment, activation or migration occurred. Native Linux
Codex/inert-provider evidence does not certify macOS or paid providers. Stock
Codex's surviving writer after fleetd-only SIGKILL remains a demonstrated native
limitation, not an implemented automatic-recovery guarantee. The complete final
record is [the verification report](../verification/20261005-universal-fleet-controller.md).

## Verification and safety gates

- Every delegated build/test, including pure focused tests, runs inside a
  verified finite cgroup v2 process-group scope. Verified local starting bound:
  MemoryMax=4294967296, MemorySwapMax=0, TasksMax=512. Larger integrated runs may
  use explicitly finite operator-sized bounds, not an unbounded Codex group.
- Full-context forks inherit the parent history, this plan, repository policy
  and their exact write scope. Each uses its own worktree. The coordinator owns
  merge quality; isolated worker reports are not final certification.
- Run independent test files on available cores, build shared assets once,
  controlled clocks for timing and bounded observations for native I/O. No
  unconditional sleeps or reduced assertions. Runtime verification is Codex only.
- Validate complete boundaries, SQL indexes and rollback. Keep native operations
  outside transactions. Domain code imports pure ports, not transport/storage/UI.
- Database conversion is a forward migration with backup/inventory prerequisites,
  never a reset or a second operational schema. Existing independently connected
  identities are not converted into invented live controllers. Preserve archived
  identity/audit state; require explicit valid controller enrollment before an
  agent can run. No migration may silently grant room/controller authority.
- Installed-package tests run outside monorepo resolution and prove no registry
  internal dependency, source reach-through, secrets, tests, ignored analysis or
  workspace symlink is necessary. Verify pack manifests and exact public names.
- Native inert-provider checks prove first enrollment, ready-without-room,
  no-model setup, duplicate setup reuse, controller recovery, pause/stop/resume,
  sleep/wake, retained history and explicit fresh reset. They do not certify paid
  providers or macOS hardware.
- Browser checks cover ordinary/admin navigation, minimal setup, consistent
  tables/tabs, actual permission/lifecycle actions, pending approval, software
  versions, responsive sizing and legacy-route rejection.
- Preserve source shared with other sessions and all production credentials/data.
  Do not force push, reset, clean, stash, create PRs automatically or push main.

## Work records

The detailed current necessity and verification record is
`.analysis/20261005-universal-fleet-controller/necessity-ledger.md`.
Maintain `.analysis/MEMORY.md` and the canonical handover ledger throughout.
Each phase closes only when its required work is done; no intermediate worker
completion or exhausted checkpoint constitutes completion of the task.
