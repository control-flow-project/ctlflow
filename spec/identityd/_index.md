---
title: identityd
description: Principals, standing, Groups, login identity, Sessions, and invocation identity.
weight: 46
---

`identityd` is the private authority for current principal, attached-account,
Membership, direct-Group, external-identity-link, login-provider, Session, and
invocation identity. It exposes only the gRPC contract in
`services/identityd/api/proto/v1/identityd.proto` and has no public listener.

**Wire reference:** [identityd gRPC API](../apis/identityd/)

## Approved ownership

The implemented contract owns:

- human and service account principals;
- virtual principals attached to one account;
- exact Tenant and Workspace Membership standing;
- non-nested Groups and direct principal-to-Group membership; and
- Tenant-scoped external identity links;
- Tenant login-provider registrations and Workspace provider admissions;
- opaque browser Sessions;
- invocation-signing custody; and
- active and retiring invocation public verification keys.

A Membership establishes standing only. A Group is a direct audience only.
Neither contains a Role, grant, capability, administrator flag, operation, or
access decision. `policyd` alone owns those policy concepts.

Identityd exposes explicit administration operations for account standing,
Groups, virtual principals, external identity links, login-provider
registrations, and Workspace provider admissions. These operations never
create a Role, grant, capability, Tenant, Workspace, provider secret, or OIDC
protocol result. Key lifecycle remains installation-provisioned; Session
creation and revocation remain protocol-facing mutations.

## Records

### Principals

A principal contains:

```text
principal ID
kind
subject-account ID
enabled state
positive revision
optional virtual-principal Tenant fence
optional narrower virtual-principal Workspace fence
```

The complete principal kinds and canonical IDs are:

| Kind | Canonical ID |
| --- | --- |
| Human account | `user:<local-id>` |
| Service account | `service:<local-id>` |
| Virtual principal | `agent:<local-id>` |

The complete ID is at most 256 characters. A local ID is lower-case ASCII,
starts alphanumeric, and otherwise contains only alphanumeric characters,
`.`, `_`, or `-`.

For a human or service principal, the subject account is the principal itself
and no virtual-principal fence exists. A virtual principal has one immutable,
distinct human or service subject account and one immutable Tenant fence. It
may additionally have one immutable Workspace fence inside that Tenant.

Enabled state belongs independently to the principal and subject account. A
disabled value remains a current fact returned to `policyd`; Identityd does
not convert it into a policy decision.

### Memberships

A Tenant Membership contains:

```text
subject-account ID
Tenant ID
positive revision
```

A Workspace Membership contains:

```text
subject-account ID
Tenant ID
Workspace ID
positive revision
```

A Workspace Membership structurally requires the same account's Tenant
Membership. Presence is current standing; there is no second Membership state
or Role field.

Tenant and Workspace IDs use the same canonical identifier shape as Tenantd:
one to 64 lower-case ASCII characters, starting alphanumeric, with only
alphanumeric characters, `_`, or `-` thereafter.

For a Tenant target, `membership_revision` is the Tenant Membership revision.
For a Workspace target, Identityd requires both Memberships and returns the
Workspace Membership revision.

### Groups

A Group contains one globally unique Group ID and one exact target:

```text
Group ID
Tenant ID
optional Workspace ID
```

A direct Group membership relates one principal to one Group. Groups are not
nested. A Workspace query returns only direct Groups whose exact target is that
Workspace; it does not implicitly include Tenant-target Groups. Policyd queries
the virtual Actor and its subject account separately when both authority sets
are required.

Group IDs use the same one-to-64-character canonical identifier shape as
Tenant and Workspace IDs.

### Invocation verification keys

One verification-key record contains:

```text
key ID
RS256 algorithm
base64url RSA modulus
base64url RSA exponent
active or retiring state
positive revision
```

Key IDs are one to 128 visible ASCII characters. Decoded modulus material is
128 to 1,024 bytes and decoded exponent material is one to eight bytes. The
current set contains exactly one active key and zero through seven retiring
keys.

The active RS256 private key is supplied through a process-private file
projection. It must match the active public-key record. Private or symmetric
key material is never stored in Identityd persistence, returned by an API,
placed in an environment value, or exposed to another process.

### External identity links

An external identity link contains:

