# Diagnostics

```sh
fleet --root /absolute/private/controller diagnose
fleet --root /absolute/private/controller diagnose research
fleet --root /absolute/private/controller agent diagnose research analyst-west
fleet --remote office diagnose research
```

The default scope is the selected controller. A fleet key or UUID selects a
registered fleet. Agent scope requires its fleet and immutable instance key.
Node, C# managed/NativeAOT and Rust implement these same commands and reports.

The command writes one JSON report to stdout. Checks have stable IDs, scope,
`pass`, `fail`, `unknown` or `not-applicable`, an observation timestamp, a safe
explanation and optional action. `checkedAt` is when inspection began, not a claim
that every underlying observation is current. A null observation timestamp means
no observation is available. Failed checks produce exit code 1; unknown checks
remain explicit and do not certify readiness. Syntax and missing-scope errors
also produce exit code 1.

Controller checks cover authenticated API access, shutdown and logging. Fleet
checks cover readable configuration, the controller's current crossfire connection
and confirmed delivery intent. Agent checks cover desired activation, listener,
retained-history observation, native state, provider metadata, pending input and
owner decisions. A connection observation is not a fresh messaging-backend health probe.
A retained binding is not fresh proof that every native history file is intact.

Working, sleeping, deliberately stopped and waiting for an owner decision are
ordinary states. Paused delivery is reported as intentional, not a process crash.
Pending input means delivery has not yet been confirmed; diagnostics does not
resubmit or acknowledge it. Open the owner DM to answer pending decisions.

Provider inspection uses only existing owned native connections. Codex uses
`account/read` with `refreshToken: false`. Pi reads its selected model and available
model metadata. A present account/model does not prove credential validity or a
successful inference. Providers that require no OpenAI account are distinguished
from a missing required account. Sleeping/stopped agents are not awakened merely
to inspect credentials.

The authenticated fleetd API bounds scoped diagnostics to 20 seconds, at most four
concurrent native probes and five seconds per probe. The CLI bounds its transport
and inspection work to 30 seconds. Timed-out or unavailable observations are
unknown; they cannot silently become successful checks.

If authentication is absent or the controller cannot be reached, the CLI returns
a partial report. It never initializes configuration, reads private daemon state
as an alternative authority, trusts a new SSH host, starts fleetd, resumes agents,
refreshes credentials, changes histories or submits model work. Unreachable does
not establish whether a process crashed or why it stopped. Read logs and inspect
the selected host before an explicit repair.

`fleet test FLEET` remains a separate, fail-fast readiness assertion. It is not
the all-findings diagnostic report. Diagnosis never invokes readiness or recovery.

- [Controller diagnostic ownership](https://github.com/control-flow-project/ctlflow/blob/main/services/fleetd/docs/diagnostics.md)
- [Operations and recovery](operations.md)
