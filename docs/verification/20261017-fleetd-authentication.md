# fleetd authentication and private-note exclusion

Review date: 17 October 2026. Branch: `feat/fleetd-auth-20261017`.
Baseline: `52bf0279`. Source metadata remains 0.1.20. No package publication,
deployment, production data change or native-history reset is performed.

## Changes

- All 19 fleetd operations require the OS-user controller bearer credential,
  including status. Missing, wrong, malformed and duplicate credentials fail
  before route dispatch. Browser Origin/Cookie headers remain forbidden.
- fleetd atomically initializes one private OS-native `ctlflow/fleetd.json` with
  a random 256-bit key. It completes valid keyless configuration and preserves
  an existing key. Malformed, oversized, duplicate-field and unsafe files fail
  without replacement. Local fleet clients only read this configuration.
- SSH reads the remote user's private configuration over strict-host-key SSH;
  it retains credentials in memory, not connection profiles, arguments or logs.
  One package-owned read script is shared by Node, C# and Rust transports.
- Management setup remains pinned npm fleet with Node fleetd, independent of
  the server backend. Native distribution READMEs now select their exact target
  and C# build mode. The database schema and migration ownership are unchanged.
- Ten inherited tracked private-analysis files are removed from the source
  tree. The structure gate rejects tracked `.analysis` paths and missing root/
  nested ignore coverage. Local notes remain private; Git history is not rewritten.

Anyone able to read the controller configuration has full controller authority.
It is not per-fleet isolation. crossfire enrollment credentials are separate.
No anonymous compatibility path or public controller port is introduced.

- [Controller authentication and recovery](../../services/fleetd/docs/authentication.md)
- [Installation targets](../distributions/README.md)
- [Verification commands](../development.md)

## Verification

The required banks pass independently on the final application source. This is
not a claim that an earlier aggregate invocation passed uninterrupted: earlier
failures and the subsequently repeated banks are distinguished below.

| Bank | Result |
| --- | --- |
| Architecture | Ownership, generated contracts, file inventory, documentation and private-note checks pass |
| Node | 946 tests, zero failed/cancelled; 211 isolated files, 24 workers; Codex and Pi selected |
| C# managed and NativeAOT | 5,241 core, 537 runtime, 28 controller and 84 authentication-storage assertions in each mode |
| Rust | 273 tests across 138 compiled targets; formatting and warnings-denied workspace Clippy pass |
| Native packaging | Managed C#, NativeAOT C# and Rust distributions build; installed native products run without a source checkout |
| Shared installed products | The same 65 tests pass on each of Node, managed C#, NativeAOT C# and Rust, including real SSH and responsive browser checks |
| Shared containers | The same 32 tests pass on each target; actual packages, operators, browser/API behavior, SQLite reuse and recovery cases |
| Migration container | Actual Knex image initializes schema 0, upgrades 13, preserves current 17 and rejects 18 without mutation |
| Dependency records | All 120 external npm lock records remain unchanged; new dependencies are internal declared package edges |
| Private notes | Three new regressions cover ordinary files, force-added root/nested notes and incomplete ignore rules; included in the 946-test run |

Container input digest:
`eb51036bd5ecb38bc5b023eb3234e1bb1a2d23a30f84b8bc68263e6d363d9207`.

Verification uses finite aggregate process groups: 16 GiB memory, zero swap,
2,048 tasks. Docker descendants use the verified finite test slice. The separate
disposable rootless engine uses an 8 GiB limit and on-disk image storage.
Generated fixtures, databases, native test homes and build outputs are removed
after their final use; concise local results are retained privately.

## Failed attempts and limits

Initial checks found and corrected an undeclared Rust dependency, SSH asset
reach-through outside its Node package, an installed-client test still expecting
anonymous access, and C# startup probing before the first key existed.
No assertion was removed or weakened.

A disposable Docker engine was OOM-killed at its exact 8 GiB bound because its
image store occupied RAM-backed temporary storage. Moving only that test store
to disk fixed the environment; the limit was not raised. All four container
banks then passed.

Earlier concurrent runs also exposed intermittent existing Pi/reset, listener
readiness/recovery and C# Codex steering observations. The steering test failed
its original 10-second bound in managed and NativeAOT runs. Added diagnostics
record bounded request counts/inputs on failure; the complete final shared bank
passes on every target. The underlying intermittent cause is not established
and is not claimed repaired. Timeouts, concurrency and predicates are unchanged.

The .NET 11/EF preview NativeAOT diagnostics remain visible, not suppressed.
Verification covers Linux x64 with actual Codex/Pi engines and inert providers,
not paid-provider availability or exhaustive crash certification. Node supports
Linux/macOS; matching macOS configuration path tests do not establish C#/Rust
native macOS support. Windows is unsupported. Website work remains deferred.