```text
Tenant ID
provider ID
provider subject
human account ID
positive revision
```

Provider IDs use the canonical one-to-64-character identifier shape. Provider
subjects are exact, case-sensitive, non-empty values of at most 512
characters. A provider identity maps to at most one human account inside one
Tenant. Service and virtual principals cannot be login targets. The account
must have current Tenant standing and the provider must be current and not
deleted when the link is created.

Identityd owns the identity mapping. Authd owns public protocol validation and
supplies only a provider ID and provider subject that it has established from
that protocol. It never supplies an account ID.

### Login providers

A login-provider registration contains:

```text
Tenant ID
provider ID
display name
Configd configuration ID and exact version ID
Configd secret ID and exact version ID
active, disabled, or deleted state
positive revision
```

The current protocol is OIDC. Identityd stores only registration metadata and
exact references. Configd owns the referenced bytes, and Authd alone interprets
and validates their OIDC meaning. Configuration or secret material never
enters an Identityd request, response, database, log, metric, trace, or audit
event.

Provider IDs are permanent inside a Tenant. `active` and `disabled` may
transition to each other or to `deleted`; `deleted` is terminal. Deleted
records remain reserved and are hidden from reads. Deletion removes every
Workspace admission for the provider in the same Identityd transaction but
does not silently remove external identity links.

Display names are one through 128 UTF-8 characters after trimming and contain
no control character. Configd identity and version IDs use Configd's canonical
one-to-64-character identifier shape.

### Workspace login-provider admissions

A Workspace admission contains exactly:

```text
Tenant ID
Workspace ID
Tenant provider ID
```

An admitted provider belongs to the same Tenant and is not deleted. A
Workspace login accepts only a provider in this exact set. The record copies no
provider configuration or secret material and carries no Role, domain rule,
email rule, or automatic-Membership behavior.

### Sessions

A Session contains:

```text
opaque Session ID
human account ID
Tenant ID
login provider ID
SHA-256 credential digest
creation and finite expiry times
optional revocation time
positive revision
```

Identityd generates each Session ID and 256-bit credential using a
cryptographically secure random source. The raw credential is returned only
by `CreateSession`; Identityd persists only its digest. The provider ID is the
immutable Tenant provider through which the Session was created; the provider
subject and protocol material are not Session state. A Session is
Tenant-scoped. A later Workspace target requires both the account's current
Workspace standing and an exact current Workspace admission for the Session's
provider. Tenant exchange does not consult Workspace admissions.

Revocation is terminal. Expiry is evaluated from the current time and does not
mutate the record. A configured Session lifetime is finite and no greater than
30 days.

## Standing and fences

Identityd establishes current facts at one requested target:

```text
Tenant target:
  matching Tenant Membership

Workspace target:
  matching Tenant Membership
  AND matching Workspace Membership
```

For a virtual principal, the target must additionally be inside its immutable
fence:

```text
Tenant target:
  requested Tenant == virtual Tenant fence

Workspace target:
  requested Tenant == virtual Tenant fence
  AND virtual Workspace fence is absent or equals requested Workspace
```

For the existing principal-fact operations, an invocation Workspace fence
permits its parent Tenant target and only that Workspace as a Workspace target;
this lets Policyd resolve the caller's required parent standing. An invocation
Tenant fence permits that Tenant and any Workspace target inside it.
Administration is deliberately narrower: a Workspace-scoped invocation may
administer only that exact Workspace and never its parent Tenant, while a
Tenant-scoped invocation may administer the Tenant and its Workspaces.

Unknown records, missing standing, a mismatched parent, or a target outside
either fence are concealed as `NOT_FOUND`.

## API

The service has exactly 33 unary operations:

