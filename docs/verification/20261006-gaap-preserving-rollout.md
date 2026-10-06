# Preserving GAAP rollout verification

## Scope and disposition

The rollout retains production data, all 22 Agreements identities and names,
room access, credentials and native histories. The explicitly stopped fleet
must remain stopped. Deployment does not authorize resume, reset or model work.

This correction starts from merged Crossfire main `2707443`. GAAP main
`759ad2d` and Agreements main `9d57e5d` remain untouched. The branch is
`fix/gaap-preserving-rollout`.

Publication and preserving deployment are complete. The authorized private npm
credential publishes `@ctlflow/fleetd@0.1.1` and `@ctlflow/fleet@0.1.1`, verified
by anonymous registry download, exact archive integrity and independent
installation. Crossfire and all internal modules remain explicitly private;
none is published. Already-published 0.1.0 artifacts remain immutable.

The canonical GAAP website upgrade, forward schema migration, public-package
controller replacement and all 22 explicit agent software updates succeed.
A normal controller restart retains stopped intent and saved histories.
There is no alternate installer or runtime path.

## Final-review corrections

- Activity admission previously performed five authority lookups per listener.
  One indexed SQLite/Tinqer projection now supplies batch admission facts; the
  domain uses the same pure predicate for batch reads and single-run mutations.
  Owner status, instance/fleet binding, delivery intent, exact connection and
  credential generation, expiry, revocation and retirement remain enforced.
  Complete domain activity uses two SELECTs at page sizes 1, 20 and 100.
- Retained management views previously held stale field/revision snapshots.
  Shared versioned editable state now refreshes pristine input, preserves dirty
  input with its original revision/generation, blocks conflicting saves and
  offers explicit discard/reload. It covers room access/delegation, chat wake
  policy, agent/fleet naming, scheduled Wake-ups and instance policy. Instant
  account actions use the displayed revision, not a retained naming draft.
- Explicit software replacement previously validated obsolete installed metadata
  as a current release. The selected immutable new package owns update authority;
  previous managed-path safety and bounded skill comparison remain. Recovery
  still rejects unsupported software. A regression proves preparation does not
  activate, explicit activation validates the current release, and unrelated
  identity/history/cursor bytes remain unchanged.
- The generic browser verifier captures the actual native login response before
  delivering it unchanged to the UI. This removes a response-body lifetime race
  across full navigation and retains the credential for cleanup. It does not
  stub authentication, follow redirects, disable TLS verification or add sleeps.
- All 27 workspace manifests advance to 0.1.1. Three obsolete npm-extraneous
  workspace lock entries are removed; the ownership gate rejects removed modules,
  missing/alternate links, stale versions and divergent dependency metadata.
  The 97 external registry dependency records remain unchanged.

The specification owns these contracts. No authorization, server concurrency
check, quality gate or native lifecycle guarantee is weakened.

## Verification

| Gate | Observed result |
| --- | --- |
| Strict typecheck and build | Pass. |
| Complete tests | Final 0.1.1 run: 635 pass, zero failures/cancellations, 148 files, 24 workers; 2.335 seconds preparation and 50.766 seconds execution. |
| Structure and architecture | Structure gate and all 33 architecture checks pass. |
| Installation | All four checks pass, including clean external-prefix public-package installation. |
| Actual browser regressions | Real Conduit, SQLite, REST and Chromium reproduce independent writers; pristine refresh, retained dirty drafts, explicit conflict review and current-revision saves pass. |
| Actual container | Final `crossfire-runtime:50370b448e4ee19d2f9b`; Element, management, exact authenticated attachment bytes, shutdown and second-start persisted rooms pass. |
| Production migration rehearsal | A consistent readonly schema-12 snapshot advances to schema 13 only in a local copy; all 63 tables, integrity and foreign keys pass. Original snapshots and production are unchanged. |
| Public npm installation | Both exact 0.1.1 registry archives match their prepared SHA-512 digests; a fresh independent prefix installs only the two public packages and runs the CLI outside the monorepo. |
| Actual production release and APIs | Live immutable release and both management assets match the selected build. Normal login, complete 22-agent roster, native invitation directory and fleet-map reads pass without model calls. |
| Actual production browser | Forty desktop/mobile management views pass, including normal native login, retained route navigation, tables, software/session views, map URL/keyboard behavior and personalized onboarding. |
| Actual public site | Branded Element welcome and native sign-in forms pass at desktop/mobile widths without page errors or overflow. The content host rejects all four application endpoint probes with 404 and no cookies. |
| Actual production database | A final native SQLite backup has schema 13, all 63 tables, valid integrity/foreign keys and exact required counts. Strict comparison with the canonically migrated original snapshot preserves all 37 protected relations and all 104 original audit records. |
| Actual Docker host | Exact selected image and all three provenance labels match. Healthy rootless Docker retains its readonly filesystem, dropped capabilities, no-new-privileges and only loopback ports 4012/4020. |
| Actual Turbine controller | Connected, delivery disabled, all 22 instances stopped, no active listeners or desired activation. Generic preservation retains every original account/context/session binding and provider-file fingerprint after a normal public-package restart. |

