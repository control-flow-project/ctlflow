---
title: policyd
weight: 50
---

`policyd` is the sole authority for whether an established Actor has one exact
capability on one canonical resource path. Resource owners enforce its decision;
`policyd` never reads or mutates the protected object.

## Ownership

`policyd` owns:

- Roles, which are named finite sets of allow rules;
- Role bindings from one Role to one principal or direct Group in one scope;
- direct access grants;
- the immutable operation-owner catalog; and
- the effective allow or deny decision.

`identityd` owns Users, virtual principals, Membership standing, and Groups.
Kubernetes authenticates workloads. A Membership, Group, Placement, network
path, or valid invocation token grants no capability by itself.

## Operations and paths

An operation token uses:

```text
<plural-resource>.<action>
```

Both parts are lower-case ASCII. Multiword actions use `_`. Operation tokens
are immutable declarations. The operation-owner catalog binds each token to the
exact kernel ServiceAccount or Package component allowed to enforce it. The
catalog is checked, versioned Policyd deployment configuration, not a mutable
API or caller field. Policyd loads it before readiness and rejects duplicate
tokens, unknown owners, or invalid path grammars. A request cannot declare or
replace the owner.

Resource paths are Unix-like absolute paths made from validated,
delimiter-safe IDs and fixed resource-kind segments. Empty segments, `.`, `..`,
NUL, ambiguous escaping, duplicate separators, and character-prefix matching
are rejected. A rule matches either one exact path or a delimiter-bounded
subtree.

Rules are allow-only. No matching rule is deny. There is no deny rule,
precedence algorithm, or allow produced by a broader identity or execution
boundary.

## CheckAccess

`policyd` exposes exactly one operation:

```text
CheckAccess
```

The request contains:

```text
operation
canonical resource path
target Tenant ID
optional target Workspace ID
```

The response contains one closed decision:

```text
allow
deny
```

Actor, subject account, and immediate caller never come from request fields.
The immediate caller is the authenticated Kubernetes workload. Actor and
subject account come from the required invocation JWT.

For every call, `policyd`:

1. authenticates the immediate workload and requires it to own the requested
   operation in the immutable operation-owner catalog;
2. independently validates the invocation JWT using
   `identityd.GetInvocationVerificationKeys`;
3. requires the request Tenant to equal the invocation Tenant and, when the
   request targets a Workspace, requires it to equal the invocation Workspace
   when one is present;
4. calls `identityd.ResolvePrincipal` for the invocation Actor and exact target;
5. calls `identityd.ListPrincipalGroups` for that Actor and, when the Actor is
   virtual, its attached account at the exact target; and
6. evaluates direct and Group Role bindings and access grants for the exact
   operation and path.

A human or service Actor is allowed only by a matching current Actor or direct
Group rule. A virtual Actor is allowed only when `act.sub` resolves to that
virtual principal, invocation `sub` equals its immutable attached account, and
both principals' direct or direct-Group authority contain a matching rule.
Disabled principal or account state produces deny. Missing current target
standing is `NOT_FOUND`, not a visible deny reason.

The invocation token is not a capability snapshot. `policyd` validates it
again even when the resource owner already did so, and obtains current identity
facts for each decision. An allow response is valid only for the current call;
it is not a credential and is not cached or replayed by the caller.

## tenantd catalog

The tenant-management operation catalog is:

| Operation | Owner | Canonical target |
| --- | --- | --- |
| `tenants.read` | `SERVICE/svc_tenantd` | `/tenants/<tenant_id>` |
| `tenants.update_display_name` | `SERVICE/svc_tenantd` | `/tenants/<tenant_id>` |
| `workspaces.create` | `SERVICE/svc_tenantd` | `/tenants/<tenant_id>/workspaces` |
| `workspaces.read` | `SERVICE/svc_tenantd` | Workspace collection or exact Workspace path |
| `workspaces.update_display_name` | `SERVICE/svc_tenantd` | `/tenants/<tenant_id>/workspaces/<workspace_id>` |
| `workspaces.suspend` | `SERVICE/svc_tenantd` | `/tenants/<tenant_id>/workspaces/<workspace_id>` |
| `workspaces.resume` | `SERVICE/svc_tenantd` | `/tenants/<tenant_id>/workspaces/<workspace_id>` |
| `workspaces.delete` | `SERVICE/svc_tenantd` | `/tenants/<tenant_id>/workspaces/<workspace_id>` |

`CreateTenant`, `ListTenants`, and `SetTenantState` remain infrastructure
operator operations. `ResolveTenant` and `ResolveWorkspace` remain
autonomous-kernel resolution operations. They have no tenant capability token.

## Failures

| gRPC status or result | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Operation, path, Tenant, or Workspace input is malformed or inconsistent |
| `UNAUTHENTICATED` | Workload or required invocation identity cannot be established |
| `PERMISSION_DENIED` | Caller does not own the operation |
| `NOT_FOUND` | Current Actor standing at the exact target cannot be established |
| `UNAVAILABLE` | A required identity authority or policy store is unavailable or malformed |
| `CANCELLED` / `DEADLINE_EXCEEDED` | The decision did not complete |
| `deny` | Identity is current, but no matching effective allow exists |

Dependency failure is never converted into deny and never falls back to an
earlier allow. A deny response reveals no Group expansion, hidden Role, grant,
or another principal's policy.

## Integrations

```text
resource owner
  -> policyd.CheckAccess
       -> identityd.GetInvocationVerificationKeys
       -> identityd.ResolvePrincipal
       -> identityd.ListPrincipalGroups
          (Actor and attached account when Actor is virtual)
```

Every arrow is a real private gRPC call with independent workload
authentication, the unchanged invocation JWT, deadline, cancellation, and W3C
trace context. `policyd` does not call the resource owner while deciding that
owner's operation, so the graph contains no recursive authorization cycle.

## Verification

Canonical evidence covers:

- exact operation ownership and spoofing rejection;
- canonical exact and subtree path matching at delimiter boundaries;
- direct principal and direct Group grants;
- no-match denial;
- virtual-principal and attached-account intersection;
- disabled principal and account denial;
- Tenant and Workspace invocation fences;
- missing-standing concealment;
- independent invocation validation;
- identity dependency outage and malformed responses;
- cancellation and deadlines; and
- correlated, bounded, redacted telemetry across the owner, `policyd`, and
  `identityd`.

There is no `ExplainAccess`, `BuildResourcePath`, AccessReview, watch, stream,
HTTP mirror, reusable decision token, or caller-supplied operation owner in the
approved contract.