| Operation | Input | Result |
| --- | --- | --- |
| `GetInvocationVerificationKeys` | Empty request | Bounded current public key set and cache expiry |
| `ResolvePrincipal` | Principal ID, Tenant ID, optional Workspace ID | Current principal, account, and Membership facts |
| `ListPrincipalGroups` | Same selector, page size, optional last Group ID | Bounded direct-Group ID page |
| `AddTenantMember` | Tenant ID and account principal ID | Current account and Tenant Membership facts |
| `RemoveTenantMember` | Tenant ID and account principal ID | Empty success |
| `ListTenantMembers` | Tenant ID, page size, optional last account ID | Bounded Tenant-member page |
| `AddWorkspaceMember` | Tenant ID, Workspace ID, and account principal ID | Current account and Workspace Membership facts |
| `RemoveWorkspaceMember` | Same exact selector | Empty success |
| `ListWorkspaceMembers` | Tenant ID, Workspace ID, page size, optional last account ID | Bounded Workspace-member page |
| `CreateGroup` | Group ID and exact Tenant or Workspace target | Group |
| `DeleteGroup` | Group ID and exact target | Empty success |
| `ListGroups` | Exact target, page size, optional last Group ID | Bounded Group page |
| `AddGroupMember` | Group ID, exact target, and principal ID | Group member |
| `RemoveGroupMember` | Same exact selector | Empty success |
| `ListGroupMembers` | Group ID, exact target, page size, optional last principal ID | Bounded direct-member page |
| `CreateVirtualPrincipal` | Principal ID, attached account ID, and immutable target fence | Virtual principal |
| `GetVirtualPrincipal` | Principal ID and exact fence | Virtual principal |
| `ListVirtualPrincipals` | Exact fence, page size, optional last principal ID | Bounded virtual-principal page |
| `SetVirtualPrincipalEnabled` | Principal ID, exact fence, expected revision, enabled value | Virtual principal |
| `CreateExternalIdentityLink` | Tenant, provider, subject, and human account | External identity link |
| `DeleteExternalIdentityLink` | Tenant, provider, and subject | Empty success |
| `ListExternalIdentityLinks` | Tenant, provider, page size, optional last subject | Bounded external-link page |
| `CreateLoginProvider` | Tenant, provider ID, display name, and exact Configd references | Login provider |
| `GetLoginProvider` | Tenant and provider ID | Login provider |
| `ListLoginProviders` | Tenant, page size, optional last provider ID | Bounded login-provider page |
| `UpdateLoginProvider` | Tenant, provider ID, expected revision, display name, and exact Configd references | Login provider |
| `SetLoginProviderState` | Tenant, provider ID, expected revision, state | Login provider |
| `SetWorkspaceLoginProviderAdmission` | Tenant, Workspace, provider ID, admitted value | Workspace admission or empty removal |
| `ListWorkspaceLoginProviderAdmissions` | Tenant, Workspace, page size, optional last provider ID | Bounded admission page |
| `CreateSession` | Tenant ID, provider ID, provider subject | New Session ID, one-time opaque credential, and expiry |
| `ExchangeSession` | Opaque Session credential and exact target | Short-lived invocation JWT and expiry |
| `RevokeSession` | Opaque Session credential | Empty success |
| `IssueRunInvocation` | Actor principal ID, exact target, Run ID | Short-lived invocation JWT and expiry |

There is no account-update, account-delete, nested-Group, Session-list,
Session-administration, provider-secret, automatic-admission, Role, grant,
decision, watch, stream, bulk, restore, or key-lifecycle operation.

### GetInvocationVerificationKeys

The result contains the one active and every retiring verification key in
ascending ordinal key-ID order. The set must contain one through eight keys;
Identityd does not truncate an oversized set. The absolute cache expiry is
strictly after response time and no more than five minutes later.

This operation admits any valid installation-issued bound Kubernetes workload
token, and it is the only operation that does. Verification keys are public
material, so a product workload realized by Execd uses the same bootstrap path
as a kernel service instead of a second projection or refresh mechanism. Every
other Identityd operation keeps its exact caller allowlist, so holding this
token grants nothing else. Identityd does not resolve the caller through Execd:
workload-token expiry bounds stale access, and no revocation check is required
for public keys.

Callers do not carry an invocation JWT because this operation is the bootstrap
path used to validate an unknown invocation key. Invocation metadata grants no
authority to this operation.

Empty, duplicate, malformed, expired, or oversized source state is
`UNAVAILABLE`. The operation never returns private or symmetric key material.

Receivers refresh on expiry or an unknown key ID. A known key in a current
receiver cache may remain usable during an Identityd outage.

### ResolvePrincipal

The response contains:

```text
principal ID, kind, enabled state, revision
subject-account ID, enabled state, revision
current exact-target Membership revision
```

For a human or service principal, principal and subject-account facts come
from the same account record. For a virtual principal, the account facts come
from its immutable attached account.

