# Outside review corrections

Baseline: fe3e154f604d0abb9abd3c7a260c925a0a4a734f.
Scope: Node and C# Crossfire, fleetd and Fleet. Rust, deployment projects,
production state and package publication are excluded.

| ID | Finding | Change |
| --- | --- | --- |
| CF-001 | Abandoned containers blocked replacement | Cross-language lifetime lock; inspect both names; validate all ownership before stopping; exact-ID stop/removal before backup/migration |
| CF-002 | Pagination differed between implementations | One canonical positive-decimal rule; shared boundary cases and consistent one-page empty metadata |
| CF-003 | Proxied users shared the public quota | Explicit trusted immediate-peer IPs, one overwritten client header, independent client and aggregate budgets; remove Node's internal management proxy hop |
| CF-004 | Common tests did not establish successful API/UI behavior | Successful canonical-output coverage for every REST declaration; per-route malformed-query checks; expanded shared UI and real-container recovery cases |
| CF-005 | Guides had stale links and overbroad claims | Rewrite current guides by responsibility; local-link gate; separate contracts, procedures, historical results and evidence limits |

## Verification record

Verification uses Linux x64, finite 32 GiB aggregate memory, zero swap and 8192
tasks. Independent Node files use 24 workers. Selected products are Node,
C# managed and actual C# NativeAOT; native runtime scenarios use Codex and Pi
with inert providers. Rust and paid providers are not selected.

| Check | Result |
| --- | --- |
| Architecture, imports, package installation and documentation | Pass; 54 current Markdown files have valid checked local targets |
| Complete Node suite | 881 tests across 193 isolated files; zero failures/cancellations |
| C# core | 5149 assertions in each managed/NativeAOT mode |
| C# controller ownership | 28 assertions in each mode |
| C# actual native runtime transport | 517 assertions in each mode |
| Calendar differential cases | 2072 in each mode |
| SQLite and file-lock interchange | All six Node/managed/NativeAOT directions; forced owner exit included |
| Forward conversion/rollback | 16 historical-schema and unsupported-version cases, plus actual Conduit authority in both modes |
| Standalone distribution | All three products built in managed and NativeAOT forms; build-only tools excluded |
| Shared installed products | 51 reported tests per target; zero failures/cancellations/skips |
| Actual containers | 82 reported tests; all three implementations, shared SQLite, Element/media, management and operator recovery |
| Final targeted owner checks | Architecture/package checks repeated; 11 operator/Knex tests pass |
| Actual Knex container | Fresh, schema-13 and schema-17 stores pass; schema 18 is refused |

The integrated coordinator at `/tmp/crossfire-outside-fixes-20261015c` passes its
first eight phases. Its ninth phase stops before migration execution because
the verification script still imports `ownedDocker` from its superseded module.
That caller is corrected to use `container-lifecycle`; no alias is restored.
Only this verification import changes after the product/container banks.
Architecture, the affected operator/Knex tests and the complete actual migration
container check are then rerun successfully. The full coordinator is not rerun
after that isolated verification-script correction; its original nonzero result
is retained rather than rewritten as a green run.

Final focused execution exits zero. Its log is
`/tmp/crossfire-outside-fixes-final-20261015.log`. The integrated evidence directory
retains phase logs, per-file Node results, installed-contract logs, distribution
manifests and exact image IDs. Test counts include nested test groups and are
not a count of distinct supported features.

Earlier attempts caught package links escaping published archives and an old
C# acceptance case still expecting binary/octal pagination. The guides are fixed;
the acceptance case now tests canonical decimal success and explicit rejection
of both noncanonical forms. Assertions/gates are not removed or relaxed.

## Documentation

Forty-eight current technical documents are rewritten, including the specification,
product/package guides, operations, configuration, database, runtime, reports,
retention and developer verification instructions. A shared scenario inventory
is added. Functional AGENTS/installed skill instructions and dated historical
records retain their existing ownership. Exact wire/schema definitions remain
code-owned instead of being duplicated as handwritten tables.

Current inline local-document targets are checked during structure verification.
Published-package tests also verify that package-local guide links stay within
the archive. Source-only cross-product links use repository URLs. The local-link
check does not validate remote availability or heading fragments.

## Limits and release state

Previous baseline green results remain historical observations. They did not
include the failure cases above. No claim of zero flakiness, arbitrary EF AOT
safety, paid-provider quality or every possible crash boundary follows from them.

The .NET 11/EF preview pins remain unchanged. Native distribution publication
emits 1007 visible IL diagnostics. Fixed owned queries execute in AOT tests;
that does not establish arbitrary reflected-query safety. Migration-orphan tests
represent abandoned native-container states, not every interrupted Knex statement.

No external dependency pin or package version changes. This change does not
modify production data, deploy services or publish packages. It is prepared on
`fix/outside-review-and-documentation-20261015` for manual PR creation.
Generated test/build resources are removed after their last use; concise evidence
is retained separately. Shared dependencies and other worktrees are preserved.

Cleanup removes 87 generated directories containing 49650 files, approximately
3.65 GiB allocated, and seven exact task image tags. It does not prune shared
Docker parents or dependency caches. No test process/container remains active.
