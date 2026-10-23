# Coordinated distribution publication — 2026-10-23

## Scope and identities

The previous live deployment used current source/version 0.1.24, but the five
generic GHCR packages contained only 0.1.22. This publication closes that version
gap and replaces current installation references with verified 0.1.24 digests.
It does not change GAAP, Bad Bets, Turbine, existing histories, data or desired
agent selections. Site images, credentials and domain fleet material were not
published. There is no fleet container.

The runtime source is commit
`774de415a2b327fde1a7d5be5001737e01776e91`, with build-source digest
`5654753e2dc919318e6d88d8679e95dbdd019d055c4876a7b26ef1d9c92722ad`.
Root policy/specification edits do not change those runtime build inputs.
Canonical packages for Node, managed C#, C# NativeAOT and Rust built in 596.005s.
The pinned C# compiler/runtime is .NET 11 RC2; EF preview/AOT diagnostics remain
visible. No diagnostic was suppressed or native runtime replaced.

All four packages use one migration configuration:
`sha256:42946de9345a278b0808ba001a44db3fbb16fdf660b17e8fa66b4f3b13579741`.
The package exporter verified archive identities, source, platform and versions
before publication. Registry manifests were checked independently of Docker
configuration IDs and archive descriptors.

- [Published image inventory and immutable references](../../services/crossfire/docs/releases/0.1.24.md)

## Verification

| Check | Result |
| --- | --- |
| Workspace build and typecheck | Passed |
| Full Node bank, Codex and Pi | 982 tests across 214 files, 24 workers; zero failed/cancelled/skipped/TODO; 126.814s including 41.074s preparation |
| Full and production-only dependency audits | Zero vulnerabilities |
| Actual Docker server and host fleet, Node | 7 tests, zero skips; 18.409s |
| Actual Docker server and host fleet, managed C# | 7 tests, zero skips; 21.309s |
| Actual Docker server and host fleet, NativeAOT C# | 7 tests, zero skips; 17.465s |
| Actual Docker server and host fleet, Rust | 7 tests, zero skips; 16.696s |
| Shared management-document contract, all four images | 5 tests, zero skips; 24 requests/72 scalar assertions; 29.670s |
| Existing public npm archives | Both current local archives exactly match registry SHA-512 and downloaded bytes |
| Actual public npm installation | fleet 0.1.24 and its exact fleetd 0.1.24 dependency installed with scripts disabled |
| Image publication | All five version tags uploaded and immutable manifests/configurations verified |
| Authenticated immutable pulls | All five pass platform, backend, version, source and package-label checks |

Each actual-container run initializes an isolated server with common Knex,
checks real Element/management login, owner-reviewed host setup, distinct native
histories, content-origin isolation and exact-history/controller restart with
deliberate stopped selections retained. It uses real Codex with an inert local
provider, not a paid provider account. The full Node bank additionally selects
Pi. This is not a new full C#/Rust internal-bank or comparative performance run,
nor a claim about paid-model behavior or cold-cache network throughput.

## Registry access

The five publication/pull receipts were recorded between 01:07:44 and
01:08:56 UTC. Packages remained private, and all five anonymous authorization
checks returned 401. The organization owner must change package visibility to
Public before anonymous installation can pass. This is an outstanding access
dependency, not a successful public-pull result or an upload failure.

The release guide documents authenticated access and does not promise anonymous
downloads. An owner-side visibility change must be followed by actual anonymous
immutable pulls. The supplied private GHCR credential was used only for registry
publication/inspection; temporary Docker authentication was logged out afterwards.

## npm and first-attempt findings

The unchanged public archives are 65,942 bytes for fleet and 928,194 for fleetd.
Both registry `latest` tags point to 0.1.24. No npm version was overwritten or
needlessly republished, and internal workspaces remain private.

The first isolated-prefix npm install selected the user's global seven-day age
policy without the project's existing named first-party exclusions and failed
with ETARGET. The repeat used the unchanged project `.npmrc`; no new exception or
age-policy weakening was introduced. The public archive integrity checks had
already passed in the first attempt.

The first Docker/host-fleet attempt lacked a Compose plugin. Verification then
used the official Compose 5.4.0 binary in disposable task-only Docker
configuration, checked against its GitHub release SHA-256. The same assertions
passed. No global installation, test waiver or production change was made.

The verification daemon/store and test processes had finite memory, swap and
task limits. Tests disposed their own resources. Disposable builds, fixtures,
package staging and Docker data are removed after their final use; concise test
summaries and publication receipts remain private, not in source distributions.
Website documentation publication is recorded separately by ctlflow.com.
