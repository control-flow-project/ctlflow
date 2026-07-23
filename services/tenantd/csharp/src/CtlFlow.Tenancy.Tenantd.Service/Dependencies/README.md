# Lifecycle dependency placeholder

This directory will own typed outbound adapters used by committed Tenant and
Workspace lifecycle steps:

- `identityd` for initial administrators and memberships;
- `configd` for configuration scopes;
- `execd` for canonical Placements; and
- `pkgd` for explicitly requested baseline Apps.

Each adapter uses the callee-owned generated contract, bounded pooled transport,
workload authentication, invocation propagation where applicable, W3C trace
propagation, and explicit failure mapping. No broad dependency client or
service locator is permitted.
