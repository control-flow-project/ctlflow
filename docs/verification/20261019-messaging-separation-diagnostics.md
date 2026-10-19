# Messaging backend separation and diagnostics verification

## Scope and result

The local Node, managed C#, NativeAOT C# and Rust implementations pass the
verification recorded here on 19 October 2026. The reviewed change covers
messaging backend ownership, read-only controller diagnostics, the current
SQLite schema, shared management UI and their packaging and test contracts.
One parent session performed the implementation, review and integration; no
subagents were used.

The feature branch is `feat/backend-separation-diagnostics-20261019`, based on
`a332eacca4830f7c495e6f6059c51b1f9f76fdc3`. Source and package metadata use
`0.1.23`. These are locally verified packages, not a published release. No
deployment, registry publication, production data operation, GAAP access or
Turbine access is part of this verification.

## Architecture review

| Area | Current owner and verification |
| --- | --- |
| Identity and authorization | Domain records use backend user IDs, neutral grants, delegation, provenance and revisions. Native identifier parsing and authority calculations belong to the selected messaging adapter. |
| Messages and history | Messaging clients normalize events, structured mentions, edits, attachments, receipts and history before listener admission. The listener does not interpret native event attributes. |
| Accounts and public HTTP | The Matrix adapter owns native authentication, registration, invitations, directory integration, public routes, Element configuration and Conduit bootstrap. Composition roots select the implemented backend. |
| Management UI | One React application uses backend descriptions and neutral contracts. Authentication requires the exact configured public origin. The same browser assertions run against all four server targets. |
| Native execution | fleetd owns lifecycle and runtime adapters. Per-room serialization belongs to the runtime adapter. crossfire does not start or terminate native processes. |
| Persistence | Tinqer, EF and Diesel consume the same SQLite schema and files. Knex alone initializes the schema. Application queries remain with their ORM owner; schema/control SQL retains its explicitly approved scope. |
| Diagnostics | The authenticated fleetd API and fleet CLI inspect current observations and bounded native provider metadata without starting, resuming, interrupting, answering or settling work. |
| Structure | Node, C# and Rust retain matching service and semantic package owners. Shared assets remain shared; no application-source reach-through or second UI is introduced. |

Structural checks reject protocol references in generic domain, kernel,
contracts, listener, HTTP/client/controller and UI owners. Independent fixtures
exercise non-Matrix-shaped identities and rooms, including `__proto__`,
`constructor` and `control`, with structured opaque access parameters. These
supplement real Matrix integration; they do not implement Slack or Zulip.

Room/event identity is room-scoped. Blocked-mention notice persistence,
publication and retention use the receiver, room and event together. Native
transaction identities include the same room identity with unambiguous
separators. Cooldown remains receiver/sender-scoped across rooms.

Private native history contexts use `shared` or `control`; a room context is
`room/` followed by the exact opaque room ID. An actual room called `control`
therefore cannot select private history. Routed events keep their real room ID.

The backend HTTP proxy uses the backend hostname for TLS SNI while retaining
the public Host header. It strips cookies, Set-Cookie, hop-by-hop and untrusted
forwarding headers, and refuses redirects. Local TLS/ingress and actual browser
checks cover this boundary.

There is one current implementation per selected language/backend. Superseded
handlers, historical migration inputs, state converters and alternate readers
are removed rather than retained behind flags or aliases. The current database
starts with `00_initial.mjs`: 63 application tables, 111 foreign keys, 94 indexes
and 26 triggers, application ID 1129465426 and schema version 1. Startup does not
erase data or attempt an older-schema runtime path. This review made no change
to an existing deployment's database.

## Diagnostics behavior

`fleet diagnose` uses the same authenticated controller contract in every
implementation. Reports distinguish passing, failing, unknown and inapplicable
findings. They separate current native observations from previously reported
history availability. A retained binding is not reported as revalidated files.

The controller allows at most four concurrent native inspections, five seconds
per inspection and twenty seconds for the native inspection phase. The CLI has
an overall thirty-second bound. An unavailable controller does not trigger
startup or configuration creation. Native inspection does not refresh
credentials or invoke a model. Reports omit credentials, account identifiers,
machine paths and raw upstream exceptions. Provider metadata being present is
not proof that a paid inference request would succeed.

## General invitation review

The shared installed-product suite verifies this flow against each target:

