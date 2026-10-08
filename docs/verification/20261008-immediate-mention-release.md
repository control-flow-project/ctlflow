# Immediate mention steering release: 8 October 2026

## Release and scope

PR45 is merged. Crossfire main `0c7c358` has the same product tree as the
fully verified feature commit `bc6ff505a819f60164eae8d8953d29ab1810064a`.
The deployed release source is
`013d3361b1fbddcca9a22d70ad4c216e7ea808f4` on
`release/0.1.13-immediate-mention-steering`.

Release metadata changes 27 first-party package manifests and their lockfile
to `0.1.13`. All 97 external dependency records and the dependency graph remain
unchanged. Only `@ctlflow/fleet` and `@ctlflow/fleetd` are published; Crossfire,
the repository root and every other workspace remain private. Actual registry
manifests and complete tarball bytes match the reviewed archives. Ordinary pinned
npm installation resolves exactly the two public packages, without a private
dependency or another installer.

The owner's deployment instruction is persisted in `AGENTS.md`: finish the
authorized in-scope release, activation and verification without asking for
another routine confirmation. Existing scope, source, privacy, preservation and
quality gates still apply. No main push or automatic PR creation is authorized.

GAAP's existing clean website main worktree at
`2821cf819b284978798691c45f23856abc9dc015` supplies its sole deployment launcher.
The dirty original website checkout, GAAP agent definitions and all Bad Bets
repositories remain untouched. No production reset, re-enrollment, permission
change, room assignment, unsolicited model task or stopped-agent activation
occurs.

## Deployed components

| Component | Verified value |
| --- | --- |
| Public Fleet and Fleetd | `0.1.13` |
| Listener/client release | `0.1.13-28090d65c52d818078e528a4` |
| Crossfire base image | `crossfire-runtime:eb6c3e6a169089a7950f` |
| GAAP image | `gaap-runtime:73e6061fedb018e7b85a` |
| Crossfire database schema | 14, unchanged |
| Agent accounts / retained native contexts / provider-file fingerprints | 42 / 42 / 42 |
| Enabled, sleeping listeners / deliberate stops | 29 / 13, unchanged selection |

Both per-user Fleet and Fleetd entrypoints on Turbine point to the same exact
public `0.1.13` installation. The normal fleet update succeeds for all 42 agent
installations, followed by daemon restart with saved intent. Every managed
client pointer and all 210 private release artifacts match the selected release,
including the deliberately stopped instances. The 29 enabled listeners are
connected and ready to resume native work when eligible messages arrive; this
does not mean 29 native model processes are running continuously.

## Verified backups and preservation

Before activation, the stopped controller's complete state, fleet repository,
private workareas, native histories and provider/configuration material are
backed up to
`/home/gaapuser/.local/state/ctlflow/rollouts/20261008-immediate-mention/controller-fleet-before.tar.gz`.
The archive contains 41,078 entries and 2,354,580,235 bytes.

The canonical website launcher quiesces and backs up its actual data before
activation to
`/home/gaapuser/gaap/backups/20261008T043425Z-73e6061fedb0.tar.gz`.
That archive contains 634 entries and 668,227,923 bytes. Both archives pass exact
checksum, readable gzip/tar and safe relative-member checks. Neither is restored
over live data.

Consistent SQLite backup snapshots pass integrity and foreign-key checks. Strict
preservation across website activation passes all 37 protected relation groups.
Final controller inspection retains all 42 account identities, exact context/
session bindings and provider-file fingerprints. Existing grants, wake senders,
stored publications and their 12 files remain unchanged.

The strict comparison across the entire controller update reports a conflict in
`fleet_native_stop`; that result is retained, not suppressed or called a pass.
Read-only review using the unchanged canonical protected-record selectors proves
that all other 36 relation groups retain their exact existing records. All 47
native-stop records remain. Exactly one record changes only `invalidated_at`,
from null to `2026-10-08T04:37:41.677Z`, for an already-enabled agent during the
successful authorized update at `04:37:24.840Z`–`04:38:27.326Z`. Its matching
non-sleeping native observation is verified. The observation owner intentionally
invalidates an old stopped-process proof when native execution reopens; retaining
that proof as current would be incorrect. No snapshots, protected-record reader
or preservation gate are modified to accept this lifecycle transition.

## Verification

- The unchanged feature passes root typecheck/build, 742 tests across 164 files
  with 24 workers, 33 architecture proofs and four installation proofs. The test
  run has zero failures/cancellations and 66.288 seconds of test execution.
- Coordinated release metadata passes focused ownership/privacy/package checks,
  typecheck/build, four installation proofs, both actual public-package installed
  product proofs and npm audit with zero vulnerabilities. It does not cause a
  redundant full model-test cycle.
- Actual resource-bounded runtime-container checks pass startup, Element room
  creation, authenticated attachment download, management/artifact routes,
  shutdown and persisted-room restart. Build/test groups use verified 24 GiB,
  zero-swap and 4096-task limits; Docker checks also use the verified private slice.
- The real public server verifies exact roster/native invitation discovery,
  permission-scoped reads, fleet maps and the selected release. Final inspection
  finds exactly one current-release run for each of the 29 online listeners and
  13 offline, deliberately stopped agents. Controller/native preservation is
  independently reconfirmed after activation.
- Actual browser checks pass 44 desktop/mobile management views and two
  wake-picker viewports, including Back/Cancel navigation without policy writes.
  Representative desktop/mobile screenshots are inspected. Published onboarding
  artifacts and both management assets match the local release byte for byte.
- Rootless Docker verifies exact image/provenance, healthy state, readonly
  filesystem, no privilege, dropped capabilities, no-new-privileges and only
  loopback ports 4012/4020. HTTPS application/management and the isolated content
  host respond as expected. No report is currently published; content-root 404
  is intentional, and no real published-report browser proof is claimed.

The immediate-steering implementation is tested with 86 bindings while all
ordinary acquisition/publication permits are occupied, without advancing a
controlled clock. Accepted human and agent mentions share the same authority
checks and exact turn/history ownership. Queued acknowledgments, cancellation,
recovery and durable attributed owner-DM stages are verified. Stock Codex
`0.161.0` with an inert provider covers human/agent and shared/per-room cases.
This is not paid-provider certification or a promise of zero network/native
cold-start latency. Postdeployment inspections invoke no model, native answer
or new assignment.

Private archives, snapshots, reports and screenshots remain under
`.temp/immediate-mention-release` and the private Turbine rollout directory.
The strict full-rollout conflict and the separate lifecycle-delta review are
both retained. Documentation-only follow-ups do not change deployed product
bytes and do not require another activation.

## Handoff

- [GAAP](https://gaap.lol/)
- [Management](https://gaap.lol/manage/)
- [Content host](https://content.gaap.lol/)
- [Create the release PR manually](https://github.com/control-flow-project/crossfire/pull/new/release/0.1.13-immediate-mention-steering)
