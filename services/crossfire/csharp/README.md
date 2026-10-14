# C# implementation

This is the in-progress .NET 11 implementation of Crossfire. It is not yet a
deployable Crossfire server or fleet runtime. A separate parallel Rust worktree
is authorized; neither track's checkpoint is a release. The shared React web
project does not change.

`Crossfire.CSharp.slnx` coordinates the service-owned projects. `global.json`
pins the SDK. Central package versions pin matching EF 11 packages. Managed and
NativeAOT outputs use the same source, interfaces and canonical SQLite asset.
Initial managed deployment is permitted once all product gates pass; a managed
build never stands in for NativeAOT execution.

## Build and core acceptance

Build the Node packages once because the database parity check uses their public
repository exports. Do not publish the private packages.

```sh
npm ci --ignore-scripts
npm run build
dotnet build Crossfire.CSharp.slnx -c Release
node services/crossfire/scripts/generate-sqlite-model.mjs --check
```

Run core verification inside a bounded Linux process-group resource scope. Set
`DOTNET_EXECUTABLE` to an absolute executable path when it is not on `PATH`.
The SDK, GCC and local NuGet packages must be available. Native/trimming
diagnostics remain visible and require audit.

```sh
systemd-run --user --scope --quiet \
  --property=MemoryMax=8G --property=MemorySwapMax=0 --property=TasksMax=1024 \
  --working-directory=/absolute/path/to/crossfire \
  node /absolute/path/to/crossfire/services/crossfire/csharp/scripts/verify.mjs
```

This checks model generation, managed and native core acceptance, actual HTTP
protocol requests to a loopback fixture, private filesystem behavior and
Node/managed/AOT reads and writes on identical SQLite files. Native acceptance
reports dynamic code and reflection JSON disabled. Forward versions 15 and 16
are compared against Node's actual migration, including exact schema metadata.
Versions 13 and 14 still require their remaining C# data-preserving conversions.

Core acceptance is not complete endpoint, Conduit, Codex/Pi or browser parity.
The full Node suite remains mandatory, including both implemented native engines.
The full native implementation readiness report is
`docs/architecture/native-implementations.md` at the repository root.

## Source owners

- Kernel: failures, results and cryptographic identities.
- Contracts: transport validation, JSON envelopes and native Matrix state values.
- Domain: pure authorization and operation modules with immutable values and ports.
- SQLite adapter: EF entities, exact schema mapping, queries, writes and transactions.
- HTTP/Matrix adapters: bounded protocol I/O and actual connection ownership.
- Filesystem adapter: owned Linux state, non-symlink handles and durable writes.
- Build-only EF compiler: pinned upstream source with confirmed generator fixes.
- Tests: disposable fixtures and direct same-store interoperability checks.

Domain code does not import transport, SQLite, native process or UI implementations.
Applications own composition. No C# process invokes Node as an implementation
fallback. Crossfire, fleetd and fleet keep their own service directories; the
root owns only build metadata, documentation and verification coordination.
