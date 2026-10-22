# Sanitizer dependency update — 2026-10-22

Coordinated product version: `0.1.24`.

The production npm audit rejected `sanitize-html` 2.17.7. The Matrix adapter now
pins 2.18.1. Its required dependency closure upgrades `launder` 1.7.1 to 1.7.2
and removes unused `deepmerge` 4.3.1. No other external lock records change.
The seven-day release-age policy and its existing named exceptions are unchanged.
Version 2.18.1 was published on 14 October, before the policy cutoff.

Advisories: GHSA-x3q4-9hxx-gx8m, GHSA-374f-7chj-9948 and
GHSA-cv27-6wvh-8x7j. These are dependency findings, not evidence that the
application was compromised. The adapter already escapes authored HTML and
restricts generated tags, attributes and URL schemes. Regression coverage now
also includes malformed `noscript`, SVG animation and meta-refresh input.

Verification on the release source:

- Workspace build/typecheck and source/architecture structure checks pass.
- Full Node bank: 981 tests in 214 isolated files on 24 workers; zero failures,
  cancellations, skips or TODOs. Both Codex and Pi are selected. Runtime and browser
  assertions are included. Elapsed time was 113.883 seconds including preparation.
- Installation policy: four tests pass with no failures or skips.
- Full and production-only npm audits report zero vulnerabilities.
- The first full-test attempt stopped during asset preparation because the old
  local Docker socket had no running daemon. The complete rerun used the explicit
  disposable rootless Docker socket and passed. No assertion was waived.

## Native package verification

The C# and Rust source changes only their coordinated version metadata. The
managed/NativeAOT core gate completed all 20 steps, including 5,300 assertions per
storage acceptance run, actual Conduit authority checks, calendar cases, schema
constraints, backups, locking and cross-target SQLite interchange. NativeAOT
publication succeeds. Existing EF trimming/AOT diagnostics remain visible.
Rust's locked workspace metadata validates; this is not a new Rust runtime bank.

The actual NativeAOT Docker server and Node host-fleet acceptance run passes all
seven tests with no skips. It covers common Knex release identity, isolated
server ports/state, real Element/management browser login, owner-approved host
setup, content-origin isolation and retained histories/credentials/stopped
selections across controller restart. The separate local-Docker contract tests
also pass all four assertions.

Earlier container attempts exposed a stale browser label in the test and cleanup
that could mask the primary failure. The test now uses the shared UI's neutral
`Username` label, stops fleetd only after setup was attempted, and reports all
cleanup failures without discarding the original error. Separately, Conduit
database startup blocked on the test HDD's filesystem journal. The passing run
used disposable NVMe storage with the original readiness deadline and finite
aggregate Docker/process resource limits. No production timeout was increased.

This record does not claim a new full cross-target/performance bank, live
provider authentication or model-task completion. Deployment evidence belongs
to the deployment repositories after activation and live verification.
