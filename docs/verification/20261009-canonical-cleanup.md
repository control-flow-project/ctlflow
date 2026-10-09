# Canonical cleanup and exact native settings

## Scope

The owner approved the complete monorepo architecture audit on 9 October 2026.
This change includes the pending explicit handoffs and per-instance native
settings. Crossfire owns coordination and Matrix boundaries; fleetd owns native
lifecycle and the shared listener; fleet owns local/SSH commands. No deployment
project or Bad Bets source belongs to this change.

## Findings and owning replacements

| Finding | Replacement | Owning layer |
|---|---|---|
| Independent agent labels can conceal name collisions | One registered name and derived `name (owner)` label; agent profile renaming rejected | Identity domain, current schema, Matrix HTTP boundary |
| A roster collision discovered after preflight admits peers | Authoritative transaction admits or rejects the whole roster before creating requests, identities or claims | Enrollment domain and transactional repositories |
| Later approval, exchange and UI still accept partially failed rosters | Current items contain only admitted claims or authenticated existing identities; partial historical requests move intact to immutable archives | Enrollment contracts, domain, schema conversion and UI |
| Operators check model support but normal execution does not | One native capability admission resolves explicit and native defaults and rejects unavailable exact settings | Codex runtime adapter |
| Shared role settings prevent fast/high instances of one role | Explicit top-level instance options override role defaults across validation, inspection and lifecycle operations | Fleet contracts/domain/storage and runtime adapter |
| Printed or quoted names do not direct handoffs | Repeatable `--mention-user` writes exact native `m.mentions.user_ids`; quoted names remain ordinary text | Agent tool CLI and Matrix message adapter |
| Attach-only initialization is a competing runtime path | Owned create/resume initialization only; retained native TUI attachment is a separate supported inspection capability | Codex runtime adapter and its fixtures |
| Shared and room histories use competing metadata families | One unique context-to-UUID registry and context-derived receipts | Codex persistence adapter |
| Invalid retained journals appear transient | Typed permanent failures preserve exact evidence; no reset, replay or recovery loop | Journal, observation and decision owners |
| Fixtures retain databases/workspaces after process cleanup | Reverse-acquisition cleanup removes owned directories after owned processes/handles | Product test fixtures and architecture gate |
| IPC tests observe marker existence before completed writes | Atomic marker publication with unchanged exact-content assertions | Native runtime fixture |
| Idle waits retain an in-flight acquisition flag | Release acquisition ownership before idle/debounce waits; unread queries still reject actual concurrent settlement | Shared listener |
| Ordinary admission can use a renewed cancellation signal after steering | Fence ordinary acquisition/publication at admission against retained urgent control; priority input never queues behind ordinary receipts | Shared listener |
| Receipt verification can wait for polling despite a native input notification | Native user-item notifications wake exact timeline verification; they never substitute for retained receipt evidence | Codex runtime adapter |
| Element sends ambient host cookies on native profile writes | Ignore cookies at the Matrix bearer-only profile boundary; reject cookie-only authentication and foreign origins | Matrix HTTP boundary |
| Native initialization reports an obsolete client version | Version comes from coordinated owned package metadata | Native protocol composition |
| Acquiring a receipt lock creates a disk journal mistaken for context metadata | Private lock-only SQLite transactions use a verified in-memory journal; native exclusive ownership remains authoritative | Filesystem lock owner |
| The Activity API treats a system-job correlation as an entity UUID | Audit correlations use one bounded opaque-text contract; HTTP envelope and entity identities remain UUID-only | Audit response contract and specification |

## Preservation and removed paths

Schema 15 is the single current application schema. Verified schemas 13 and 14
advance transactionally; retired non-null display overrides are recorded in
system audit before their column is removed. Original accounts, registered names,
revisions, room access, credentials and audit records remain protected. Fresh
stores initialize the current schema directly. There is no display-label alias,
per-instance collision suffix or second identity writer.

Prior partial enrollment requests, all roster items, requested policies, senders,
permissions and controller metadata move intact into the existing immutable
history relations. Their original outcomes remain historical evidence, never a
current runtime path. Existing fleet/controller credentials and identities are
unchanged. Remaining complete requests keep their exact identifiers and claims;
current enrollment storage and contracts reject per-item failure forms.

The explicit native context conversion requires stopped ownership and a verified
backup. It validates exact finite inputs, preserves original bytes in a private
archive and records an interruption-recoverable manifest. Receipt binding and
UUID evidence cannot be redirected to credentials or unrelated state. Current
readers reject old metadata; they never perform implicit conversion. This is a
forward storage migration, not backward runtime compatibility.

Code paths for individual non-fleet agents, unsupported Claude/Pi implementations,
native conversation adoption and private npm publication remain absent. Only
`@ctlflow/fleet` and `@ctlflow/fleetd` can be published. External dependency records
are not changed by coordinated owned-package metadata updates.

The 0.1.14 packages were published and anonymously installed with byte-exact
executable verification. Real fleet rollout then refused unknown metadata before
converting any contexts: SQLite creates a temporary disk rollback journal while
acquiring an exclusive receipt lock. This was reproduced with the native lock
implementation. The correct owning fix uses a verified in-memory journal for
lock-only databases; it does not add an ignore rule to the converter. Retained
receipt locks are now present in migration fixtures, and the process-lock test
checks absence of disk sidecars alongside suspension, death and inode ownership.
Prepared conversion manifests must also enumerate every retained obsolete record
before publishing or retiring anything; interrupted conversion tests use the
complete finite file set, including locks. A manifest omitting a retained record
is rejected without publishing a registry.
Published versions are immutable; the lock correction ships in 0.1.15. Its
production browser gate subsequently exposes the audit correlation defect below;
the complete corrected release is 0.1.16. All external dependency records remain
unchanged. Final gates and deployment evidence follow only after they complete.