1. A human invites an agent into a room; the agent accepts that invitation.
2. The agent can add a same-owner or cross-owner collaborator only when both
   Crossfire delegation and native room authority permit it.
3. Raising the native invitation requirement refuses the operation. Removing
   Crossfire delegation also refuses it. Wake/chat authorization does not
   override either check.
4. Restoring the required authority permits removal of the agent's own
   recorded additions, including actual native departure.
5. The agent cannot take over or remove a collaborator added by a human.

Room membership by itself is not invitation authority. These checks establish
the general permission behavior, not the cause of a particular live user's
reported refusal. No live room or agent was inspected or changed.

## Corrections found during verification

| Defect | Direct correction and regression coverage |
| --- | --- |
| An observation in another room invalidated an already-completed room's work check | Replace the global work revision with per-context revisions and exact context/session/generation checks. Controlled cross-room inspection regressions cover all implementations. |
| A terminal controller operation was visible before its active slot was released | Finish cleanup, release the exact predecessor and persist its terminal result in one admission section. A controlled subscriber immediately submits the successor without retry. Persistence failure closes further admission. |
| Blocked-mention notices assumed event IDs were globally unique | Include the room in repository keys, publication and retention. Regressions reuse one event ID across rooms and preserve a pending sibling notice during retirement. |
| Receipt acknowledgment could complete before retained room histories initialized | Require the existing logical owner's full readiness before acknowledging nonempty receipts. Controlled initialization barriers reproduce the old failure; the shared per-room resume scenarios now settle correctly. |
| Cancelling a delivery receipt during pause was classified as a transport failure | Check caller cancellation before disconnecting reporting. Controlled C# and Rust regressions first failed, then passed; the same receipt remains retryable and its owner question remains answerable. Node's existing ordering is preserved and tested. |
| C# route dispatch repeatedly parsed immutable templates and allocated captures for failed matches | Parse templates/public authority once, split the path once and allocate captures after a complete match. No query, response structure, authorization rule or performance limit changes. |
| Native wire and browser fixtures retained replaced assumptions | Correct the C# setup prefix, Rust preview field, bounded Codex trust-menu interaction and current login selector. Assertions and product deadlines remain unchanged. |

Earlier failing runs remain failed evidence. In particular, the first actual
container run used the removed `Matrix username` label. Only that fixture
selector changed after the accepted full language, shared-contract and
performance runs; the complete actual container bank was then rerun and passed.
No product source changed between those accepted runs and this report.

## Verification results

The host is Linux x86-64 with 24 available CPU workers. Coordinators run in
verified aggregate limits of 16 GiB memory, zero swap and 8192 tasks; Rust's
coordinator retains its stricter 2048-task limit. .NET uses
`11.0.100-rc.2.26504.105`; Rust uses `1.98.1`. Native tests launch actual Codex
and Pi processes against inert local providers, not production model accounts.

| Gate | Accepted result | Command elapsed time |
| --- | --- | --- |
| Node/React typecheck | Pass | 8.854 s |
| Node/shared asset build | Pass | 9.557 s |
| Full Node suite | 978 tests, 214 files, 24 workers; zero failures, cancellations, skips or todos | 2 min 29.349 s |
| Architecture, installation and structure | 33 tests pass | 12.434 s |
| C# core and runtime | Managed: 5,321 core assertions; NativeAOT: 5,300. Both: 98 storage, 85 controller and 584 runtime assertions, plus actual Conduit and interchange checks | 9 min 52.164 s |
| Rust | 290 tests across 141 binaries; formatting, Clippy, generators and native integration pass | 38.726 s |
| Managed distribution | Published to a local directory and exercised | 1 min 54.376 s |
| NativeAOT distribution | Published to a local directory and exercised with dynamic code disabled | 4 min 44.991 s |
| Rust distribution | Built to a local directory and exercised | 2 min 31.990 s |
| Shared installed contracts | 115 reported tests per target; all four targets pass with no skipped or unfinished cases | 9 min 23.417 s |
| Fresh performance comparison | 96 measurements, 24 comparisons, zero request errors; pass | 5 min 1.837 s |
| Actual container contracts | 34 reported tests per target; all four targets pass with no skipped or unfinished cases | 6 min 17.123 s |
| Actual Knex migration container | Initial creation and repeat execution pass; current identity, integrity and foreign keys checked | 2.383 s |

