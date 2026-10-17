# Operator checks

Reusable checks belong to crossfire/fleetd. Site hosts, branding, TLS, owners,
fleets and release expectations are explicit inputs.
These tools are not another deployment or lifecycle implementation.

## Owners

| Location | Responsibility |
| --- | --- |
| crossfire node/packages/operator-support | Private evidence, argument parsing, bounded HTTP/process reads and pagination |
| crossfire node/tools | API, browser, releases, database, files, host and reviewed policy checks |
| fleetd node/tools | Existing controller bindings, native settings and preservation |
| fleet CLI | Setup, stop/resume, update, reset and retirement |

- [crossfire command/input reference](../services/crossfire/node/tools/README.md)
- [fleetd command/input reference](../services/fleetd/node/tools/README.md)
- [Script inventory](operator-script-inventory.md)

## Procedure

1. Build the selected source using normal bounded development commands.
2. Record exact host, owner, fleet, release, revision and persistent paths.
3. Create private owned input/evidence files outside Git.
4. Run read-only checks first.
5. For an authorized mutation, verify backup and review the exact plan/revisions.
6. Apply through the existing product operation and verify resulting state.

Authentication checks may create normal login/audit records.
Read-only does not mean no server activity.
Reports are typed/allowlisted and must not dump tokens, native connection secrets
or raw database rows. Screenshots and native IDs/paths remain private evidence.

## Preservation

Compare consistent snapshots, not lossy count reports.
Retain exact existing identities, credentials, context IDs, grants, receipts and
desired/stopped selections. Appended records are allowed only under the selected
check's documented rules. Logging expiry requires the actual configured policy
and exact cleanup time; it never excuses changed survivors or lost authority.

A file hash establishes byte equality, not provider behavior, document correctness
or restorable backup semantics. Archive listing is not safe extraction proof.
A reachable controller is not a currently working model.

Production resets, broad process killing, guessed native ownership and silent
software download are not operator-check capabilities.
Mutating regressions use isolated fixtures. Provider execution requires the
separate explicit acceptance command and its budgets.

- [Development resource limits](development.md)
- [Deployment operations](../services/crossfire/docs/operations.md)
