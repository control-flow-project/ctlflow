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

The C# and Rust source changes only their coordinated version metadata. This
record does not claim a new full native-target/performance bank, deployment,
provider account authentication or model-task completion. Deployment evidence is
recorded separately after activation and live verification.
