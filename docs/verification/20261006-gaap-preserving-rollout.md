# Preserving GAAP rollout verification

## Scope and disposition

The rollout retains production data, all 22 Agreements identities and names,
room access, credentials and native histories. The explicitly stopped fleet
must remain stopped. Deployment does not authorize resume, reset or model work.

This correction starts from merged Crossfire main `2707443`. GAAP main
`759ad2d` and Agreements main `9d57e5d` remain untouched. The branch is
`fix/gaap-preserving-rollout`.

The authorized private npm credential successfully publishes both public 0.1.0
products, verified by anonymous registry download and independent installation.
Crossfire and all internal modules remain explicitly private. The canonical GAAP
website upgrade and forward schema migration succeed. Actual controller software
replacement exposes an installer defect; the corrected coordinated release is
0.1.1. Its remaining publication and preserving activation are not yet complete.
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
| Actual container | `crossfire-runtime:918bfeb538413563a018`; Element, management, authenticated attachment download, shutdown and second-start persisted rooms pass. |
| Production migration rehearsal | A consistent readonly schema-12 snapshot advances to schema 13 only in a local copy; all 63 tables, integrity and foreign keys pass. Original snapshots and production are unchanged. |

The rehearsal separately compares unchanged identity, credential, room grant,
owner/management conversation, policy, fleet binding, publication and audit
fields across 19 relations. The canonical migration archives four historical
enrollment requests rather than inventing live controllers. This is rehearsal
evidence, not a deployed migration or a full native-history content comparison.

The full suite and actual Docker descendants use verified finite cgroups:
16 GiB memory, zero swap and 4096 tasks. Focused probes use 8 GiB, zero swap and
1024 tasks. Linux stock Codex tests use inert providers; paid-provider and macOS
execution are not certified. Earlier failing runs remain in private evidence.

## Preserved production state and rollout

Read-only Turbine inspection confirms controller `turbine-gaap` connected,
delivery disabled, all 22 agents stopped and no active listeners. Existing
account/history/provider fingerprints are retained. The first website upgrade
uses a freshly verified quiescent full backup and canonical forward schema-13
migration. Turbine's orderly controller replacement follows a verified full
controller/fleet/native-provider archive. The controller runs the public package
with all desired agent bindings stopped and delivery disabled. The original
failed update outcome is retained; it is not represented as a completed update.

After final corrected gates, publish only the two exact 0.1.1 public artifacts,
daemon first. Complete canonical preserving website deployment and the explicit
controller/software update without starting native agents. Then verify actual
release/package provenance, database and history preservation, stopped intent
and important browser flows. Package packing is not publication; disposable
container verification is not production deployment.

Private evidence is under `.analysis/20261006-gaap-preserving-rollout/` and
`.temp/test-runs/2026-10-06T00-48-29.605Z-3243513/`.
