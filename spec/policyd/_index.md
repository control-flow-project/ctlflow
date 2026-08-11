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

Identityd Workspace-administration paths have one additional, explicit shape:
a Tenant policy target may carry a canonical descendant Workspace path. This
is used only when a Tenant-scoped invocation administers that Tenant's
Workspace. It evaluates Tenant standing, Tenant Groups, and an explicit
Tenant-target grant matching the descendant path. It does not read or inherit
the Workspace's grants or Groups. A Workspace-scoped invocation continues to
use the exact Workspace policy target.

The complete catalog is:

| Operation | Owner | Canonical resource path |
| --- | --- | --- |
| `tenants.read` | `SERVICE/svc_tenantd` | `/tenants/<tenant_id>` |
| `tenants.update_display_name` | `SERVICE/svc_tenantd` | `/tenants/<tenant_id>` |
| `workspaces.create` | `SERVICE/svc_tenantd` | `/tenants/<tenant_id>/workspaces` |
| `workspaces.read` | `SERVICE/svc_tenantd` | Workspace collection or exact Workspace path |
| `workspaces.update_display_name` | `SERVICE/svc_tenantd` | `/tenants/<tenant_id>/workspaces/<workspace_id>` |
| `workspaces.suspend` | `SERVICE/svc_tenantd` | `/tenants/<tenant_id>/workspaces/<workspace_id>` |
| `workspaces.resume` | `SERVICE/svc_tenantd` | `/tenants/<tenant_id>/workspaces/<workspace_id>` |
| `workspaces.delete` | `SERVICE/svc_tenantd` | `/tenants/<tenant_id>/workspaces/<workspace_id>` |
| `tenant_memberships.add` | `SERVICE/svc_identityd` | `/tenants/<tenant_id>/members/<account_id>` |
| `tenant_memberships.remove` | `SERVICE/svc_identityd` | `/tenants/<tenant_id>/members/<account_id>` |
| `tenant_memberships.read` | `SERVICE/svc_identityd` | `/tenants/<tenant_id>/members` |
| `workspace_memberships.add` | `SERVICE/svc_identityd` | `/tenants/<tenant_id>/workspaces/<workspace_id>/members/<account_id>` |
| `workspace_memberships.remove` | `SERVICE/svc_identityd` | `/tenants/<tenant_id>/workspaces/<workspace_id>/members/<account_id>` |
| `workspace_memberships.read` | `SERVICE/svc_identityd` | `/tenants/<tenant_id>/workspaces/<workspace_id>/members` |
| `groups.create` | `SERVICE/svc_identityd` | Tenant or Workspace domain path plus `/groups/<group_id>` |
| `groups.delete` | `SERVICE/svc_identityd` | Tenant or Workspace domain path plus `/groups/<group_id>` |
| `groups.read` | `SERVICE/svc_identityd` | Tenant or Workspace domain path plus `/groups` |
| `group_memberships.add` | `SERVICE/svc_identityd` | Domain path plus `/groups/<group_id>/members/<principal_id>` |
| `group_memberships.remove` | `SERVICE/svc_identityd` | Domain path plus `/groups/<group_id>/members/<principal_id>` |
| `group_memberships.read` | `SERVICE/svc_identityd` | Domain path plus `/groups/<group_id>/members` |
| `virtual_principals.create` | `SERVICE/svc_identityd` | Domain path plus `/virtual-principals/<principal_id>` |
| `virtual_principals.read` | `SERVICE/svc_identityd` | Domain path plus `/virtual-principals` or one exact principal |
| `virtual_principals.set_enabled` | `SERVICE/svc_identityd` | Domain path plus `/virtual-principals/<principal_id>` |
| `external_identity_links.create` | `SERVICE/svc_identityd` | `/tenants/<tenant_id>/login-providers/<provider_id>/identity-links` |
| `external_identity_links.delete` | `SERVICE/svc_identityd` | `/tenants/<tenant_id>/login-providers/<provider_id>/identity-links` |
| `external_identity_links.read` | `SERVICE/svc_identityd` | `/tenants/<tenant_id>/login-providers/<provider_id>/identity-links` |
| `login_providers.create` | `SERVICE/svc_identityd` | `/tenants/<tenant_id>/login-providers/<provider_id>` |
| `login_providers.read` | `SERVICE/svc_identityd` | `/tenants/<tenant_id>/login-providers` or one exact provider |
| `login_providers.update` | `SERVICE/svc_identityd` | `/tenants/<tenant_id>/login-providers/<provider_id>` |
| `login_providers.set_state` | `SERVICE/svc_identityd` | `/tenants/<tenant_id>/login-providers/<provider_id>` |
| `workspace_login_provider_admissions.set` | `SERVICE/svc_identityd` | `/tenants/<tenant_id>/workspaces/<workspace_id>/login-providers/<provider_id>` |
| `workspace_login_provider_admissions.read` | `SERVICE/svc_identityd` | `/tenants/<tenant_id>/workspaces/<workspace_id>/login-providers` |
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

