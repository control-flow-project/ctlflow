# Agent working agreement

`AGENTS.md` and `CLAUDE.md` are synchronized mirrors. Update both in the same
change whenever this agreement changes.

## Context-compaction checkpoint

After every context compaction, interruption, resume, or handoff, stop before
using tools or changing files and re-establish the active context from the
newest user request and retained summary.

The checkpoint must:

1. Confirm that the active project is CtlFlow at
   `/home/jeswin/repos/control-flow-project/ctlflow`.
2. Confirm the repository root, current branch, worktree state, target task,
   and relevant active processes.
3. Reject stale tasks or paths inherited from an older context.
4. State the current target before the first post-compaction edit.

Scuffle is frozen and is not an active project. Do not read, modify, run,
reset, or otherwise operate on Scuffle unless the user explicitly reactivates
it in a new request. Never infer Scuffle work from a stale summary or working
directory.

## Approved-scope discipline

Never go on sidequests. Implement only the explicitly approved domain and API
surface. Audit, telemetry, authentication, authorization, persistence,
migrations, health, readiness, and tests must support that surface, but may not
expand it.

Do not invent or add an RPC, route, table, stream, watch, journal, queue,
worker, cache, state machine, compatibility path, orchestration mechanism, or
future-facing extension unless the user has explicitly approved it. Being
useful, conventional, Kubernetes-compatible, production-grade, or potentially
needed later is not approval. Keep specifications minimal and normative. When
an unapproved capability appears valuable, explain it briefly and wait for an
explicit decision before specifying or implementing it.

## Conformance and completion discipline

A simplification is complete only when it has been propagated through every
affected specification, contract, implementation, migration, deployment
artifact, fixture, test, and evidence inventory. Search for and remove the
superseded concepts everywhere. A locally simplified API on top of stale
cross-cutting requirements or harness assumptions is not complete.

Before implementation, reconcile all contradictory or impossible requirements.
Stop rather than choosing an undocumented interpretation. Before declaring
completion, map every remaining normative requirement to its implementation and
direct test or release evidence, then perform a fresh independent conformance
review of the final tree.

Green tests prove conformance only when the tests exercise the normative
production architecture. A test stub, transport, identity path, deployment, or
runtime selector may not replace production behavior with a weaker shortcut
and then assert that shortcut as the expected contract. Passing self-consistent
tests is not completion when the tests and implementation drift together.

Completion claims must cover the approved API plus its required authentication,
authorization, transport, audit, telemetry, persistence, deployment, and
runtime-neutral test boundaries. Run all required gates after the final change;
do not reuse results from an earlier source state.

## Failure-derived operating rules

Work serially. Do not spawn agents, run concurrent workers, or fan work out
unless the user explicitly approves one specific bounded split. A previous
approval does not carry forward.

Before implementation, write down the exact approved acceptance inventory for
the current target. Treat phrases such as "airplane grade", "complete", and
"production ready" as requirements for rigor on that inventory, never as
permission to add unapproved features. Finish the current service before
starting another service.

When the user removes or simplifies a concept, treat removal as a repository-wide
operation. Search specifications, proto descriptors, source, migrations,
deployment assets, fixtures, generated artifacts, tests, and evidence manifests
for both names and structural remnants. Do not declare the simplification done
until those searches and a fresh spec-to-code review are clean.

When the service being implemented calls a dependency whose full implementation
does not yet exist, create a deterministic static stub inside that dependency's
own service project. The stub is a real, separately running process that
implements exactly the needed production contract and is reached through the
same network transport, generated client, identity, authentication, and
authorization channel that the completed dependency will use. It may return
hard-coded valid data, but the caller must receive and process that response
through the real wire call without knowing that the callee is a stub.

Keep a dependency stub limited to the operations required by the current
implemented service. Never put the substitute in the caller, canonical test
suite, or mesh; bypass the RPC; share in-process state; weaken transport or
identity; or add a caller-side stub branch. When the dependency is implemented,
replace its stub outright. The caller and its integration tests continue over
the same contract and channel; no fallback, compatibility path, or dual
implementation remains.

Keep integration tests ordinary and fast. Share expensive immutable setup such
as cluster creation and NativeAOT publication across the suite, cache build
artifacts by source revision, and isolate only mutable per-test state. Do not
repeat environment startup per test file or add custom scenario/evidence
ceremony where direct tests and assertions suffice.

Every reported gate result must identify and test the current source state.
After the final edit, rerun the affected build, canonical integration suite,
release/container verification, generated-artifact drift checks, and spec
build. Never report an earlier green run as evidence for later code.

Put disposable local artifacts only under the gitignored `.temp/` tree. Do not
delete repositories, branches, user work, or approval-requiring artifacts while
the user is unavailable; record the cleanup item and continue non-destructively.
