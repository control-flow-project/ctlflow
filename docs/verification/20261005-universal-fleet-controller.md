# Universal fleet controller verification

## Delivery scope

Verified product source: `34398fe`, based on freshly fetched Crossfire main
`c459fda`. Subsequent changes close the plan, documentation and its Git tracking only. The working
branch is `feat/universal-fleet-controller`. GAAP main `759ad2d` and Agreements
main `9d57e5d` remain clean and untouched.

- Every agent belongs to a fleet. fleetd owns the shared listener and native
  lifecycle; a one-agent fleet uses exactly the same architecture.
- Setup asks no configuration questions. Private persisted defaults or an
  explicit validated configuration select the controller, fleet and workspace.
  Human enrollment approval remains mandatory and is awaited without model
  polling. Setup never adopts the coding assistant's existing conversation.
- Native adapters remain interfaces. Codex is the only implemented runtime;
  unsupported runtime values and removed direct-agent lifecycle forms fail at
  their boundaries. There is no compatibility implementation.
- All package names use `@ctlflow`. Only `@ctlflow/fleet` and `@ctlflow/fleetd`
  are publishable, with exact coordinated versions, bundled internal modules,
  finite package-file allowlists and no installation lifecycle hooks. All other
  workspace packages are private.
- Management has one setup page, consistent table indexes and durable detail
  tabs. Agent views are Rooms, Session, Activity and Settings; fleet views are
  Agents, Map, Activity and Settings. Completed session receipts refresh their
  dependent queries without optimistic lifecycle claims.
- Schema 13 has 63 singular normalized tables. The forward 12-to-13 migration
  preserves historical enrollment relations without inventing live controllers.
  Retirement requires exact native-close evidence, live controller authority
  and settled delivery. Indexed eligibility projections use 11 queries,
  independent of page size.

The [specification](../specification.md) owns the current contracts; product
workflows are indexed in the [documentation](../README.md). The implementation
plan accompanying this revision has been superseded and removed from the
current tree. This report records only the source revision identified above.

## Final quality gates

| Gate | Observed result |
| --- | --- |
| Root strict typecheck and build | Both pass on the verified product source. |
| Full test run | 627 tests pass, zero failures/cancellations, 145 files, 24 workers. Preparation takes 1.677 seconds; test execution takes 63.555 seconds. |
| Architecture and structure | Structure gate and all 33 architecture checks pass. |
| Installation | All four installation checks pass. |
| Installed public packages | Clean external-prefix installation, finite packaged files, declared public-only dependencies, executable entrypoints and reusable private controller pass. |
| Native Codex | Linux stock Codex 0.160.0 with inert providers; setup/readiness uses no model calls. Exact history reuse, stopped intent, lifecycle, SSH/TUI and durable developer-instruction evidence pass. |
| Browser | All nine browser test files pass, including 40 operator-management views at desktop/mobile sizes, native permission/lifecycle actions, decisions, reports, wake-ups and setup. |
| Actual container | Image `crossfire-runtime:b53f668e3d857c9c72bf`, release `0.1.0-1bb0435202babe9bda37e291`; actual Element/management and two-start persisted-room lifecycle pass. |

The container gate verifies normal signup/login, public-room creation, exact
authenticated CSV download bytes and filename, unauthenticated denial, native
sandbox restrictions, personalized npm instructions, React/native routes,
artifact cookies, orderly shutdown and persisted rooms. The coordinator also
visually inspected setup, management hierarchy and the dense fleet map.

Full tests use verified cgroup limits of 16 GiB memory, zero swap and 4096 tasks.
The final separate typecheck/build uses 8 GiB, zero swap and 1024 tasks. Docker
build/runtime verification runs in a private temporary user slice under the
calling verified finite budget, not merely an escaped Docker CLI scope. The
gate checks native process-group placement and removes its owned container and
slice. No product service or host boot configuration is installed.

Local ignored evidence:

- `.temp/universal-final-gates/final4-test.log`
- `.temp/universal-final-gates/final-typecheck-build.log`
- `.temp/test-runs/2026-10-05T17-05-30.166Z-2953207/summary.json`
- `services/crossfire/.temp/container-verification-tdtM8l/`
- `.analysis/20261005-universal-fleet-controller/necessity-ledger.md`

## Defects found during integrated verification

Earlier failing runs remain in the local evidence; they are not passing
certificates. Actual product fixes include retained-state queue identity across
in-flight receipts and receipt-driven invalidation of dependent management
queries. Controlled observations reproduce those races without sleeps, longer
timeouts or weaker assertions. Fixtures now obey approved revisions and native
run ownership instead of fabricating competing reporting runs.

One earlier operator-browser run failed without sufficient diagnostics. Focused
verification and both subsequent complete runs pass, but its original transient
cause is not claimed to be identified. The operator now retains bounded private
phase/error evidence and redacts credentials before truncation; a cutoff-boundary
regression verifies that partial secrets cannot escape that diagnostic.

## Read-only production preservation

The production inventory completed at `2026-10-05T17:13:44.315Z` using the
already-deployed read-only tools, not the new schema against production data.

- GAAP still serves release `0.1.0-bd29c17a0bf270d8d76215f8`.
- Turbine controller `turbine-gaap` remains connected; Agreements delivery is
  disabled and all 22 agents remain deliberately stopped.
- All 22 account identities, 22 saved native-history scope identifiers and 22
  provider-file byte/fingerprint records exactly match the prior preservation
  snapshot. There are no controller-owned native app-server processes.
- Two existing unrelated native app-servers use the host's default Codex home,
  outside the Agreements workareas and controller process ancestry. They were
  inspected read-only and left untouched.
- No deployment, production migration/reset, room change, assignment, start,
  resume, fresh-history operation or paid model call occurred.

Inventory evidence is retained under `.temp/universal-final-gates/` in
`production-fleet-verification.json`, `production-native-processes.json` and
`production-health.json`. Private preservation evidence is not committed.

## External dependencies and explicit limits

Registry publication is not complete. The authenticated registry check on
2026-10-05 returns `npm whoami`: **E401 Unauthorized**. No credential acquisition,
registry publication or production rollout is claimed. Once authorized registry
authentication is available, publish only the two exact verified public
tarballs, fleetd first, using the documented
[publication procedure](../development.md). Do not deploy npm onboarding that
points to an unavailable release.

Stock Codex's WebSocket app-server can survive SIGKILL of fleetd and retain its
native history writer lock. Exact-history replacement then correctly fails with
`already has an active writer`. Audited native stdio/Unix ownership mechanisms
do not provide the required parent-lifetime guarantee together with the stock
remote TUI. There is no watchdog, proxy, orphan adoption, guessed PID cleanup,
deleted lock or implicit fresh-history workaround. Normal awaited shutdown and
a machine restart where all owned processes terminate are distinct, verified
cases. See [controller operations](../../services/fleetd/docs/operations.md)
and [native feasibility](../../services/crossfire/docs/architecture/feasibility.md).

Native macOS and paid-provider execution are not certified by these Linux
inert-provider tests. These evidence limits do not introduce another runtime
path or relax authorization, history safety or verification gates.
