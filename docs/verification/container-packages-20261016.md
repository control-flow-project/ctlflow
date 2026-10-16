# Container package verification — 2026-10-16

## Scope

Crossfire now builds independently transferable Node, managed C# and NativeAOT
C# server packages for Linux amd64. Each contains the selected immutable runtime
image, the common Knex migration image, a bounded manifest and standalone
build-side package tooling. Both operator implementations consume that format;
deployment no longer builds source or selects a backend from the operator's
language. Removed source-build options are rejected.

GAAP and Bad Bets website profiles select `csharp-nativeaot`. Their branding
stages copy assets into the selected runtime without adding Node or overriding
its native entrypoint/health check. Fleet attachment still installs the pinned
Node `@ctlflow/fleet` and Node fleetd. The coding harness performing setup remains
independent of the sessions fleetd owns.

The tested coordinated version is `0.1.20`. Packaged Crossfire input digest:

```text
85ec29cf65ee6edd7da687e4fc268649b126bab786621c23cfb3bd68da66c714
```

No dependency lock, SDK pin or package version changed. No public package or
container registry publication, production activation or production data change
was performed. The separately owned Rust implementation was not modified or
represented by a placeholder image.

## Executed gates

The final current-source `verify:parity` run completed all nine phases successfully.
Its process group had 32 GiB memory, no swap and 8,192 tasks. Native Docker
fixtures additionally used bounded container slices. A temporary rootless engine
used the installed Docker binary and systemd cgroup driver without changing the
shared daemon, context or host configuration.

| Gate | Result |
| --- | --- |
| Architecture, ownership and installation policy | 33 proofs pass |
| Node typecheck, build and complete product suite | 887 tests across 197 files; Codex and Pi; 24 workers |
| C# core, storage, calendar and native transport | Managed and actual NativeAOT acceptance pass |
| Managed distribution | Independent product publication passes |
| NativeAOT distribution | Independent native product publication passes |
| Installed-product shared contracts | Node, managed C# and NativeAOT C# pass |
| Actual-container shared contracts | 91 tests pass; zero failures, cancellations or skips |
| Actual shared Knex container | Fresh, deployed schema 13 and repeat schema 17 pass; future schema 18 is rejected |
| Historical data migration and rollback | Protected-data, unsupported-version and transactional failure checks pass |
| GAAP branded NativeAOT package | Real desktop/mobile Element and management browser checks pass |
| Bad Bets branded NativeAOT package | Real branded browser checks and all 23 website source tests pass |

The container bank exercises every installed operator against every backend
package, using the same persisted state without a source checkout. It verifies
actual archive import, standalone helper operation, image-owned readiness,
unchanged API/UI, onboarding instructions, maintenance configuration validation,
exclusive ownership, killed launchers, running/exited migration orphans and
foreign-ownership rejection. Corrupt archives and mismatched labels fail before
stopping an existing writer. Both branded NativeAOT images are checked for the
absence of Node and the .NET runtime.

## Defects found during verification

- Host time-zone data differed from the pinned Node database. One pinned IANA
  archive producer now supplies native calendar verification and all native
  runtime images. Host data is not an implicit input.
- Docker could still be removing an owned container after its CLI acknowledgement.
  Both implementations now observe the exact immutable identity until absence,
  without issuing competing removals. Failure to establish absence remains an
  error. The harness captures its container-specific shutdown budget at process
  acquisition, including failure cleanup; ordinary process budgets are unchanged.
- In the pinned Node 26.10.0 image, `fetch` omitted the configured Host header
  from the health request. A real in-image echo probe reproduced the failure.
  The Node health command now uses direct `node:http` requests with the configured
  authority, bounded deadlines and no redirects. Real HTTP regression tests and
  the complete image matrix pass. There is no version branch or fallback.

Earlier failed runs remain recorded as failures; their assertions were not
removed or relaxed. Regenerable fixtures, build outputs and the private test
engine are removed after their final use; concise evidence is retained locally.

## Limits

The pinned .NET 11 SDK/EF packages are previews. Existing NativeAOT IL diagnostics
remain visible and unsuppressed. Passing the supported compiled query surface is
not a claim that arbitrary EF reflection or dynamically constructed queries work.
See the [native implementation diagnostic contract](../architecture/native-implementations.md).

This verifies Linux amd64 packages, not ARM64, native macOS/Windows server
packages, an unmerged Rust backend, production provider credentials or live site
availability. Hashes establish integrity, not publisher authentication. Live
activation still requires the site's coordinated fleet release, verified backup,
forward migration and postdeployment checks described in the
[container package contract](../../services/crossfire/docs/container-packages.md).
