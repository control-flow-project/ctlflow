---
title: policyd
description: Capability grants and current operation-and-path authorization decisions.
weight: 50
---

`policyd` is the sole authority for whether an established invocation Actor
has one declared operation on one canonical resource path. The resource owner
enforces the result and its own Domain invariants; Policyd never reads or
mutates the protected object.

**Wire reference:** [policyd gRPC API](../apis/policyd/)

## Ownership and records

Policyd owns:

- Roles, which are named finite sets of allow rules;
- Role bindings from one Role to one principal or direct Group;
- direct principal and direct-Group access grants;
- the immutable operation-owner catalog; and
- the effective `allow` or `deny` decision.

Identityd owns principals, virtual-principal attachment, Membership standing,
and direct Groups. Kubernetes authenticates immediate workloads. None of those
facts grants an operation by itself.

A Role and every direct grant belong to one exact Tenant or Workspace target.
A Workspace decision does not inherit Tenant policy or Tenant-target Groups.
A rule contains one operation, one canonical base path, and the closed match
kind `exact` or `subtree`. A binding or direct grant has a typed principal or
Group subject; subject kinds are never interchangeable.

An exact rule uses byte-for-byte path equality. A subtree rule matches the base
path or a descendant beginning with `base_path + "/"`. Matching is
delimiter-bounded. Rules are allow-only: there is no deny rule, wildcard,
priority, override, exclusion, or precedence algorithm.

Roles, bindings, and grants are immutable, installation-provisioned durable
state. Policyd exposes no operation that creates, changes, lists, or deletes
them.

## Operations and paths

An operation token has the form `<plural_resource>.<action>`, contains only
lower-case ASCII letters, digits, and `_` within each non-empty part, and is at
most 128 characters. There are no wildcard operations.

A resource path is an absolute ASCII path of at most 512 characters composed
only from catalog-declared fixed segments and canonical IDs. Empty, `.`, `..`,
trailing, duplicate-separator, escaped, control-character, query, fragment, and
NUL forms are invalid. Policyd validates the supplied path and never decodes,
repairs, or normalizes it. Tenant, Workspace, principal, and Group identifiers
use the canonical shapes owned by [Tenantd](../tenantd/) and
[Identityd](../identityd/).

The checked, versioned operation-owner catalog is Policyd deployment
configuration, not caller input, persisted policy, or a registration API.
Policyd validates the complete catalog before readiness. Let `<scope>` be
exactly one of:

```text
/tenants/<tenant_id>
/tenants/<tenant_id>/workspaces/<workspace_id>
/tenants/<tenant_id>/accounts/<account_principal_id>
```

The account is a canonical `user:` or `service:` principal and must equal the
validated invocation `sub`. There is no `/users/` scope. Tenant and account
scopes use the Tenant policy target; Workspace scope uses the exact Workspace
policy target.

The complete catalog is:

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
| `apps.create` | `SERVICE/svc_pkgd` | `<scope>/apps` |
| `apps.read` | `SERVICE/svc_pkgd` | `<scope>/apps/<app_id>` |
| `apps.set_package_generation` | `SERVICE/svc_pkgd` | `<scope>/apps/<app_id>` |
| `configurations.publish` | `SERVICE/svc_configd` | `<scope>/placements/<placement_id>/consumers/<consumer_id>/purposes/<purpose>/configurations/<configuration_id>` |
| `configurations.read` | `SERVICE/svc_configd` | `<scope>/placements/<placement_id>/consumers/<consumer_id>/purposes/<purpose>/configurations/<configuration_id>` |
| `secrets.publish` | `SERVICE/svc_configd` | `<scope>/placements/<placement_id>/consumers/<consumer_id>/purposes/<purpose>/secrets/<secret_id>` |
| `secrets.read_metadata` | `SERVICE/svc_configd` | `<scope>/placements/<placement_id>/consumers/<consumer_id>/purposes/<purpose>/secrets/<secret_id>` |
| `placements.declare` | `SERVICE/svc_execd` | `<scope>/placements/<placement_id>` |
| `placements.read` | `SERVICE/svc_execd` | `<scope>/placements` or `<scope>/placements/<placement_id>` |
| `workloads.declare` | `SERVICE/svc_execd` | `<scope>/placements/<placement_id>/workloads/<workload_id>` |
| `workloads.read` | `SERVICE/svc_execd` | `<scope>/placements/<placement_id>/workloads` or `<scope>/placements/<placement_id>/workloads/<workload_id>` |
| `runs.create` | `SERVICE/svc_execd` | `<scope>/placements/<placement_id>/workloads/<workload_id>/runs/<run_id>` |
| `runs.read` | `SERVICE/svc_execd` | `<scope>/placements/<placement_id>/workloads/<workload_id>/runs` or `<scope>/placements/<placement_id>/workloads/<workload_id>/runs/<run_id>` |
| `runs.cancel` | `SERVICE/svc_execd` | `<scope>/placements/<placement_id>/workloads/<workload_id>/runs/<run_id>` |

