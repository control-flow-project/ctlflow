# Server Docker and host-native fleet verification

Date: 2026-10-18. Scope: server-only Docker quickstart, host npm attachment,
generated onboarding guides and the shared management setup page. No production
deployment, npm publication, GHCR publication or paid-provider test was performed.

## Changes

Removed the fleet Docker image, service, relay, native-image checks and duplicate
provider fixture. The server Compose definition retains its existing server and
one-shot initialization/migration owners, loopback ports and server-only volume.
Host attachment uses the existing public fleet/fleetd packages and native login.
No new controller API, auth mode, migration or native lifecycle was introduced.

All three guide implementations require the selected existing harness/login and
forbid harness installation or credential copying into Docker. The installer
no longer incorrectly requires Codex for an explicitly configured Pi roster.
The existing controller adapters retain native capability/authentication checks.

## Verification

| Check | Result |
| --- | --- |
| Workspace build/typecheck | Passed |
| Structure, documentation links, ownership and timing checks | Passed |
| Focused HTTP, Compose, public host setup and real browser tests | 16 passed, 0 failed; 30.2 seconds |
| Compiled C# guides versus Node | 6 byte-exact comparisons passed |
| Compiled Rust guides versus Node | 6 byte-exact comparisons passed |
| Node server Docker plus host fleet | 7 passed; 22.1 seconds |
| Managed C# server Docker plus host fleet | 7 passed; 24.8 seconds |
| NativeAOT C# server Docker plus host fleet | 7 passed; 21.5 seconds |
| Rust server Docker plus host fleet | 7 passed; 23.2 seconds |

The Docker runs selected existing coordinated 0.1.22 images built from source
`401bc39cb0e1ca399056e00c72598cefde9eeb87`, not rebuilt images containing the new
guide text. They verify the changed Compose topology with the current locally
packed/installed host fleet/fleetd. Current guide bytes were separately compiled
and compared across Node, C# and Rust. No new image publication is implied.

Each backend used the same assertions: matching release identities, new-volume
initialization and overwrite rejection, one-shot Knex migration, only the server
running, real management/Matrix/browser access, explicit enrollment approval,
private host controller authentication, publication cookie/storage isolation,
exact separate native histories, controller restart and deliberate stop retention.
The host used Codex 0.163.0 and an inert local provider; setup and idle restoration
made zero model calls. This does not certify provider entitlement or macOS.

The management test exercised administrator/member flows and 1920/390-pixel
layouts using the current shared React build. Guide comparison cases covered
loopback/HTTPS origins, quoted owner names and Unicode administrator instructions.
The modified complete shared external bank was compiled but not rerun in full;
this change used the focused existing tests above rather than a full release gate.

An initial focused run exposed missing regenerated fixture prerequisites after
cleanup: the pinned Conduit image and the suite's temporary parent directory.
They were prepared and the complete focused selection then passed unchanged.
Docker/test descendants ran under verified finite aggregate resource limits.
Disposable fixtures and build output were removed after their last use.