The required invocation JWT is validated locally. The requested principal
must be the invocation Actor. For a direct human or service invocation,
`sub` is that Actor. For a virtual invocation, `act.sub` is that Actor and
`sub` must equal the virtual principal's current attached account.

Disabled principal or account state is returned as current fact. Unknown
identity, attachment mismatch, missing standing, and fence mismatch are
`NOT_FOUND`.

### ListPrincipalGroups

The request uses the same target selector plus page size and optional last
Group ID. The required invocation JWT is validated locally.

The requested principal must be either:

- the invocation Actor; or
- for a virtual invocation, that Actor's immutable subject account named by
  `sub`.

Identityd re-establishes the Actor attachment, target fence, and requested
principal's current standing before returning direct Group IDs.

Results use ascending ordinal Group-ID order and keyset pagination:

```text
group_id > after_group_id
```

A zero page size selects 50; admitted sizes are one through 100. Identityd
reads one extra row to determine whether another page exists and returns the
last emitted Group ID as `next_after_group_id` only when another page exists.

The continuation is untrusted input, not stored state. Pagination has no
cursor table, snapshot journal, expiry, or mutation invalidation.

All administration lists use the same page-size bounds and read-one-extra
keyset shape over the immutable ID named by their `after_*` field. External
identity links are ordered by exact provider subject. No list stores a cursor
or promises a snapshot across calls.

### Membership administration

`AddTenantMember` accepts only a canonical `user:` or `service:` account ID.
When the account is absent, Identityd creates the matching enabled human or
service account at revision one before creating Tenant standing. Repeating the
same add returns the current facts without another mutation. It never creates a
Role, Group membership, Workspace standing, external link, or Session.

`AddWorkspaceMember` requires current Tenant standing for the account and
creates only the exact Workspace standing. Repeating it returns the current
facts. The two list operations return account ID, kind, enabled state, account
revision, and Membership revision in ascending account-ID order.

Removal is idempotent. Removing Workspace standing fails while the principal
has a direct Group membership at that Workspace. Removing Tenant standing
fails while any Workspace standing, direct Group membership in the Tenant or
one of its Workspaces, or external identity link remains. Existing Sessions
are retained but cannot exchange after standing disappears because every
exchange re-establishes current standing.

### Group administration

`CreateGroup` binds one globally unique Group ID to one exact target. An exact
replay is a no-op; reuse at another target is `ALREADY_EXISTS`. `DeleteGroup`
removes its direct member relationships and then the Group in one transaction;
repeating deletion is a no-op.

Adding a member requires an existing exact-target Group and current standing
for the named human, service, or virtual principal at that target. For a
virtual principal, Identityd also checks its immutable attachment and fence.
Groups cannot be members. Add and remove are idempotent. Member lists contain
principal ID and kind in ascending principal-ID order.

### Virtual-principal administration

Creation requires an absent canonical `agent:` ID, an existing human or service
account with current standing at the immutable fence, and an optional Workspace
inside the named Tenant. The principal starts enabled at revision one. ID,
attached account, Tenant fence, and optional Workspace fence never change.

Get, list, and enable-state mutation use the exact immutable fence. A target
mismatch is concealed as `NOT_FOUND`. Enable-state mutation requires the
current positive revision; a mismatch is `ABORTED`, and an unchanged value is
a no-op.

### External-identity-link administration

Creation requires an existing non-deleted provider and an enabled human account
with current Tenant standing. An exact replay is a no-op; the same
Tenant/provider/subject mapped to another account is `ALREADY_EXISTS`.
Deletion is idempotent. Lists are bounded to one exact Tenant and provider and
ordered by the case-sensitive provider subject. Provider subjects and
configuration material are excluded from telemetry and audit.

### Login-provider administration

Creation starts the provider in `active` state at revision one. ID reuse is
`ALREADY_EXISTS`, including a deleted record. Update changes only display name
and exact Configd references and requires the current positive revision.
State mutation requires the current positive revision, permits
`active <-> disabled` and either current state to `deleted`, and rejects every
transition out of `deleted`. An unchanged update is a no-op.