The corrected 0.1.15 source passes all seven focused lock/conversion cases, then
the full typecheck/build, 767 Codex tests in 170 files on 24 workers, 33
architecture checks, four installation checks and complete container acceptance.
The same 24 GiB/zero-swap/8,192-task aggregate limits apply. The native lock test
retains suspension, death, ownership and inode assertions; migration rejects an
incomplete manifest before publishing anything. All 97 external dependency
records are byte-for-byte unchanged and all 27 owned manifests use 0.1.15.
The runtime container is `crossfire-runtime:a8972b07e32d76409519`.

Production 0.1.15 inspection verifies all 42 GAAP identities and context UUIDs,
42 provider-authentication fingerprints, 29 enabled agents and 13 deliberate
stops. All 168 installed artifacts match the release manifests. Native inspection
checks exact settings, authentication and project skills for 29 running histories
without model turns. Strict schema 14-to-15 preservation passes for 40 protected
relations, including all prior audit rows, accounts, credentials, grants and
retained publications. Docker provenance and rootless isolation also pass.

The first production management browser run fails on Activity: a preserved
system audit event has correlation `schema-15-agent-names`, while the API requires
this value to be an entity UUID. Audit correlation and identity are different
concepts. The current contract records bounded opaque correlation text unchanged
for every actor; audit entity IDs and HTTP envelope request IDs remain UUID-only.
The fix neither rewrites immutable evidence nor adds a system-only parser or
fallback. An actual HTTP regression checks both HTTP and system-job correlations,
exact retained bytes and rejection of empty, overlong/control-bearing values or
invalid entity IDs. Retained reports are deleted, not currently published; no
proof-only report is uploaded to claim a live-content check.

The first integrated 0.1.16 run has 767 passes and one setup-fixture failure:
the fixture applies a generic five-second polling window to the entire real
descriptor/controller/enrollment pipeline. Its focused rerun passes, but does
not certify the integrated source. Readiness now observes actual subprocess
output or termination, bounded by the fixture's existing 70-second CLI deadline
and 180-second test lifetime. All enrollment, identity, history, native readiness
and zero-model-call assertions remain; signal termination is also rejected.
Owned setup directories are disposed after their processes. The complete
parallel gates must pass again before release.

The corrected 0.1.16 product gate passes 768 tests in 170 files on all 24 workers
in 105,342 ms. Typecheck/build, 33 architecture checks, four installation checks
and complete container acceptance also pass on current source. Aggregate limits
remain 24 GiB, zero swap and 8,192 tasks. The final runtime image is
`crossfire-runtime:8c43d5c33b4d3574eab6`. All 97 external records remain unchanged;
all 27 owned manifests use 0.1.16 and only Fleet/Fleetd are public.

An earlier architecture run has one native-TUI startup observation failure.
Failure diagnostics now retain the last native pane and server output; assertions
and deadlines are unchanged. The failure does not reproduce across 12 subsequent
complete architecture runs, including the final packaging gate. This is recorded
as an unreproduced native observation, not a claimed root-cause fix or a guarantee
of arbitrary native availability. The installed managed runtime does not use
the TUI startup path. Logs retain both failed and successful runs.

## Verification boundaries

Focused admission, histories, interruption-safe migration, profile ownership,
atomic roster and preservation tests exercise the owning replacements. Full
integrated gates, package publication and production verification are recorded
here only after they actually complete. Passing inert-provider/native-protocol
tests are not paid-model certification or proof of arbitrary host availability.

The listener regressions pass 30 consecutive focused runs (360 cases): 86 enabled
bindings continue watching while ordinary budgets are saturated, a confirmed
ordinary receipt cannot hold replacement input behind an acquisition permit, and
non-steering membership checks cannot block harmless receipt checkpointing. All 22 native
receipt tests also pass, including immediate event-driven verification against
the exact retained timeline. Source remains frozen during the integrated release
gates; earlier partial gates do not certify the final source.

The initial 0.1.14 integrated release gate passes typecheck/build, 766 Codex tests in
170 files on all 24 available workers, 33 architecture checks, four installation
checks and container acceptance. Aggregate limits are 24 GiB memory, zero swap
and 8,192 tasks. Container checks include actual Element room creation, exact
authenticated attachment downloads, management/native routes, public artifacts,
orderly shutdown and persisted room preservation. All 97 external dependency
records remain unchanged; all 27 manifests use 0.1.14, with only Fleet and Fleetd
public. No assertion, deadline, runtime or worker gate was weakened.

Abruptly killing only fleetd may leave a native writer alive. Orderly shutdown
closes owned groups; exact-history resume rejects an active writer. No process
adoption, hidden supervisor or approximation is introduced. This limitation is
explicit, not a claim that crashes or response latency are impossible.

- [Current specification](../specification.md)
- [Native context conversion](../../services/fleetd/docs/storage.md)
- [Native lifetime and restart limitations](../../services/fleetd/docs/operations.md#abrupt-controller-death)
