# MIT licensing verification — 2026-10-17

Base: `cb3ece8ddb850b58499d12befd79b7ebca166b17`.

This change applies the MIT license to first-party material in ctlflow, including
crossfire, fleetd and fleet. It does not alter APIs, runtime behavior, dependencies,
versions, package privacy or publication permissions. Third-party licenses and
notices remain their upstream property and are unchanged. Historical verification
records retain the licensing statements that applied to their original revisions.

## Scope

- Root and 40 service/package license copies contain the full MIT grant,
  copyright, warranty disclaimer and liability limitation.
- All 31 owned npm manifests and corresponding lock records declare `MIT`.
  Only `@ctlflow/fleet` and `@ctlflow/fleetd` remain public products.
- The Rust workspace declares `MIT`; all 25 members inherit it and remain
  unpublished. `Cargo.lock` is unchanged.
- C# projects inherit `PackageLicenseExpression=MIT`. `IsPackable=false`,
  authorship and copyright properties are unchanged.
- Current guides and the distributed agent-tool banner describe the same license.
  License packaging assertions and negative metadata tests match that policy.

## Checks

The following focused Node tests pass: 16 passed, zero failures or skips.

```sh
node --test scripts/package-ownership.test.mjs scripts/rust-licenses.test.mjs \
  scripts/distribution-documentation.test.mjs scripts/project-naming.test.mjs \
  scripts/verify-documentation.test.mjs
```

Additional checks:

- Native Rust `cargo metadata --offline --locked --no-deps --format-version 1`
  resolves all 25 packages to `MIT` with publication disabled.
- .NET 11 MSBuild property evaluation on `Crossfire.Server.csproj` returns
  `PackageLicenseExpression=MIT`, unchanged author/copyright and `IsPackable=false`.
- An independent comparison to the base proves all 31 owned npm lock records
  differ only by license. All 150 other records, dependency values and publication
  fields are unchanged. Every Cargo manifest differs only by license metadata.
- All 41 first-party license files match. The Matrix specification's upstream
  license hash remains `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594`.
- The agent-tool build source differs only in its emitted copyright/license
  banner. No runtime statement changes.
- Current-documentation verification passes for all 65 guides. `git diff --check`
  passes.

Tests and native metadata evaluation ran in bounded process groups with 2 GiB
memory, no swap and 128 tasks. Temporary fixtures are removed after verification.
No full runtime, container, native-provider or production deployment cycle was
run for this licensing-only change. No package was published.