Get and list hide deleted providers. Lists use ascending provider-ID order.
`SetWorkspaceLoginProviderAdmission` adds or removes one exact provider ID.
Add requires a current non-deleted provider in the same Tenant; add and remove
are idempotent. Admission lists use ascending provider-ID order and never
return a deleted provider. Authd must additionally require `active` state
before beginning login.

### CreateSession

Authd calls `CreateSession` only after it has validated one external
authentication protocol result. Identityd requires the exact provider to be
active, resolves the Tenant, provider ID, and provider subject through its
current external identity link, and then requires an enabled human account and
current Tenant Membership.

Success creates one Session with the selected provider ID, returns its
generated ID, returns the raw 32-byte credential exactly once, and returns the
absolute expiry. The credential, provider subject, and protocol material never
appear in telemetry or audit.

Unknown identity links, disabled accounts, and missing Tenant standing are
`UNAUTHENTICATED`. Identityd never accepts an account ID from Authd.

### ExchangeSession

Edged calls `ExchangeSession` with the exact 32-byte credential received in a
browser cookie and the resolved Tenant plus optional Workspace target.
The immediate caller presents a Pod-bound Kubernetes ServiceAccount token
projected only into that Edged sidecar with the exact audience
`ctlflow-edged`. Identityd rejects the installation internal audience and
every other audience for this operation. The purpose-bound audience admits
dynamic Execd-created sidecars without granting the colocated application
access to the credential.
Identityd hashes the credential, requires one unexpired and unrevoked Session,
requires its enabled human account, and re-establishes current standing at the
exact target. For a Workspace target, it also requires the Session's immutable
provider ID in that Workspace's exact current admission set. Removing an
admission therefore prevents later Workspace exchange without revoking the
Tenant Session. Disabling a provider prevents new login but does not invalidate
an existing Session. Session expiry is evaluated against the full current
instant; whole-second normalization applies only to the issued invocation
timestamps.

Success returns an RS256 invocation JWT whose `sub` is the Session account,
whose target fence is the request target, and whose origin is the Session ID.
It has no `act.sub` or `run_id`. The absolute token expiry is returned
separately.

An unknown, malformed, expired, or revoked credential is `UNAUTHENTICATED`.
Missing target standing or Workspace provider admission is concealed as
`NOT_FOUND`.

### RevokeSession

Authd calls `RevokeSession` with the exact 32-byte Session credential. An
active Session is irreversibly revoked and its revision advances once.
Repeating revocation for the same Session succeeds without another mutation or
audit event. Concurrent revocations of the same Session converge on that same
single mutation and audit event. An unknown or malformed credential is
`UNAUTHENTICATED`; expiry does not prevent revocation.

### IssueRunInvocation

Execd calls `IssueRunInvocation` for one Run it owns. The request names the
Run's Actor principal, Run ID, Tenant, and optional Workspace. Execd cannot
name an attached account. Identityd resolves the Actor, derives any attached
account, requires both to be enabled, and re-establishes current standing and
the virtual-principal fence at the exact target.

Success returns an RS256 invocation JWT whose `sub` is the direct or attached
account, whose optional `act.sub` is the distinct virtual Actor, whose target
fence is the request target, and whose origin is the Run ID. It has no
`session_id`.

Unknown or disabled identity, missing standing, and a target outside the
virtual-principal fence are concealed as `NOT_FOUND`.

### Invocation signing

Every issued invocation uses the one current active key, the configured
installation issuer and internal audience, a unique token ID, and a maximum
lifetime of 60 seconds. `iat`, `nbf`, and `exp` are bounded from the current
time and use whole Unix-second precision. The separately returned absolute
expiry equals the JWT `exp` instant exactly. A token has exactly one Session
or Run origin and never contains a Role, grant, capability, permission
snapshot, Kubernetes identity, or nested Actor.

Before serving issuance, readiness proves that the projected private key is
valid RS256 material and matches the one active public-key record. Signing or
key-state failure is `UNAVAILABLE`.

## Admission and invocation identity

Every operation authenticates a bound Kubernetes ServiceAccount token.
`ExchangeSession` admits only the purpose-bound `ctlflow-edged` audience.
`GetInvocationVerificationKeys` uses the installation internal audience and
admits any valid installation-issued bound workload token because it returns
only public verification material. Every remaining operation uses the
installation internal audience.

Autonomous kernel callers use an exact per-operation ServiceAccount allowlist:

