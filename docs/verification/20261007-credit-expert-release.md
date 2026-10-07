# Credit-expert release: 7 October 2026

## Ownership and release scope

Release 0.1.12 deploys the merged interrupted-work AGENTS.md reminder and
first-party proprietary licensing. The version changes atomically across the
root, 27 workspaces, owned dependency edges and lockfile. Third-party dependency
entries are unchanged. Only @ctlflow/fleet and @ctlflow/fleetd are public;
Crossfire and all internal packages remain private and bundled as appropriate.
The runtime image also includes its root LICENSE; license bytes participate in
the operator's immutable image fingerprint. Native container verification checks
the exact shipped text, rather than inferring it from source/package metadata.

GAAP's domain-expert procedures and progressive reference library belong in its
agents repository, not Crossfire. No runtime, Matrix, storage, permission or UI
alternative is introduced here. The existing Fleet update/controller restart,
native resume and operator verification interfaces remain the only owners.

## Preservation requirements

Activation requires verified private website/controller/fleet backups. Preserve
all existing Matrix identities, native histories, provider account bindings,
room grants, wake rules, publication data and deliberately stopped instances.
Never reset production or re-enroll an unchanged roster. The dirty original
GAAP website checkout and every Bad Bets checkout remain untouched.

## Verification boundaries

Use the canonical bounded Codex-only tests, architecture, installation,
container and audit gates. Operator release/database/host checks and actual
desktop/mobile browser inspection run after deployment. Fleetd's native
read-only inspector verifies histories, configured models and skill discovery;
instruction inventory does not substitute for that native evidence.

No new production model assignment or paid-provider quality test is performed.
An instruction audit is not proof of legal correctness, OCR accuracy or a
model's future adherence.

## Local verification

- Typecheck/build, service ownership, version/privacy and timing guards pass.
  All 97 external npm dependency lock entries remain unchanged.
- The final Codex-only run passes 724 tests across 161 files with 24 workers,
  zero failures/cancellations and 74.703 seconds of test execution. An earlier
  browser protocol attachment failure is recorded; the affected browser check
  and a fresh complete run subsequently pass without changed assertions.
- All 33 architecture proofs, four installation proofs and npm audit pass;
  audit reports zero vulnerabilities. Builds/tests use verified process-group
  limits; Docker verification also uses its verified private resource slice.
- Actual runtime-container checks pass startup, Element room creation and
  authenticated attachment download, native sandbox/authentication boundaries,
  management/artifact routes, shutdown and persisted-room restart. The final
  image also passes the exact shipped root-license check.
- Only `@ctlflow/fleet@0.1.12` and `@ctlflow/fleetd@0.1.12` are published. Their
  registry integrities equal the reviewed archives, and Fleet installs Fleetd
  through its exact `0.1.12` dependency. Internal packages remain private.

## Deployed release

The existing GAAP launcher deploys the clean website main worktree at
`2821cf819b284978798691c45f23856abc9dc015` with Crossfire runtime revision
`9644d9078aee2baed4a116d045d7b269be267f6d`.

| Item | Verified value |
| --- | --- |
| GAAP image | `gaap-runtime:9b7b89077097f14abffd` |
| Crossfire base image | `crossfire-runtime:025ab2583829d25ed363` |
| Listener/client release | `0.1.12-e5114bff207777213450dbee` |
| Schema | 14, unchanged |
| Accounts / instances / exact retained histories | 28 / 28 / 28 |
| Enabled listeners / deliberate stops | 15 / 13, original selection retained |
| Preserved domain relation groups | 37 |

The final verified quiescent website backup is
`/home/gaapuser/gaap/backups/20261007T104557Z-9b7b89077097.tar.gz`.
The verified quiescent controller backup is
`/home/gaapuser/.local/state/ctlflow/rollouts/20261007-credit-experts/controller-before.tar.gz`;
it includes controller state, the complete fleet repository/private workareas
and the owner account material. Neither backup is restored over live data.

The normal Fleet update succeeds for all 28 installations, followed by daemon
restart and exact saved-selection verification. Managed client pointers,
manifests and artifact bytes match the release even for deliberately stopped
instances. Read-only native inspection verifies authentication, configured
model/effort and all 22 current project skills for the 15 enabled instances;
all 28 account/history identities and provider-file fingerprints are retained.
No roster re-enrollment, room assignment, new task or history reset occurs.

## Postdeployment evidence

- Public and management HTTPS respond successfully. The real browser verifies
  login and 44 management route/viewport views, including two wake-picker
  viewports and Back/Cancel navigation without policy writes. Representative
  desktop/mobile screenshots are inspected. Native invite-directory discovery,
  permission-scoped REST, fleet maps and exact published web/release bytes pass.
- Rootless Docker verifies the exact image/provenance, healthy state, readonly
  filesystem, no privilege, dropped capabilities, no-new-privileges and only
  loopback ports 4012/4020. `/app/LICENSE` equals the root source license.
  The canonical host check uses a temporary private SSH Unix-socket forward;
  no remote Node installation or host configuration change is required.
- Consistent SQLite backup snapshots pass integrity/foreign-key checks and the
  strict 37-group preservation comparison. Existing room grants, selected wake
  senders and two stored publications with their 12 files remain unchanged.
- The content host has valid HTTPS and exposes no management, Matrix, config
  or onboarding endpoints. No report is currently published, so a live report's
  browser isolation check is not claimed and no report is created for testing.
  Application isolation remains covered by the local regression gates.

Private logs/snapshots/screenshots are under `.temp/credit-expert-release` and
the corresponding private controller rollout directory. They are not committed.
Deployment readiness probes made during replacement initially saw a disconnected
controller and an HTTP deadline; after activation, the canonical delivery/native
checks pass with no controller/instance errors. No timeout or gate is weakened.
Verification-document follow-ups do not change the deployed runtime/instructions.