Times are command wall times, not parent attention time or summed parallel
worker time. Reported test counts include nested test contexts; they are not a
count of unique business scenarios. Internal language-specific assertions
supplement the identical external contract bank.

The shared bank covers successful decoded REST operations, authentication and
authorization, actual Codex/Pi decisions and interruption, stop/resume/recovery,
room-scoped histories, read-only diagnostics, CLI/controller interoperability,
management UI and TLS ingress. Browser scenarios run at 390 and 1440 pixels.
All 16 ordered CLI/controller pairs and all 16 ordered operator/container
implementation pairs are exercised.

Container checks include Element login, public-room access, exact media bytes,
the shared management UI, transferred packages, corruption/ownership refusal,
concurrent starts, killed launchers and abandoned runtime/migration containers.
These are actual local Docker images and processes, not mocked Docker commands.
The accepted container source digest is
`c27180fead21b28a175bc2c9d11b705269428a755332ba5c42616b7a57580783`.

Same-file SQLite, state ownership and journal checks run across implementations;
calendar differential checks cover 2,072 cases. The migration container excludes
compilers, tests, Element and Conduit and can initialize/reopen the current
database with networking disabled.

All 121 external npm dependency records remain unchanged from the base.
Only `@ctlflow/fleet` and `@ctlflow/fleetd` are publishable npm workspaces.
Private notes, test databases, native homes, images, package archives and build
output are not release source or committed verification evidence.

## Performance measurements

The fresh run completed at `2026-10-19T10:23:33.989Z`, with four rotated rounds
against a fixture containing 50 agents, 50,000 listener runs and 50,000 runtime
observations. Values below are median / p95 HTTP milliseconds, rounded for
display. The offline HTML and JSON retain unrounded samples and comparisons.

| Workload | Node | Managed C# | NativeAOT C# | Rust |
| --- | ---: | ---: | ---: | ---: |
| Session | 2.049 / 2.821 | 1.554 / 1.967 | 1.350 / 1.605 | 0.582 / 0.765 |
| Policy | 2.409 / 3.074 | 1.777 / 2.432 | 1.602 / 1.941 | 0.728 / 0.841 |
| Agent directory | 49.000 / 74.229 | 17.119 / 24.456 | 15.602 / 21.636 | 29.554 / 45.618 |
| Fleet directory | 66.947 / 97.528 | 12.855 / 18.611 | 12.417 / 17.776 | 34.638 / 55.129 |
| Saved observations | 2.585 / 3.567 | 2.697 / 3.417 | 2.458 / 3.097 | 0.734 / 0.918 |
| Concurrent UI reads and heartbeats | 376.784 / 657.578 | 25.291 / 154.065 | 25.458 / 153.579 | 220.376 / 529.422 |

Only managed C#'s saved-observation median uses the existing approved exception:
1.043465 times Node, below the approved 1.30 ceiling. That workload's p95 and
throughput meet the unmodified Node comparison; its throughput is 1.0333 times
Node. All other comparisons, including NativeAOT and Rust, pass strict limits.
No threshold was changed for this run. These measurements are not browser-paint
times, paid-provider benchmarks or a general production-capacity guarantee.

## Remaining boundaries

After the accepted runs, owned test fixtures, native test homes, generated
distributions, Node build output, C# bin/obj output and Rust target output were
removed. The dedicated test Docker engine's images/cache were pruned and that
engine was stopped. Concise logs, summaries and the offline performance report
remain local; source, credentials and user histories were not cleanup targets.

Matrix is the implemented messaging backend. An additional channel requires its
own adapter and channel-specific verification, not a claim of existing support.
Claude remains unimplemented. Pi's explicit lack of live TUI attachment remains
a checked native capability refusal rather than an alternate writer.

The Linux x86-64 artifacts and containers were executed here; this run does not
establish macOS, Windows or ARM execution. .NET 11 RC2 and EF NativeAOT remain
preview dependencies. Their trim/AOT diagnostics are visible in the build logs;
passing these cases does not certify every future EF query shape. No paid model,
live deployment, arbitrary power-loss boundary or perpetual agent availability
is certified by this local suite.

- [Messaging architecture](../architecture/messaging-backends.md)
- [Shared executable contracts](shared-contracts.md)
- [Performance method and tolerances](performance.md)
- [Database ownership](../../services/crossfire/database/README.md)