| Operation | Caller |
| --- | --- |
| `GetInvocationVerificationKeys` | Any valid installation-issued bound workload token |
| `ResolvePrincipal` | `SERVICE/svc_policyd` |
| `ListPrincipalGroups` | `SERVICE/svc_policyd` |
| `CreateSession` | `SERVICE/svc_authd` |
| `RevokeSession` | `SERVICE/svc_authd` |
| `IssueRunInvocation` | `SERVICE/svc_execd` |
| `GetLoginProvider` | `SERVICE/svc_authd` or an admitted capability caller |
| `ListLoginProviders` | admitted capability caller |
| `ListWorkspaceLoginProviderAdmissions` | `SERVICE/svc_authd` or an admitted capability caller |

Installation configuration maps the canonical principals for exact-caller
operations to Kubernetes ServiceAccount subjects. Startup fails when one of
those operations has an empty caller set or a configured subject is malformed.
This mapping applies to neither `ExchangeSession` nor
`GetInvocationVerificationKeys`; their fixed admission rules above are
complete.

Every administration operation admits only a finite per-operation set of
product-backend ServiceAccount subjects. It requires a valid invocation JWT,
applies its target fence before authorization, constructs the operation and
path from validated values, and calls `policyd.CheckAccess` as
`SERVICE/svc_identityd`. The unchanged invocation JWT is forwarded. Identityd
never accepts a caller-supplied capability, resource path, Role, Group set,
Actor, or attached account.

The requested domain target and the Policyd target are identical except when a
Tenant-scoped invocation administers one of that Tenant's Workspaces. In that
case Identityd sends the Tenant as the Policyd target while the canonical
resource path retains the exact descendant Workspace. Policyd therefore
re-establishes Tenant standing and evaluates only an explicit Tenant-target
grant for that descendant path. This permits first-member and first-provider
admission bootstrap without treating Tenant policy as inherited Workspace
policy. A Workspace-scoped invocation sends its exact Workspace as the Policyd
target and requires current standing and authority there.

For each provider-read operation, the autonomous Authd caller set and the
capability-caller set are disjoint. Identityd fails startup on an overlap;
caller configuration cannot make one ServiceAccount ambiguously autonomous
and invocation-authorized for the same operation.

Policyd may re-enter only `ResolvePrincipal` and `ListPrincipalGroups` while
deciding an Identityd administration call. Those two fact operations admit
only Policyd and never call Policyd, so this call graph cannot recurse.

The complete Identityd capability catalog is:

| Identityd operation | Required capability | Canonical resource path |
| --- | --- | --- |
| `AddTenantMember` | `tenant_memberships.add` | `/tenants/<tenant_id>/members/<account_id>` |
| `RemoveTenantMember` | `tenant_memberships.remove` | `/tenants/<tenant_id>/members/<account_id>` |
| `ListTenantMembers` | `tenant_memberships.read` | `/tenants/<tenant_id>/members` |
| `AddWorkspaceMember` | `workspace_memberships.add` | `/tenants/<tenant_id>/workspaces/<workspace_id>/members/<account_id>` |
| `RemoveWorkspaceMember` | `workspace_memberships.remove` | `/tenants/<tenant_id>/workspaces/<workspace_id>/members/<account_id>` |
| `ListWorkspaceMembers` | `workspace_memberships.read` | `/tenants/<tenant_id>/workspaces/<workspace_id>/members` |
| `CreateGroup` | `groups.create` | Exact target plus `/groups/<group_id>` |
| `DeleteGroup` | `groups.delete` | Exact target plus `/groups/<group_id>` |
| `ListGroups` | `groups.read` | Exact target plus `/groups` |
| `AddGroupMember` | `group_memberships.add` | Exact target plus `/groups/<group_id>/members/<principal_id>` |
| `RemoveGroupMember` | `group_memberships.remove` | Exact target plus `/groups/<group_id>/members/<principal_id>` |
| `ListGroupMembers` | `group_memberships.read` | Exact target plus `/groups/<group_id>/members` |
| `CreateVirtualPrincipal` | `virtual_principals.create` | Exact target plus `/virtual-principals/<principal_id>` |
| `GetVirtualPrincipal`, `ListVirtualPrincipals` | `virtual_principals.read` | Exact target plus `/virtual-principals` and optional principal ID |
| `SetVirtualPrincipalEnabled` | `virtual_principals.set_enabled` | Exact target plus `/virtual-principals/<principal_id>` |
| `CreateExternalIdentityLink` | `external_identity_links.create` | `/tenants/<tenant_id>/login-providers/<provider_id>/identity-links` |
| `DeleteExternalIdentityLink` | `external_identity_links.delete` | `/tenants/<tenant_id>/login-providers/<provider_id>/identity-links` |
| `ListExternalIdentityLinks` | `external_identity_links.read` | `/tenants/<tenant_id>/login-providers/<provider_id>/identity-links` |
| `CreateLoginProvider` | `login_providers.create` | `/tenants/<tenant_id>/login-providers/<provider_id>` |
| `GetLoginProvider`, `ListLoginProviders` | `login_providers.read` | Provider collection and optional exact provider path |
| `UpdateLoginProvider` | `login_providers.update` | `/tenants/<tenant_id>/login-providers/<provider_id>` |
| `SetLoginProviderState` | `login_providers.set_state` | `/tenants/<tenant_id>/login-providers/<provider_id>` |
| `SetWorkspaceLoginProviderAdmission` | `workspace_login_provider_admissions.set` | `/tenants/<tenant_id>/workspaces/<workspace_id>/login-providers/<provider_id>` |
| `ListWorkspaceLoginProviderAdmissions` | `workspace_login_provider_admissions.read` | `/tenants/<tenant_id>/workspaces/<workspace_id>/login-providers` |

