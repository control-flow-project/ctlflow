# Docker verification control bus — 2026-10-17

Resource verification disables the inherited desktop session bus so Chromium
cannot register a process outside its bounded test scope. Docker's test-slice
manager had inherited that disabled address too, preventing creation of the
finite container/build resource parent.

Only the `busctl` and `systemctl` control commands now use their native user-manager
connection. Browser/test descendants retain the disabled session bus. No resource
ceiling, assertion, production runtime or container image changes.

Verification on the changed source:

- Eight resource/evidence tests pass, including actual Chromium cgroup identity.
- Four standalone fleet-container cases pass, including retained credentials and
  stopped registry across restart.
- Bad Bets NativeAOT branding builds and the actual desktop/mobile Element,
  login and management browser fixture pass under the created finite Docker slice.
- Workspace architecture verification passes.

These are local verification results, not GHCR publication evidence.