The `workspaces.read` collection path is
`/tenants/<tenant_id>/workspaces`; its exact path appends
`/<workspace_id>`. IDs in the path must equal the request target. Collection
targets omit `workspace_id`; exact Workspace targets require it.

Pkgd, Configd, and Execd never send Global scope to Policyd. Execd's list and
exact read paths share their corresponding read operation. Every ID and purpose
segment retains the canonical grammar and bound declared by its owning service.

`CreateTenant`, `ListTenants`, and `SetTenantState` remain operator operations.
`ResolveTenant` and `ResolveWorkspace` remain autonomous-kernel operations.
They have no Policyd catalog entry.

## CheckAccess

Policyd exposes exactly one private unary gRPC operation:

```text
CheckAccess(operation, resource_path, tenant_id, optional workspace_id)
  -> allow | deny
```

The request has only those four fields. The response has one `AccessDecision`;
a conforming success emits `ACCESS_DECISION_ALLOW` or
`ACCESS_DECISION_DENY`, never the protobuf `UNSPECIFIED` sentinel. Actor,
attached account, immediate caller, target fence, operation owner, and decision
reason are not body fields.

For every call, Policyd:

1. authenticates the immediate workload and requires it to own the requested
   catalog operation;
2. independently validates the required invocation JWT under
   [Access](../access/) and [Contracts](../contracts/);
3. requires the request target and path to match the catalog and invocation
   fence;
4. calls `identityd.ResolvePrincipal` for the invocation Actor and exact target;
5. consumes every `identityd.ListPrincipalGroups` page for that Actor and, for
   a virtual Actor, its resolved attached account; and
6. evaluates exact-target direct grants and Role bindings for the operation and
   path.

Policyd obtains invocation verification keys through
`identityd.GetInvocationVerificationKeys`. It caches Identityd's exact bounded
key set only until the owner-supplied expiry and refreshes on expiry or an
unknown key ID. A known key in a current cache remains usable during an
Identityd outage. A failed, expired, or malformed refresh is `UNAVAILABLE`; a
successful refresh without the requested key and an invalid invocation are
`UNAUTHENTICATED`. Every invocation is independently validated even when
Tenantd already validated it.

Identityd calls use Policyd's bound workload identity, private gRPC, the
unchanged invocation JWT on fact calls, finite deadline, cancellation, and W3C
trace context. The verification-key bootstrap call carries no invocation.
Policyd uses real Identityd calls and holds no database transaction across
them.

Group expansion uses Identityd's documented keyset pagination with
`page_size = 100`, the returned continuation unchanged, and every page through
completion. Actor and attached-account pages remain separate. Malformed or
non-advancing pages are `UNAVAILABLE`; Identityd `NOT_FOUND` remains concealed
`NOT_FOUND`.

For a human or service Actor, invocation `sub` is that Actor and one matching
direct or direct-Group rule allows. For a virtual Actor, `act.sub` is the
virtual principal, `sub` must equal the attached account confirmed by
ResolvePrincipal, and both principals must independently have matching
authority. Their matching Roles, grants, or Groups may differ. Disabled Actor
or account state is deny. Missing current standing is `NOT_FOUND`. No matching
effective allow is deny.

