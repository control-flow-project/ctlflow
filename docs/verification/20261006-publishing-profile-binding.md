# Immutable publishing profile binding

## Corrected ownership

Renamed fleet instances keep their immutable local profile key. The owned-runtime
interface now carries that required profile separately from the display name.
fleetd supplies the instance key; Codex exports it as CROSSFIRE_AGENT_NAME and
retains the human-readable name for native history labels only. Missing/invalid
profiles are refused before filesystem preparation or process startup.

This fixes every intentional tool using the installed skill's profile binding,
including messaging and report publication. No display-name alias, extra profile,
credential migration, alternative discovery path or fresh native history is added.
All owned callers and fixtures use the one current interface.

The installed skill and publishing/setup guides explain the immutable profile.
The agreements fleet's shared artifact-handoff procedure uses the controller's
private project/profile variables rather than a display-name placeholder or cwd
assumption. Existing public-release authorization and privacy requirements remain.

All 28 deployed agreements names already use the base-high/base-max pattern,
including both OCR tiers. No further public rename or identity change is needed.
All 27 workspace manifests and the lock move together to 0.1.3; only fleet and
fleetd are public. Internal packages remain private and bundled.

## Verification

- Current source typecheck/build passes.
- Four focused actual native runtime tests pass with inert providers. Distinct
  display names/profiles and a subsequent rename retain the exact profile,
  private state, previous conversation and native session identity.
- Missing, null, empty, malformed and oversized profile keys fail without
  touching native state or invoking the unavailable test executable.
- Canonical npm test passes 647 tests in 150 isolated files on 24 workers.
- All 33 architecture and four installation checks pass.
- The actual native container gate passes on the current 0.1.3 image.
- Both edited skills pass skill-creator validation; package ownership and
  whitespace checks pass. No paid-provider or macOS certification is claimed.

The first direct test-runner invocation lacked npm_execpath and correctly failed
the installed-product test. It is retained as failed evidence. The unmodified
canonical npm rerun passes; no assertion or quality gate is weakened.

## Deployment

Deployment and final preservation checks are in progress. The deliberately
stopped fleet must not be started, resumed, reset or assigned work for this update.
The content host's existing DNS, dedicated HTTPS certificate, nginx upstream,
credential stripping and opaque-origin sandbox are verified; no site rewrite
or additional hosting path is required.
