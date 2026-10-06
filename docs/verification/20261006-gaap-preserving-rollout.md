# Preserving GAAP rollout verification

## Scope and disposition

The rollout retains production data, all 22 Agreements identities and names,
room access, credentials and native histories. The explicitly stopped fleet
must remain stopped. Deployment does not authorize resume, reset or model work.

This correction starts from merged Crossfire main `2707443`. GAAP main
`759ad2d` and Agreements main `9d57e5d` remain untouched. The branch is
`fix/gaap-preserving-rollout`.

Production activation is not complete. npm authentication returns E401 and
both required `@ctlflow/fleet@0.1.0` and `@ctlflow/fleetd@0.1.0` are unavailable.
The matching npm setup descriptor must not deploy before both verified public
packages are published. There is no alternate installer or runtime path.

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

The specification owns these contracts. No authorization, server concurrency
check, quality gate or native lifecycle guarantee is weakened.

## Verification

| Gate | Observed result |
| --- | --- |
| Strict typecheck and build | Pass. |
| Complete tests | 633 pass, zero failures/cancellations, 148 files, 24 workers; 1.538 seconds preparation and 58.417 seconds execution. |
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

## Preserved production state and remaining work

Read-only Turbine inspection confirms controller `turbine-gaap` connected,
delivery disabled, all 22 agents stopped and no active listeners. Existing
account/history/provider fingerprints are retained. The current website and
controller software remain unchanged; no fleet start or production reset occurs.
An existing quiescent website archive passes checksum, gzip and tar validation.
A fresh quiescent deployment backup is still required before activation.

After authorized npm authentication is available, publish only the two exact
public artifacts, daemon first. Then use the canonical GAAP preserving deploy,
forward migration and backed-up controller-only upgrade. Finally verify live
release/package provenance, database and history preservation, stopped intent
and important browser flows. Do not treat package packing as publication or
the passing disposable container as a production deployment.

Private evidence is under `.analysis/20261006-gaap-preserving-rollout/` and
`.temp/test-runs/2026-10-06T00-48-29.605Z-3243513/`.