An allow applies only to the current protected call. It is not a credential,
lease, reusable review, or permission snapshot.

## Failures

| gRPC status or result | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | A request field, bound, path, or operation/target combination is malformed |
| `UNAUTHENTICATED` | Required workload or invocation identity cannot be established |
| `PERMISSION_DENIED` | The authenticated workload does not own the operation |
| `NOT_FOUND` | Current Actor, attachment, standing, or target fence cannot be established |
| `UNAVAILABLE` | Required key state, Identityd, policy persistence, catalog, schema, or dependency response is unavailable or malformed |
| `CANCELLED` / `DEADLINE_EXCEEDED` | The decision did not complete |
| `deny` | Identity is current but disabled, or no matching effective allow exists |

Unknown well-formed operations are `PERMISSION_DENIED`; a known operation with
an invalid path or target is `INVALID_ARGUMENT`. Identityd dependency failures
other than concealed `NOT_FOUND`, cancellation, or deadline are `UNAVAILABLE`.
Dependency failure never becomes deny and never falls back to an expired key,
earlier identity fact, broader target, or earlier allow.

## Persistence and readiness

Policyd is durable and reads only its own Knex-migrated file-backed SQLite
database. Its logical policy schema contains `roles`, `role_rules`,
`role_bindings`, and `access_grants`. The operation-owner catalog is checked
deployment configuration, not a database table.

The schema enforces requiredness, bounds, canonical representations, exact
targets, closed subject and match kinds, keys, foreign keys, uniqueness, and
decision lookup indexes. Migrations contain structural storage rules only;
operation ownership, path matching, Actor intersection, and allow evaluation
remain Domain behavior. The common migration, runtime, and release rules are
defined by [Implementation](../implementation/).

Readiness requires the exact migration ledger and compatible schema, catalog,
stored policy, and process-private workload, TLS, database, and dependency
custody. The serving process does not migrate, repair, or seed state. Restart
preserves provisioned policy. Dependency outage never activates a fallback.

## Telemetry and audit

CheckAccess emits bounded traces, metrics, and structured logs under
[Telemetry](../telemetry/). Trace context continues through verification-key,
principal, Group-page, and database calls. Successful allow and deny responses
have gRPC outcome `OK` and separate `ctlflow.decision` values.

Telemetry excludes credentials, invocation claims, IDs, resource paths, Group
expansion, Role or grant identity, request bodies, database values, and denial
detail. Collector failure is bounded and does not change a decision or
readiness.

CheckAccess is a read-only ephemeral decision with no approved Auditd event.
Policyd does not call Auditd or store audit state.

## Verification

Canonical evidence covers:

- the exact one-method unary descriptor and closed decision response;
- all 22 catalog operations, four owners, target forms, collection and exact
  variants, three scoped prefixes, account-subject equality, and rejection of
  `/users/`;
- exact and delimiter-bounded subtree matching, typed direct and Role-bound
  principal and Group authority, no-match denial, and exact-target isolation;
- direct and virtual Actor binding, attached-account intersection, disabled
  identity, target fences, and missing-standing concealment;
- current-key reuse, owner-expiry and unknown-key refresh, independent
  invocation validation, key outage, and malformed key responses;
- real ResolvePrincipal and complete Actor/account Group pagination, malformed
  pages, cancellation, deadlines, and dependency failures;
- durable policy, schema/readiness failure, restart persistence, and absence of
  mutation or audit state; and
- correlated redacted telemetry, bounded Collector failure, generated-contract
  drift, Hugo/spec validation, and common release gates.

There is no Role or grant CRUD, `ExplainAccess`, `BuildResourcePath`,
AccessReview, batch decision, watch, stream, HTTP mirror, decision credential,
decision cache, deny rule, admin API, or caller-supplied Actor, attached
account, operation owner, Role, or grant in the approved contract.
