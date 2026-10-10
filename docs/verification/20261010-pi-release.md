# Pi release and preserving GAAP deployment — 10 October 2026

## Scope

Pi implementation PR49 is merged at `aa10d02`; its tree matches verified feature
checkpoint `b98bc3e`. Coordinated release work uses `release/pi-runtime-0.1.20`.
Only `@ctlflow/fleetd` and `@ctlflow/fleet` are public. Crossfire and every internal
workspace remain private. Bad Bets is excluded. GAAP's deployment and agent
definition repositories require no source changes for this runtime release.

Existing GAAP agents retain Codex, configured parameters, identities, exact native
histories, provider files, room access and deliberately stopped selections. This
release does not switch them to Pi, install Pi globally, create a business task,
answer a native question or reset production data.

## Release verification

| Check | Result |
| --- | --- |
| Coordinated metadata | All 28 owned manifest/lock/privacy records agree on 0.1.20. |
| External dependencies | All 97 records unchanged from merged main. |
| Typecheck and build | Pass on current source. |
| Full product tests | 826 tests, 180 files, 24 workers; zero failures; 86,754 ms execution. |
| Architecture | 33 checks pass. |
| Installation | Four checks pass, including actual public package installation. |
| Container acceptance | Pass; `crossfire-runtime:824d28619c98432b13d0`, evidence `container-verification-Jkn3N5`. |
| Aggregate resources | 24 GiB memory, zero swap, 8,192 tasks; Docker descendants share the verified finite slice. |
| Public archives | Fleetd: 466,787 bytes/14 files. Fleet: 70,229 bytes/12 files. Approved executables, assets, guides and proprietary licenses only. |

The full run includes the supported Codex and stock-Pi inert-provider suites,
real browser checks and native/container integrations. The prior independent
stock-Pi 1.0.0 live-provider proof passes all eleven checks twice with 18 measured
responses per run; see `20261010-pi-runtime.md`. It is Linux and selected-provider
evidence, not universal provider, macOS, sandbox or arbitrary tool-crash certification.

Predeployment review finds an operator-only omission: the preservation verifier
does not admit deployed schema15, although the sole schema owner implements
15-to16. A genuine schema15 regression fails before correction, then passes with
exact usage retention, unchanged evidence bytes and rejection of modified
protected records. The verifier now uses the same existing in-memory migration
for the explicitly supported source schema. No production database or alternative
schema reader is modified by inspection. The installed-package Pi fixture now
uses its actual installed version rather than an unrelated literal.

The first release run records three failures because the operator's umask077
made deliberately public security-test files private. The complete successful
rerun uses normal022 only in disposable verification, without weakening any
assertion. Deployment credentials and evidence remain private. The failed run
and red migration regression are retained.

## Predeployment preservation

Read-only production inventory: schema15, 63 relations, 53 accounts/credentials
and 76 room grants. Turbine's agreements fleet retains 42 instances, 29 enabled
sleeping receivers, 13 deliberate stops and revision11. The server also contains
another independently controlled fleet; its data and controller are preserved,
not commandeered or automatically upgraded.

A private serialized production snapshot rehearses the actual schema15-to16
migration. All 40 protected domain relations, 18 usage checkpoints and 1,299
usage intervals survive unchanged; integrity and foreign keys pass; original
snapshot bytes remain identical. Production is not modified by this rehearsal.

## Publication and deployment

Current source and artifacts are release-ready. Registry publication, verified
fresh backups, GAAP activation, controller/artifact upgrade and production
acceptance are still pending; this checkpoint is not a deployment claim.

Private evidence: `.temp/pi-release20/`. Full verification summary:
`.temp/test-runs/2026-10-10T15-43-58.072Z-2328186/summary.json`.