Pkgd, Configd, and Execd never send Global scope to Policyd, and there is no
Global capability target for a product operation either; a globally placed
workload acts through the non-Global invocation it is serving. Execd's list and
exact read paths share their corresponding read operation. Every ID and purpose
segment retains the canonical grammar and bound declared by its owning service.

For Identityd rows, the policy target is `/tenants/<tenant_id>` or
`/tenants/<tenant_id>/workspaces/<workspace_id>`. Account and virtual-principal
IDs remain one canonical path segment. A Tenant target accepts a descendant
Workspace path only for the existing Workspace-administration operations in
the Identityd catalog.

`CreateTenant`, `ListTenants`, and `SetTenantState` remain operator operations.
`ResolveTenant` and `ResolveWorkspace` remain autonomous-kernel operations.
They have no Policyd catalog entry.

## Operation identity

Every operation has a tagged identity. All three fields are non-empty and
participate in stored policy keys:

```text
operation_owner_kind = kernel | package
operation_owner_id   = svc_tenantd | <package_id>
operation            = tenants.read | widgets.read
```

`operation_owner_kind` is a closed union. There is no sentinel or magic value.
Two packages may each declare `widgets.read`, and a package may use a token that
is lexically identical to a kernel token; owner kind and owner ID keep them
distinct.

Policyd selects the owner namespace from the authenticated immediate caller
**before** it interprets the token:

```text
exact admitted kernel caller  -> fixed kernel catalog
other admitted workload       -> Execd product-operation binding
```

A product workload therefore cannot enter the kernel branch, whatever token it
names, and Pkgd never needs a copy of the kernel catalog.

## Product operation authority

Product operations are declared by Pkgd, admitted by Execd, and resolved by
Policyd at decision time. Policyd stores no ownership of its own and holds no
product-operation registry, projected ownership file, or mutable authority
cache.

For a product operation Policyd calls exactly one dependency:

```text
execd.ResolveWorkloadOperationBinding(service_account_subject, operation)
  -> effective Placement target, App ID, Package ID
```

`service_account_subject` is derived by Policyd from the workload token it has
already validated, never from a request field. `operation` is an untrusted
selector that Execd confirms against its retained admitted snapshot. Execd
returns `NOT_FOUND` when the subject is unknown, the Workload or any Placement
ancestor is inactive, or the operation is not admitted for that Workload.
`NOT_FOUND` means the workload owns no active admitted binding and is a
product caller denial. Cancellation and deadline outcomes propagate unchanged;
every other Execd failure is dependency `UNAVAILABLE`.

Policyd validates the resolver response at its own boundary before any fence
or policy step: the Placement target must carry exactly one well-formed level,
and the App ID and Package ID must be non-empty canonical identifiers. A
missing, malformed, or structurally impossible response is dependency
`UNAVAILABLE`; generated-message defaults never reach the fence or the policy
evaluator. The call is a private Execd dependency call and carries Policyd's
own bound workload identity, finite deadline, cancellation, and W3C trace
context, and no invocation JWT; its telemetry names the Execd dependency and
RPC.

Policyd then applies, in order:

1. the Placement fence — the validated invocation target must be inside the
   workload's effective containment;
2. the App anchor — the resource path must be anchored to the admitted App; and
3. ordinary policy evaluation using the tagged identity
   `(package, <package_id>, <operation>)`.

The fence and anchor precede policy evaluation. No Role, binding, or grant can
widen them.

### Placement fence

Global is a Placement, not an authorization target. A globally placed workload
carries no narrower containment; it still acts only through a non-Global
invocation.

| Placement target | Admitted invocation targets |
| --- | --- |
| Global | Any non-Global target otherwise permitted by policy |
| Tenant | That exact Tenant, including a descendant Workspace invocation |
| Workspace | That exact Tenant and that exact Workspace only |
| User | That exact Tenant and subject account, with no Workspace target |