The requested domain target is either `/tenants/<tenant_id>` or
`/tenants/<tenant_id>/workspaces/<workspace_id>`. An account or virtual
principal ID is one canonical path segment. A Workspace-scoped invocation
cannot administer its parent Tenant or a sibling Workspace. A Tenant-scoped
invocation may administer that Tenant and its Workspaces through explicit
Tenant-target grants over the canonical descendant paths. A target outside the
invocation fence is concealed as `NOT_FOUND` before Policyd is called.

`GetInvocationVerificationKeys`, `CreateSession`, `ExchangeSession`,
`RevokeSession`, `IssueRunInvocation`, and Authd's login-provider reads require
workload authentication but no existing invocation JWT. `ResolvePrincipal`,
`ListPrincipalGroups`, and every capability call additionally require the
unchanged invocation JWT being evaluated. Identityd validates its RS256
signature against current local active or retiring keys, issuer, internal
audience, subject, optional single Actor, Tenant and optional Workspace fence,
origin, unique token ID, and bounded times. Its maximum lifetime is 60
seconds. A Session origin and Run origin are mutually exclusive.

A request field cannot replace the authenticated workload, invocation Actor,
attached account, or target fence. Every call uses private TLS, finite
deadline, cancellation, and W3C trace context.

## Errors

| gRPC status | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | A non-credential request field or bound is malformed |
| `NOT_FOUND` | Current policy-target identity, attachment, standing, or invocation fence cannot be established |
| `ALREADY_EXISTS` | An immutable principal, Group, provider, or external identity mapping conflicts |
| `FAILED_PRECONDITION` | Current standing, child records, provider state, or target relationship forbids the mutation |
| `ABORTED` | A required expected revision is not current |
| `UNAUTHENTICATED` | Workload, required invocation identity, external login identity, or Session credential is missing or invalid |
| `PERMISSION_DENIED` | The authenticated workload is not admitted for the operation |
| `UNAVAILABLE` | Persistence, signing, required key state, Policyd, or obligatory audit delivery is unavailable, incompatible, or malformed |
| `CANCELLED` / `DEADLINE_EXCEEDED` | The operation did not complete |

Raw storage, token, key, and stack diagnostics never cross the boundary.

## Persistence and runtime

Identityd is durable. Its implementation reads only its own Knex-migrated
database. The logical schema contains principals, Tenant Memberships,
Workspace Memberships, Groups, direct Group memberships, and invocation
verification keys, external identity links, login providers, Workspace
login-provider admissions, and Sessions.

Migrations contain structural tables, keys, foreign keys, uniqueness, bounds,
indexes, and representation checks only. No trigger, stored procedure,
database function, computed side effect, or SQL-resident behavior implements
attachment, standing, fencing, pagination, key admission, or identity rules.
Every decision is explicit implementation-language Domain code.

