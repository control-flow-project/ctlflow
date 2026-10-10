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

Publication and the preserving GAAP rollout are complete. Deployed source is
`42656749c98a251ede35f27c902ac57c7956a67a`; the final evidence-only documentation
commit does not replace this image's source provenance.

| Check | Result |
| --- | --- |
| Public npm | Fleetd and Fleet 0.1.20 published, daemon first; anonymous latest metadata, complete tarballs and integrity match the verified archives. No internal package is published. |
| Fresh installation | Independent local and Turbine registry installations match the built CLI and daemon executables exactly. |
| GAAP image | `gaap-runtime:82d421e02de3292ae453`, healthy; release `0.1.20-45708e829d168ad9188bc0d6`. |
| Container isolation | Rootless, readonly, unprivileged, all capabilities dropped, no-new-privileges, loopback ports 4012/4020 and all three expected image labels verified. |
| Controller | Canonical fleet update succeeds, then daemon restart loads the exact installed 0.1.20 binary; one live controller with the expected root and name. |
| Agent assets | All 42 managed client links, manifests and complete artifact contents identify the selected release, including stopped instances. |
| Fleet state | 29 sleeping receivers ready for eligible input; 13 deliberate stops retained; no instance errors; revision11 and the exact saved resume selection unchanged. |
| Native preservation | All 42 enrolled identities, context/session bindings and 42 provider-file fingerprints match the predeployment snapshot. Definitions, names, parameters and desired activation are unchanged. |
| Management database | Sole schema15-to16 migration succeeds; integrity and foreign keys pass; all 40 protected relations retain existing rows, including 53 accounts/credentials and 76 room grants. |
| Server acceptance | All 52 visible directory entries and both fleet maps retained; all 29 active agreements listeners report the selected release. |
| Readiness | Canonical `fleet test` passes for the desired receivers without waking stopped agents or submitting a model task. |
| Real browser | 56 management routes at desktop/mobile widths and two wake-picker viewports pass; session-control and stopped/sleeping state screenshots inspected. |
| Public endpoints | Main and management HTTPS return 200. Content root, management API, Matrix, configuration and actual onboarding descriptor return 404 with sandbox CSP and no cookies. |
| Setup | Live canonical owner setup descriptor pins the published Fleet 0.1.20 release. |

The first status immediately after daemon launch correctly reports restoration
in progress. Acceptance uses the later connected, fully restored state; launch
alone is not treated as fleet readiness. Operator checks submit no business
messages, answer no pending decision and make no model calls. The other,
independently controlled ten-agent fleet retains its data, access and activation;
its controller is not commandeered or automatically upgraded. Bad Bets remains
untouched. The shared dirty GAAP source checkout remains unchanged.

## Verified backups

Backups precede activation and remain private on their owning hosts. Neither
archive is extracted into production or used to reset data.

| Archive | Verification |
| --- | --- |
| `controller-and-agreements-before20.tar.gz` | 2,266,078,098 bytes; 43,202 readable members; 85 exclusive ownership locks held during quiescent backup; 29 desired instances and 13 deliberate stops retained. |
| `20261010T160620Z-82d421e02de3.tar.gz` | 728,703,880 bytes; 800 readable members; mode0600; checksum, gzip and tar verified again after activation. |

Controller archive SHA256:
`2f3c34b74f1feee74a824c955ca172458b7b68814c7b24af2d606bd337411ed4`.
Site archive SHA256:
`dbe53fd0accf0f4aa4d3831974bf00d74cebec09437be53a40730d46b8729b38`.

## Boundaries and evidence

Existing GAAP runtime choices remain Codex. Pi is available through the released
adapter and its documented native prerequisites; no production Pi account or
new fleet is created for this rollout. Sleeping readiness is not evidence of a
paid task executing. Native history/provider fingerprint preservation is not
proof of every external side effect or arbitrary crash recovery.

Both existing public reports are deleted and remain deleted. Content TLS,
routing, sandbox headers and absent application routes are verified, but no live
published HTML report is available for an opaque-origin browser isolation check
during this rollout. No verification-only report is created. Product browser
isolation fixtures remain covered by the full integrated gates.

Owned temporary SSH forwarding and browser sessions are closed; temporary
operator credentials are removed after authenticated checks. Private backups,
native snapshots and browser screenshots stay outside Git.

- [GAAP](https://gaap.lol/)
- [Management](https://gaap.lol/manage/)
- [Content host; root404 is expected](https://content.gaap.lol/)
- [Fleet 0.1.20](https://www.npmjs.com/package/@ctlflow/fleet/v/0.1.20)
- [Fleetd 0.1.20](https://www.npmjs.com/package/@ctlflow/fleetd/v/0.1.20)
- [Manual release PR](https://github.com/control-flow-project/crossfire/pull/new/release/pi-runtime-0.1.20)

Private evidence: `.temp/pi-release20/`. Full verification summary:
`.temp/test-runs/2026-10-10T15-43-58.072Z-2328186/summary.json`.