The rehearsal separately compares unchanged identity, credential, room grant,
owner/management conversation, policy, fleet binding, publication and audit
fields across 19 relations. The canonical migration archives four historical
enrollment requests rather than inventing live controllers. The subsequent
production upgrade applies that forward migration, and the final strict
37-relation comparison passes without suppressing fields or altering snapshots.
Native-history bindings and files are preserved; this does not claim a semantic
review of every native conversation.

The full suite and actual Docker descendants use verified finite cgroups:
16 GiB memory, zero swap and 4096 tasks. Focused probes use 8 GiB, zero swap and
1024 tasks. Linux stock Codex tests use inert providers; paid-provider and macOS
execution are not certified. Earlier failing runs remain in private evidence.

## Preserved production state and rollout

The deployed runtime source is Crossfire
`fe40848bae5b3ee71597d421046e1dd16aad8113`, with GAAP's canonical resource-bound
deployment scripts at `bfa6295` and unchanged Agreements definitions at `9d57e5d`.
The production image is `gaap-runtime:968de44b4933237008c2`; the immutable
listener release is `0.1.1-1bb0435202babe9bda37e291`. This report's subsequent
documentation-only commit is not a different deployed runtime build.

The final website activation takes and verifies the quiescent full backup
`/home/gaapuser/gaap/backups/20261006T021619Z-968de44b4933.tar.gz` before data
changes. Independent checksum, gzip and tar-list checks pass afterward.
Turbine's fresh stopped controller/fleet/native-provider archive also passes
all three checks. Its SHA-256 is
`f376ba759960e958a9f4686d4ba291dcd902e9559cf1f321feac65614efc777f`.

Both public products install into Turbine's private 0.1.1 prefix. Explicit
`fleet update agreements` updates all 22 immutable agent software installations;
their current manifests and artifact hashes match the deployed listener release.
The ordinary `fleet daemon restart` then retains every original native binding,
stopped intent and disabled delivery. Stable executable links point to those
installed public binaries, not monorepo source. The original failed 0.1.0 update
outcome remains recorded, separately from the successful corrected update.

Final production database counts retain 22 agents/names/credentials, 23 room
grants, five room permissions, nine owner conversations, one management
conversation, one fleet with 22 instances and two publication records with 12
files. Both existing publication records were already deleted; deployment does
not republish them or create a replacement report. Consequently an existing
public-report browser isolation probe is not claimed for this rollout. The
current release's disposable native container checks remain separate evidence.

At the final postdeployment Turbine observation, the controller is connected,
delivery is disabled and all 22 native agents remain deliberately stopped.
No assignment, start, resume, native reset, production reset or paid model call
is performed. The remote fleet's untracked operator exclusions are preserved.
The authorized npm key is never printed, copied to servers or persisted in
repository/global npm configuration; temporary private npm configuration is
removed.

Private evidence is under `.analysis/20261006-gaap-preserving-rollout/`, with
final suite timings under
`.temp/test-runs/2026-10-06T01-59-36.915Z-3486654/`.

## Known independent advisories

Native npm audit reports two preexisting external dependency advisories:
moderate TOML parser complexity in `smol-toml` and high indexed-source-map
denial of service in `source-map-js`. The 97 external lock records are unchanged;
this rollout neither performs an unrelated dependency update nor claims an
advisory-free dependency tree. Passing product correctness, architecture and
isolation checks do not dismiss those advisories. Private audit evidence records
their exact ranges and suggested fixes for a separately scoped dependency update.