Containment narrows and never widens: a Workspace-placed workload cannot serve a
Tenant-root or sibling-Workspace invocation, and a User-placed workload cannot
serve a sibling account.

A User-placed workload additionally requires the account-scoped resource path
`/tenants/<tenant_id>/accounts/<account_principal_id>/apps/<app_id>[...]` whose
account equals the invocation subject account. A Tenant-root App path is not
admitted for a User Placement merely because the invocation subject matches;
the exact account path is required before the invocation account fence
applies.

### Product resource paths

A product path is anchored under the admitted App. The App root is itself a
valid target, so an operation needs no trailing product segment:

```text
/tenants/<tenant_id>/apps/<app_id>[/<product path>]
/tenants/<tenant_id>/workspaces/<workspace_id>/apps/<app_id>[/<product path>]
/tenants/<tenant_id>/accounts/<account_principal_id>/apps/<app_id>[/<product path>]
```

There is no Global capability path. Policyd verifies the canonical scope and the
exact admitted `app_id`; the product owns only the trailing domain path. Each
trailing segment starts `[a-z0-9]`, continues `[a-z0-9_.-]`, and is one to 128
characters. Spaces, encoded forms, traversal, and duplicate separators are
rejected, and the 512-character resource-path bound governs total length.

An operation that Execd does not confirm for the authenticated workload is
denied. Ownership is never asserted by a caller.

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

1. authenticates the immediate workload and classifies it as an exact admitted
   kernel caller or as another admitted workload, before interpreting the
   operation token;
2. for a kernel caller, requires the caller to own the requested fixed-catalog
   operation; for any other workload, calls
   `execd.ResolveWorkloadOperationBinding` with the authenticated subject and
   the requested operation, and denies on `NOT_FOUND`;
3. independently validates the required invocation JWT under
   [Access](../access/) and [Contracts](../contracts/);
4. requires the request target and path to match the catalog fence, or, for a
   product operation, the returned Placement fence and App anchor;
5. calls `identityd.ResolvePrincipal` for the invocation Actor and policy target;
6. consumes every `identityd.ListPrincipalGroups` page for that Actor and, for
   a virtual Actor, its resolved attached account; and
7. evaluates policy-target direct grants and Role bindings for the tagged
   operation identity and path.

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
an invalid path or target is `INVALID_ARGUMENT`. Identityd and Execd dependency
failures other than concealed `NOT_FOUND`, cancellation, or deadline are
`UNAVAILABLE`.
Dependency failure never becomes deny and never falls back to an expired key,
earlier identity fact, broader target, or earlier allow.

## Persistence and readiness

Policyd is durable and reads only its own Knex-migrated file-backed SQLite
database. Its logical policy schema contains `roles`, `role_rules`,
`role_bindings`, and `access_grants`. Role rules and access grants store the
tagged operation identity `operation_owner_kind`, `operation_owner_id`, and
`operation`, all non-empty and participating in their keys and uniqueness. The
kernel operation-owner catalog is checked deployment configuration, not a
database table, and product operation authority is resolved at decision time
rather than stored.

The schema enforces requiredness, bounds, canonical representations, exact
targets, closed subject and match kinds, keys, foreign keys, uniqueness, and
decision lookup indexes. Migrations contain structural storage rules only;
operation ownership, path matching, Actor intersection, and allow evaluation
remain Domain behavior. The common migration, runtime, and release rules are
defined by [Implementation](../implementation/).

Readiness requires the exact migration ledger and compatible schema, kernel
catalog, stored policy structure, and process-private workload, TLS, database,
and dependency custody. It verifies infrastructure only: it never requires an
active Workload for a stored product policy entry, so valid policy naming a
suspended or absent Workload does not make Policyd unready. Migration validates
structure, readiness validates infrastructure, and runtime validates current
authority. The serving process does not migrate, repair, or seed state. Restart
preserves provisioned policy. Dependency outage never activates a fallback, and
Policyd caches no mutable Workload eligibility, so suspension, retirement,
deletion, or ancestor deactivation takes effect on the next request.

## Telemetry and audit

CheckAccess emits bounded traces, metrics, and structured logs under
[Telemetry](../telemetry/). Trace context continues through verification-key,
principal, Group-page, Execd product-operation resolution, and database calls.
Every dependency call, including the Execd resolver, records its canonical
gRPC status in `ctlflow.outcome` on its own client span. Successful allow and deny responses
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
