# High-first Agreements rollout verification

## Scope and disposition

The authorized rollout adds a High-first coordinator and one substantive High
worker per role, retains the Max cohort, promotes Luna OCR to High, and applies
the uniform public `<base>-<tier>` naming rule. There are 28 instances, seven
roles, 14 role/tier definitions and 21 shared skills. Contact `bea-high` for
High-first coordination; `bea-max`, `nell-max` and `gus-max` remain Max-first.
Every lead uses Sol/high. Substantive workers use Sol/high or Sol/max; OCR uses
Luna/high or Sol/max. There are no Low, Medium, Reserve or Astra definitions.

Deployment is complete. All 28 accounts are enrolled, named and discoverable,
and their immutable listener software is updated. The controller is connected.
Delivery remains disabled and every instance remains deliberately stopped,
without desired activation, an active listener or a runtime error. Starting,
resuming, resetting, assigning work and invoking paid models are not authorized
by this rollout and are not performed.

The work starts from merged Crossfire main `d29e50b` and Agreements main
`9d57e5d`. Runtime source `e102d18cd79aa036a1a2b32f3feb460aefccea19` and
Agreements definitions `99befa38b831a7a000f6edf6c44031121a30e962` are deployed.
GAAP branding/deployment main `af1f133` is unchanged. This report's later
documentation-only checkpoint is not a different deployed runtime build.

## Ownership and architecture

- Crossfire owns registered names and normal owner-reviewed enrollment. Existing
  native account/controller proofs remain required. The owner reserves and
  approves the exact replacement name; the same transaction replaces its unique
  claim, increments the principal revision and records the old/new names. Name
  changes never silently approve themselves or consume another identity slot.
- The single enrollment path supports both existing-account renames and six new
  workers. REST requests, responses, management review, native reconciliation,
  operator review and tests use the same contract. There is no second rename
  endpoint, account replacement, old-name alias or authorization bypass.
- Native reconciliation updates existing automatically named protected owner
  DMs while retaining their room IDs and human-customized titles. It creates no
  new chat. Native operations remain outside database transactions; the owning
  revisions are checked again when committing reconciliation evidence.
- fleetd's canonical local profile/cursor/lock key is the immutable instance key,
  not its display name. An explicit identity-checked, exclusively locked and
  journaled forward migration handles an old display-name-keyed installation;
  there is no alternate runtime reader, overwrite or history merge. All original
  22 GAAP keys and workareas already remain at their stable locations.
- `fleet enroll FLEET` uses the same validated preparation and human approval
  path while the complete fleet is stopped. It never starts native sessions,
  resets history or enables delivery. Active/per-agent enrollment is refused.
- The agents repository owns role/tier settings, instructions and routing.
  Fourteen role bindings reuse seven complete role procedures and specialized
  skills from one project-local skill owner. High and Max have identical
  evidence, privacy, invitation and completion requirements. Escalation and
  independent challenge are specific bounded work, not duplicated full reviews.
- All 27 workspace manifests use 0.1.2 and `@ctlflow`. Only `@ctlflow/fleet` and
  `@ctlflow/fleetd` are public. Crossfire and every internal module stay private;
  public installation does not resolve monorepo source or publish internal code.

The specification and product guides own the operative contracts. This report
records evidence, not a second implementation or specification. Domain rules do
not import storage, native adapters, transport or UI. Tinqer owns data queries.
No authorization, concurrency, privacy, resource limit or quality gate is weakened.

## Observed verification

