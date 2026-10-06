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

## Observation journal upgrade

Enabling the existing fleet exposed an omitted forward conversion for its
pre-idle observation journals. Their exact previous schema lacked lastActivityAt
and historyAvailable; the current runtime correctly rejected it. The six newly
initialized instances already used the current schema.

The internal fleetd observation-migration operator validates the known previous
schema, holds controller/receiver writer locks, verifies durable byte-exact
backups, then atomically converts each file. Unknown historical metadata becomes
null; pending output and every other observation field remain intact. Current
files are no-ops and other schemas fail without mutation. The runtime retains
one strict schema, without a fallback reader or deleted output/history.

The operator is source-checkout-only and excluded from public npm bundles. Its
five tests cover boundaries, active writers, exact backups/output retention,
preflight rejection, interruption-safe retry and current-schema idempotency.

## Verification

- Current source typecheck/build passes.
- Four focused actual native runtime tests pass with inert providers. Distinct
  display names/profiles and a subsequent rename retain the exact profile,
  private state, previous conversation and native session identity.
- Missing, null, empty, malformed and oversized profile keys fail without
  touching native state or invoking the unavailable test executable.
- Final canonical npm test passes 652 tests in 151 isolated files on 24 workers.
- All 33 architecture and four installation checks pass.
- The actual native container gate passes on the 0.1.3 product image. Adding the
  internal operator does not change either published runtime bundle's bytes.
- Both edited skills pass skill-creator validation; package ownership and
  whitespace checks pass. No paid-provider or macOS certification is claimed.
- All 40 production management routes pass desktop/mobile browser checks,
  producing 103 screenshots after fleet activation. Element's welcome/native
  sign-in pages also pass at both widths. Fleet details/map show online delivery
  and the distinction between sleeping and working native sessions.

The first direct test-runner invocation lacked npm_execpath and correctly failed
the installed-product test. It is retained as failed evidence. The unmodified
canonical npm rerun passes. An initial final-suite run hit the existing native
fleet integration's bounded sync-token observation timeout; the unchanged focused
rerun and complete unchanged 652-test rerun pass. Migration fixture failures and
initial browser selector failures are retained too. No assertion, timeout or
quality gate is weakened.

## Deployment

Both public 0.1.3 packages are published and anonymously downloaded with exact
archive integrity. Initial registry processing returned 404; subsequent complete
verification passes. No internal workspace is published.

The website runs gaap-runtime:75dfc887b571a4be631b with product source 4211de5 and
release 0.1.3-c8b432a02e989aecc268d6fc. A verified full backup precedes deployment.
Schema 13/all 63-table integrity and foreign keys pass; all 37 protected
relations and 134 original audit entries are retained at the quiescent deployment
checkpoint. No production data is reset.

Large public responses initially truncated because native nginx workers could
not write inherited proxy-buffer subdirectories. GAAP source a0ec7c7 declares
one private www-data-owned request/response buffer tree in both canonical vhosts.
A verified native configuration/certificate-renewal backup precedes installation,
nginx validation and reload. All release and management asset bytes now verify;
a large invalid request reaches application validation, proving request spooling
too. No disabled buffering, protocol fallback, broader permissions or other
tenant change is used. These host-only changes do not require a new product image.

content.gaap.lol has correct DNS, dedicated valid HTTPS, active certificate-renewal
timer and the canonical loopback upstream. Cookie/Authorization stripping,
no Set-Cookie, denied main/Matrix routes and CSP sandbox allow-scripts without
allow-same-origin remain verified. Main application cross-origin POSTs fail.
No fresh public report or renewal dry-run is performed in this task; prior
deployed six-file publication/browser/deletion proof and current native report
tests remain separate evidence, not a new live publication claim.

Turbine uses the exact public 0.1.3 pair and agreements instructions 61eac7f.
Both pre-update and pre-conversion full backups verify. All 22 existing journals
convert with separately verified original-byte backups. Controller restoration
then binds all 28 receivers asleep, retaining all 28 accounts/provider files,
the exact 22 existing histories and the six first-initialized histories.

The user's later instruction explicitly enables the fleet, superseding its
earlier stop intent. Controller/delivery and all 28 logical receivers are online;
native sessions resume saved history only when eligible work arrives and sleep
after the configured 1,800-second idle period. Retained eligible messages have
already awakened workers. No synthetic assignment or model prompt is sent.
The strict fleet test rejects a busy worker as intended; individual diagnostics
confirm authentication, exact histories, current release and unpaused delivery
without requiring ordinary work to stop. Normal processing may create needed
owner DMs; the quiescent no-new-room checkpoint is not a claim of no later rooms.

Private evidence is under .analysis/20261006-content-publication-check/evidence.
All three repositories use pushed feature branches and manual PR creation;
there is no main push, automatic PR, global service or unrelated host change.
