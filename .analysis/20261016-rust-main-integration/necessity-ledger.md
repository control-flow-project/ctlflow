# Main a9c7c42 integration ledger

| Requirement | Owner and direct implementation | Verification |
| --- | --- | --- |
| Same transferable Docker package | Rust server container_package; common upstream exporter/manifest labels; no Node process inside Rust runtime | Exact-field/size/hash/platform/image/release rejection; actual export/import bank |
| No source build during activation | Rust operator removes source fingerprint/build/compile branches; only --package remains | Former options rejected; invalid packages cannot inspect/stop writers |
| Native image readiness | Rust container_health and native HTTP header probe; image-owned health command | Both paths, public Host, no redirects/body collection; actual image probe |
| Exact container disappearance | Rust lifecycle observes known immutable ID, handles removing, bounded 120-second observation | Fake native Docker transition/cancellation/error checks and actual orphan bank |
| Common calendar producer | assets/time-zones.json and upstream prepareTimeZones compile once; Rust adds source-derived catalogue metadata | Catalogue, pin checks and 2,072 calendar comparisons |
| Fleet setup independent of server language | Rust-generated guide from canonical Node contract | Generator byte check and shared actual Element setup assertions |
| Four-target build composition | Root packaging composes unchanged Node/C# producer with Rust-owned native builder; same exporter and migration image | Builder call/audit/staging unit tests plus actual package checks |
| Strict end-to-end TLS | Shared contract fixture owns a real authority and separate CA:FALSE/serverAuth leaf | OpenSSL verifies purpose/IP; unchanged native certificate verification and common installed assertions |
| Same operator CLI rule | Rust owning parser rejects duplicate options and noncanonical ASCII ports before acquiring the lock; configured defaults share the numeric bounds | Same shared operator module as the concurrent Node/C# work: five rebuilt-release checks; native default-port regression; no side effects for invalid input |

All Node/C# implementation paths remain byte-identical to main. The common
assertion TLS fixture is under product-owned tests/contracts, not an exception to
Rust TLS validation. Their old internal fixture remains their owner's finding.

Measured scope: Linux x64, actual Codex/Pi with inert providers, actual Conduit
and Docker. No paid-provider, all-platform, sustained-load or absolute reliability
claim. No deployment, registry publication or production data changes.

Source fingerprint finding for the main session: upstream containerSourceDigest
does not include the root Cargo manifests/toolchain. Rust's build verifies those
bytes did not change during packaging, and immutable archive/image IDs cover the
result. Extending the canonical Node-owned fingerprint input list is excluded
from this fork; it is not silently patched or represented as already corrected.

## Shared-session parser findings

The owner reports the C#/Node session is addressing SYM-001 (repeated operator
options) and SYM-002 (hexadecimal/scientific port strings). Rust already rejects
both at the owning operator boundary. Add direct regressions before final review
and inspect their final common grammar rather than inventing Rust-specific
handling for signs, whitespace, leading zeros or inline option syntax.
The current actual-image run consumes frozen source; do not modify it mid-build.

Read-only inspection of their active fix/operator-cli-symmetry-20261016 branch
now establishes the chosen rule: four/five ASCII digits, first digit nonzero,
numeric 1024..65535. Rust rejects duplicate/hex/exponent already, but its native
u16 parser still admits plus signs and leading zeros. Replace that owning parser
after the current frozen-source package run, and test the complete common rule.
No uncommitted Node/C# product work is copied or edited. The implementation-neutral
operator assertion module is identical to their reviewed shared test, not a
second target-specific expectation set. The generated timezone check now derives
its version from the sole common pin rather than retaining another version literal.