Every actual administration mutation, successful `CreateSession`, and actual
`RevokeSession` mutation creates typed Identityd audit evidence. Identityd calls
`auditd.RecordAuditBatch` directly after committing the Identityd mutation and
before returning success. It holds no database transaction during Policyd or
Auditd calls and has no audit table, outbox, queue, retry journal, or fallback.
Audit failure is `UNAVAILABLE` and does not roll back committed Identityd
state.

The administration audit contract distinguishes Membership, Group,
Group-member, virtual-principal, external-link, login-provider, and Workspace
provider-admission mutations. It records the typed action, exact Tenant and
optional Workspace target, non-secret resource IDs, resulting revision when a
record has one, authenticated invocation attribution, occurrence time, and
trace correlation. External provider subjects, configuration/secret
references, credentials, and request bodies are never audit fields.

The exact typed Session actions remain `CREATED` and `REVOKED`. A Session event
is Tenant-partitioned and contains a canonical `evt_<32 lower-hex>` source
event ID, Session ID, human account principal ID, resulting positive Session
revision, action, authenticated Authd workload, occurrence time, and trace
correlation. It contains no credential, digest, provider identity, invocation
token, signing material, or generic operation string.

Session exchange, invocation issuance, fact reads, no-op revocation,
administration reads and no-ops, rejections, and dependency failures create no
audit event.

Every operation emits bounded OpenTelemetry traces, metrics, and structured
logs. Telemetry excludes principal, account, Tenant, Workspace, Group, key,
token, and request-body values. Telemetry failure is bounded and does not
change an operation result.

The shipping process exposes standard health and readiness endpoints on a
separate probe-only listener. Readiness verifies the exact current migration
ledger and mapped schema. The private gRPC listener uses
installation-provisioned server TLS. Process-private files supply the server
identity, workload-validation material, active signing key, and Auditd client
identity. Operational endpoints are not Identityd domain operations.

## Verification

Canonical integration evidence covers:

- the exact 33-method descriptor and every documented status;
- exact per-operation workload admission;
- exactly one active and up to seven retiring keys, deterministic order,
  bounded expiry, private/public mismatch, malformed key state, and source
  outage;
- human, service, and virtual principal facts;
- immutable virtual attachment and Tenant/Workspace fences;
- direct and virtual invocation binding;
- Tenant standing and Workspace standing with required parent Membership;
- enabled and disabled principal and account facts;
- exact-scope direct Groups, keyset pagination, and concurrent inserts;
- account creation through Tenant standing, required parent standing,
  idempotent add/remove, and child-record removal guards;
- Group creation, exact-target direct membership, virtual-principal standing,
  member pagination, and transactional Group deletion;
- virtual-principal creation, immutable attachment/fences, optimistic enable
  changes, and exact-fence reads;
- external-link create/replay/conflict/delete/list behavior without provider
  subject leakage;
- login-provider immutable IDs, optimistic metadata/state changes, terminal
  deletion, permanent reservation, and Configd-reference bounds;
- Workspace provider admission, same-Tenant fencing, provider-state filtering,
  pagination, and provider-deletion cleanup;
- real capability authorization through Policyd and non-recursive Policyd
  re-entry through the existing fact operations;
- external-identity resolution without caller-supplied account identity;
- one-time credential return, digest-only persistence, immutable provider
  retention, finite Session expiry, Workspace provider-admission enforcement,
  idempotent revocation, and restart persistence;
- Session-origin and Run-origin token claims, target fencing, distinct virtual
  Actor attachment, signing failure, and signature verification through the
  public-key operation;
- direct typed Auditd delivery for every actual administration mutation,
  Session creation, and actual revocation, plus no-op behavior and Auditd
  failure;
- malformed selectors, hidden cross-target data, and corrupt stored facts;
- cancellation, deadline, restart, and incompatible schema;
- redacted correlated traces, metrics, logs, and database spans;
- bounded Collector outage; and
- implementation release gates, generated persistence-model selection,
  migration-image execution, and shipping Kubernetes assets.

There is no public listener, HTTP API, operator API, Role or grant API,
decision API, provider-protocol API, account update/delete API, key mutation
API, watch, stream, cursor table, audit outbox, or test-only production path in
Identityd.
