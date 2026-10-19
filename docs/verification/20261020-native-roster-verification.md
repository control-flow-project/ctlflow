# Fleet roster verification — 2026-10-20

## Defect and correction

The Node operator compared parsed TOML instances against controller JSON with
prototype-sensitive deep equality. The pinned TOML parser produces
null-prototype `runtime_options` tables; JSON produces ordinary objects.
Seven instance overrides had identical fields and values but were rejected.
Agent execution was unaffected.

The roster comparison now skips prototype comparison, retaining exact field/value
comparison. Rejections identify the instance key. The regression uses an actual
TOML override and JSON transport, checks the effective effort passed to native
inspection, and still rejects an actual effort change. Existing identity, skill,
workspace, provider and read-only-operation assertions remain.

## Verification

- The regression reproduced the live defect: two tests passed and one failed.
- After correction, all three operator tests passed without skips or failures.
- fleetd typecheck/build and repository structure/documentation checks passed.
- The corrected read-only tool checked all 93 live Bad Bets instances: exact
  roster, authenticated histories, configured models/efforts and ancestor skills.
  All histories were initially idle with zero turns and no joined rooms.
- Native listener readiness accepted the complete enabled roster.

The roster has 89 Sol and four Luna instances: 81 max, one high and 11 medium.
Inspection made no model calls or session/configuration changes. Subsequent
consumer delivery checks are recorded by the deployment repositories; these
checks do not certify arbitrary future provider responses or analytical claims.

This changes only the shared Node operator, not servers, controllers, adapters,
wire contracts or databases. No C# or Rust representation change is needed.
The rebuilt fleetd executable and native guard are byte-identical to their
published 0.1.23 counterparts. No npm republication or running binary patch was
required. The earlier full product gates were not rerun for this isolated tool fix.