| Gate | Result |
| --- | --- |
| Strict typecheck and build | Pass. |
| Complete test suite | 645 tests, zero failures/cancellations, 150 isolated files, 24 workers; 2.326 seconds preparation and 63.023 seconds execution. |
| Final focused rename checks | All seven pass, including exact native/controller proof and rename without extra capacity. The final capacity case is added after the full-suite run and checked separately. |
| Structure and architecture | Structure gate and all 33 architecture checks pass. |
| Installation | All four installation checks pass. Both public 0.1.2 releases subsequently install independently from the anonymous registry; only the two public `@ctlflow` packages are installed. |
| Native browser/Matrix regressions | Owner rename approval/rejection, unrelated grant revisions during reenrollment, existing protected DM IDs and custom titles pass against real local native services. |
| Actual container | `crossfire-runtime:769bfca8b1572085f7af`; native Element room creation, exact authenticated attachment bytes, management/native routes, shutdown and second-start persisted rooms pass. |
| Fleet configuration | The unmodified secure loader accepts all 28 instances and 14 definitions; original 22 keys/workareas, model/effort, sandbox/approval, shared histories, wake and invitation policy checks pass. All Markdown links and 21 shared skills validate. |
| Production release/API | Exact immutable manifest, four artifacts and both management assets match the build. All 28 names/accounts, native invitation discovery and the fleet map pass through normal authenticated reads. |
| Production browser | Forty desktop/mobile management views pass after deployment, including native login, tables, session/software views, map keyboard/URL behavior and personalized onboarding. Branded Element welcome/sign-in also pass at both widths. |
| Production database | Schema 13, all 63 tables, integrity and foreign keys pass. All 37 protected relations retain prior records or their exact authorized name/revision/reconciliation-time changes; all 104 original audit records remain. |
| Actual Turbine state | All 28 software installations validate against the selected release. A normal controller restart retains all 22 original account/context/session/provider fingerprints and leaves every agent stopped; the controller reports connected and delivery disabled. |
| Docker host | Exact image/provenance, health, rootless Docker, readonly filesystem, dropped capabilities, no-new-privileges and loopback-only 4012/4020 bindings pass. |

Tests/builds and actual Docker descendants use finite process-group limits:
16 GiB memory, zero swap and 4096 tasks. Focused verification uses an 8 GiB
scope. Native test fixtures use Linux Codex with inert providers. Paid-model
analytical accuracy, prompt adherence and macOS execution are not certified.
Deployment validates stopped configuration, not future task outcomes.

Earlier failures are retained in private evidence. Corrected owners include
the duplicate browser dialog handler, an overbroad reenrollment readiness check
and a fixture's guessed adjacent port. Readiness checks applied native naming,
not an unrelated room-grant revision. The service fixture reserves independent
ephemeral listeners until startup. Parallelism and assertions are not reduced.

## Publication and preserving deployment

Both immutable public archives match anonymous-registry downloads and their
prepared SHA-512 integrity values. Turbine installs the exact 0.1.2 pair into its
private durable prefix; existing 0.1.1 files remain. The authorized npm key is
never printed, copied to servers or persisted in global configuration. The
seven-day third-party release policy remains active, with only the two named
owned-package exemptions already specified by the repository.

The website uses `gaap-runtime:88320af9a46dc0992ef3` and listener release
`0.1.2-9b60f836fd7c2ac4d279655b`. Canonical activation takes and verifies
`/home/gaapuser/gaap/backups/20261006T033022Z-88320af9a46d.tar.gz` before changing
the release. The complete stopped Turbine backup is
`/home/gaapuser/.local/state/ctlflow/rollouts/20261006-high-first-agreements/turbine-backup.tar.gz`.
Checksum, gzip and tar-list checks pass for both. No production data reset occurs.

Normal native Git bundles carry the exact published commits to Turbine without
changing its GitHub credentials/host trust or discarding shared work. Only
read-only operator dependencies are built there; the public runtime pair is
self-contained. Crossfire's actual SQLite native build runs in its verified
container, not a replacement adapter on Turbine. The existing untracked fleet
exclusion file is retained. Badbets and unrelated host services remain untouched.

The owner review independently matches the intended controller, code, all 22
original account IDs, requested names and all 28 coordination policies before
normal approval. Explicit `fleet update agreements` then updates all 28 pinned
software installations. After controller restart, connectivity is observed
separately from the immediate restart response; no fixed-delay readiness guess
or model invocation is used.

Final retained state has 28 agents/names/credentials/fleet bindings, 23 room
grants, five room permissions, nine protected owner conversations, one management
conversation and the two already-deleted publications with 12 files. Existing
automatic conversation titles follow the new names; custom titles and every
room ID remain. Exact authorized audit additions are 22 renames, six new policy
approvals, one enrollment approval and one controller configuration record.
Credential bytes remain unchanged; their native-reconciliation timestamps
advance within the successful application interval. No new rooms are created.

Private evidence is under `.analysis/20261006-reviewed-fleet-names/`. The
preexisting `smol-toml` and `source-map-js` audit advisories remain separately
recorded; this release does not claim an advisory-free dependency tree or make
an unrelated dependency update.

- [GAAP Element](https://gaap.lol/)
- [Agreements management](https://gaap.lol/manage/fleets/d065e75b-fb34-4953-aaf9-7f1e2a79d87f)
