---
title: identityd API
description: Identity administration, Sessions, verification keys, and invocation issuance over gRPC.
weight: 20
---

`identityd` owns identity facts, login registration, and short-lived
invocation identity. Its
checked contract is
[`ctlflow.identity.v1.IdentityService`](https://github.com/control-flow-project/ctlflow/blob/main/services/identityd/api/proto/v1/identityd.proto).
All 33 methods are unary gRPC. See the
[identityd service specification](../../identityd/) for standing, fence,
signing, and persistence rules.

## Service definition

```proto
service IdentityService {
  rpc GetInvocationVerificationKeys(GetInvocationVerificationKeysRequest)
      returns (GetInvocationVerificationKeysResponse);
  rpc ResolvePrincipal(ResolvePrincipalRequest)
      returns (ResolvePrincipalResponse);
  rpc ListPrincipalGroups(ListPrincipalGroupsRequest)
      returns (ListPrincipalGroupsResponse);

  rpc AddTenantMember(AddTenantMemberRequest) returns (TenantMember);
  rpc RemoveTenantMember(RemoveTenantMemberRequest)
      returns (RemoveTenantMemberResponse);
  rpc ListTenantMembers(ListTenantMembersRequest)
      returns (ListTenantMembersResponse);
  rpc AddWorkspaceMember(AddWorkspaceMemberRequest)
      returns (WorkspaceMember);
  rpc RemoveWorkspaceMember(RemoveWorkspaceMemberRequest)
      returns (RemoveWorkspaceMemberResponse);
  rpc ListWorkspaceMembers(ListWorkspaceMembersRequest)
      returns (ListWorkspaceMembersResponse);

  rpc CreateGroup(CreateGroupRequest) returns (Group);
  rpc DeleteGroup(DeleteGroupRequest) returns (DeleteGroupResponse);
  rpc ListGroups(ListGroupsRequest) returns (ListGroupsResponse);
  rpc AddGroupMember(AddGroupMemberRequest) returns (GroupMember);
  rpc RemoveGroupMember(RemoveGroupMemberRequest)
      returns (RemoveGroupMemberResponse);
  rpc ListGroupMembers(ListGroupMembersRequest)
      returns (ListGroupMembersResponse);

  rpc CreateVirtualPrincipal(CreateVirtualPrincipalRequest)
      returns (VirtualPrincipal);
  rpc GetVirtualPrincipal(GetVirtualPrincipalRequest)
      returns (VirtualPrincipal);
  rpc ListVirtualPrincipals(ListVirtualPrincipalsRequest)
      returns (ListVirtualPrincipalsResponse);
  rpc SetVirtualPrincipalEnabled(SetVirtualPrincipalEnabledRequest)
      returns (VirtualPrincipal);

  rpc CreateExternalIdentityLink(CreateExternalIdentityLinkRequest)
      returns (ExternalIdentityLink);
  rpc DeleteExternalIdentityLink(DeleteExternalIdentityLinkRequest)
      returns (DeleteExternalIdentityLinkResponse);
  rpc ListExternalIdentityLinks(ListExternalIdentityLinksRequest)
      returns (ListExternalIdentityLinksResponse);

  rpc CreateLoginProvider(CreateLoginProviderRequest)
      returns (LoginProvider);
  rpc GetLoginProvider(GetLoginProviderRequest) returns (LoginProvider);
  rpc ListLoginProviders(ListLoginProvidersRequest)
      returns (ListLoginProvidersResponse);
  rpc UpdateLoginProvider(UpdateLoginProviderRequest)
      returns (LoginProvider);
  rpc SetLoginProviderState(SetLoginProviderStateRequest)
      returns (LoginProvider);
  rpc SetWorkspaceLoginProviderAdmission(
      SetWorkspaceLoginProviderAdmissionRequest)
      returns (SetWorkspaceLoginProviderAdmissionResponse);
  rpc ListWorkspaceLoginProviderAdmissions(
      ListWorkspaceLoginProviderAdmissionsRequest)
      returns (ListWorkspaceLoginProviderAdmissionsResponse);

  rpc CreateSession(CreateSessionRequest) returns (CreateSessionResponse);
  rpc ExchangeSession(ExchangeSessionRequest) returns (IssueInvocationResponse);
  rpc RevokeSession(RevokeSessionRequest) returns (RevokeSessionResponse);
  rpc IssueRunInvocation(IssueRunInvocationRequest)
      returns (IssueInvocationResponse);
}
```

## Operation inventory

| Method | Request fields | Returns | Primary callers |
| --- | --- | --- | --- |
| `GetInvocationVerificationKeys` | none | active and retiring public keys, cache expiry | Any valid installation-issued bound workload token, including Execd-realized product workloads |
| `ResolvePrincipal` | `principal_id`, `tenant_id`, optional `workspace_id` | principal, attached account, standing revisions | `policyd` |
| `ListPrincipalGroups` | target selector, `page_size`, optional `after_group_id` | Group ID page | `policyd` |
| `AddTenantMember` | `tenant_id`, `account_id` | Tenant member | admitted admin backend |
| `RemoveTenantMember` | same selector | empty | admitted admin backend |
| `ListTenantMembers` | `tenant_id`, keyset page | Tenant-member page | admitted admin backend |
| `AddWorkspaceMember` | `tenant_id`, `workspace_id`, `account_id` | Workspace member | admitted admin backend |
| `RemoveWorkspaceMember` | same selector | empty | admitted admin backend |
| `ListWorkspaceMembers` | exact target, keyset page | Workspace-member page | admitted admin backend |
| `CreateGroup`, `DeleteGroup`, `ListGroups` | Group ID where applicable, exact target, keyset page where applicable | Group, empty, or Group page | admitted admin backend |
| `AddGroupMember`, `RemoveGroupMember`, `ListGroupMembers` | Group ID, exact target, principal ID or keyset page | Group member, empty, or member page | admitted admin backend |
| `CreateVirtualPrincipal`, `GetVirtualPrincipal`, `ListVirtualPrincipals` | principal/attached account where applicable, exact immutable fence, keyset page where applicable | virtual principal or page | admitted agent/admin backend |
| `SetVirtualPrincipalEnabled` | principal ID, exact fence, expected revision, enabled | virtual principal | admitted agent/admin backend |
| `CreateExternalIdentityLink`, `DeleteExternalIdentityLink`, `ListExternalIdentityLinks` | exact Tenant/provider/subject mapping or provider-scoped keyset page | link, empty, or link page | admitted admin backend |
| `CreateLoginProvider`, `ListLoginProviders` | exact Tenant/provider metadata and Configd refs for create, or a keyset page for list | login provider or page | admitted admin backend |
| `GetLoginProvider` | exact Tenant and provider ID | login provider | admitted admin backend; also admits `authd` |
| `UpdateLoginProvider`, `SetLoginProviderState` | exact Tenant/provider, expected revision, replacement metadata or state | login provider | admitted admin backend |
| `SetWorkspaceLoginProviderAdmission`, `ListWorkspaceLoginProviderAdmissions` | exact Tenant/Workspace/provider and admitted value, or keyset page | admission state or page | admitted admin backend; list also admits `authd` |
| `CreateSession` | `tenant_id`, `provider_id`, `provider_subject` | opaque Session ID, credential, expiry | `authd` |
| `ExchangeSession` | Session credential and exact target | invocation JWT and expiry | `edged` |
| `RevokeSession` | Session credential | empty success | `authd` |
| `IssueRunInvocation` | `principal_id`, exact target, `run_id` | invocation JWT and expiry | `execd` |

Identityd does not expose a generic token mint, token introspection, Session
list, Session administration, Role/grant/decision method, provider secret,
automatic admission rule, watch, or stream.

Administration always mutates or reads the exact requested domain target. A
Tenant-scoped invocation authorizing a descendant Workspace operation uses the
Tenant as the Policyd target and keeps the Workspace in the canonical resource
path. A Workspace-scoped invocation uses that exact Workspace as the Policyd
target. The first form requires an explicit Tenant-target grant and current
Tenant standing; it does not inherit Workspace policy.

## Verification keys

`GetInvocationVerificationKeys` takes an empty message and returns a bounded
set of RS256 public keys:

```json
{
  "keys": [
    {
      "keyId": "invocation-2026-07",
      "algorithm": "VERIFICATION_KEY_ALGORITHM_RS256",
      "modulusBase64url": "uQ3...bounded-public-modulus",
      "exponentBase64url": "AQAB"
    }
  ],
  "expiresAt": "2026-07-29T09:00:00Z"
}
```

The response contains public verification material only. Callers cache it no
longer than `expires_at` and refresh on expiry or an unknown key ID. Identityd
never returns private signing material.

## Principal facts

`ResolvePrincipal` answers whether one principal and its attached account are
currently valid at one exact Tenant or Workspace target.

Request:

```json
{
  "principalId": "agent:personal-reviewer",
  "tenantId": "northwind",
  "workspaceId": "atlas"
}
```

Response:

```json
{
  "principalId": "agent:personal-reviewer",
  "principalKind": "PRINCIPAL_KIND_VIRTUAL",
  "principalEnabled": true,
  "principalRevision": "4",
  "subjectAccountId": "user:maya",
  "subjectAccountEnabled": true,
  "subjectAccountRevision": "12",
  "membershipRevision": "7"
}
```

The virtual principal is the Actor. `subject_account_id` is the existing
human or service account to which it is attached. Policyd evaluates both
identities; a virtual principal cannot gain authority that its attached
account lacks.

`PrincipalKind` is closed over:

```text
PRINCIPAL_KIND_HUMAN
PRINCIPAL_KIND_SERVICE
PRINCIPAL_KIND_VIRTUAL
```

## Group pagination

`ListPrincipalGroups` evaluates current direct groups at the same target used
for `ResolvePrincipal`.

```json
{
  "principalId": "agent:personal-reviewer",
  "tenantId": "northwind",
  "workspaceId": "atlas",
  "pageSize": 50
}
```

```json
{
  "groupIds": [
    "atlas_reviewers",
    "legal_automation"
  ]
}
```

When another page exists, `next_after_group_id` is the last emitted immutable
Group ID. Identityd returns identity facts only; it does not return grants or
an authorization decision.

## Administration

Every administration request carries the calling product workload's bound
token and the unchanged User invocation JWT as transport metadata. Request
fields never contain an Actor, Role, capability, or resource path.

### Memberships

Adding Tenant standing may create a missing account from its canonical prefix:

```json
{
  "tenantId": "northwind",
  "accountId": "user:maya"
}
```

```json
{
  "accountId": "user:maya",
  "accountKind": "PRINCIPAL_KIND_HUMAN",
  "accountEnabled": true,
  "accountRevision": "1",
  "tenantId": "northwind",
  "membershipRevision": "1"
}
```

Workspace standing names both parent and child:

```json
{
  "tenantId": "northwind",
  "workspaceId": "atlas",
  "accountId": "user:maya"
}
```

List requests use `pageSize` and the last emitted immutable account ID:

```json
{
  "tenantId": "northwind",
  "workspaceId": "atlas",
  "pageSize": 50,
  "afterAccountId": "user:liam"
}
```

The response contains `members` and `nextAfterAccountId` only when another
page exists. Remove requests use the same exact selector and return an empty
message.

### Groups and virtual principals

A Group has one exact target:

```json
{
  "groupId": "deal_team",
  "tenantId": "northwind",
  "workspaceId": "atlas"
}
```

Adding a direct member uses that same target:

```json
{
  "groupId": "deal_team",
  "tenantId": "northwind",
  "workspaceId": "atlas",
  "principalId": "user:maya"
}
```

The member response contains the Group ID, principal ID, and closed
`PrincipalKind`. Lists use `afterGroupId` or `afterPrincipalId` and the common
page-size bounds.

Creating an agent identity binds it permanently to one account and fence:

```json
{
  "principalId": "agent:personal_reviewer",
  "subjectAccountId": "user:maya",
  "tenantId": "northwind",
  "workspaceId": "atlas"
}
```

```json
{
  "principalId": "agent:personal_reviewer",
  "subjectAccountId": "user:maya",
  "enabled": true,
  "revision": "1",
  "tenantId": "northwind",
  "workspaceId": "atlas"
}
```

Only enabled state is mutable:

```json
{
  "principalId": "agent:personal_reviewer",
  "tenantId": "northwind",
  "workspaceId": "atlas",
  "expectedRevision": "1",
  "enabled": false
}
```

### Login identity

A provider registration points to exact Configd versions and contains no
material:

```json
{
  "tenantId": "northwind",
  "providerId": "workforce",
  "displayName": "Northwind workforce",
  "configurationId": "oidc_workforce",
  "configurationVersionId": "oidc_workforce_0001",
  "secretId": "oidc_workforce_secret",
  "secretVersionId": "oidc_workforce_secret_0001"
}
```

```json
{
  "tenantId": "northwind",
  "providerId": "workforce",
  "displayName": "Northwind workforce",
  "configurationId": "oidc_workforce",
  "configurationVersionId": "oidc_workforce_0001",
  "secretId": "oidc_workforce_secret",
  "secretVersionId": "oidc_workforce_secret_0001",
  "state": "LOGIN_PROVIDER_STATE_ACTIVE",
  "revision": "1"
}
```

`UpdateLoginProvider` replaces the display name and all four references at one
`expectedRevision`. `SetLoginProviderState` supplies the same selector,
expected revision, and one of `ACTIVE`, `DISABLED`, or `DELETED`. Deleted IDs
remain reserved and disappear from get/list results.

Workspace SSO is an explicit allowlist:

```json
{
  "tenantId": "northwind",
  "workspaceId": "atlas",
  "providerId": "workforce",
  "admitted": true
}
```

The response contains the admission when `admitted` is true and omits it after
removal. The list returns provider IDs in ascending order. It does not create a
member, Role, domain rule, or account.

An external identity link is a separate exact mapping:

```json
{
  "tenantId": "northwind",
  "providerId": "workforce",
  "providerSubject": "00u7example",
  "accountId": "user:maya"
}
```

Authd supplies only the first three fields to `CreateSession`; it cannot select
the mapped account.

## Browser Session flow

Authd creates a Session only after validating the provider result:

```json
{
  "tenantId": "northwind",
  "providerId": "workforce",
  "providerSubject": "00u7example"
}
```

```json
{
  "sessionId": "0123456789abcdef0123456789abcdef",
  "sessionCredential": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  "expiresAt": "2026-08-05T08:30:00Z"
}
```

The credential is an opaque 32-byte value. Authd stores it in the secure
browser cookie; it must not be logged or treated as an invocation JWT.

For an application request, Edged exchanges that credential for the target
fixed by its binding:

```json
{
  "sessionCredential": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  "tenantId": "northwind",
  "workspaceId": "atlas"
}
```

```json
{
  "invocationJwt": "<redacted short-lived JWT>",
  "expiresAt": "2026-07-29T08:35:00Z"
}
```

Identityd derives the account from the Session, validates current standing,
and signs the exact target fence. Edged cannot request a different account or
claim set.

Logout sends only the credential:

```json
{
  "sessionCredential": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
}
```

`RevokeSession` returns an empty message after an actual revocation. Repeating
revocation has the contract-defined idempotent result.

## Run invocation flow

Execd asks Identityd to issue a short-lived invocation for one admitted finite
Run:

```json
{
  "principalId": "agent:personal-reviewer",
  "tenantId": "northwind",
  "workspaceId": "atlas",
  "runId": "run_01k1b9cd"
}
```

Identityd resolves the Actor, derives the attached account when the Actor is
virtual, validates standing and the Run target, and returns the same
`IssueInvocationResponse` shape used by `ExchangeSession`. Execd cannot
supply an attached account, issuer, audience, key, permission, or arbitrary
claim.

## Outcomes

| Status | Identityd meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Invalid selector, credential shape, Run ID, or page input |
| `UNAUTHENTICATED` | Workload authentication, Session credential, or invocation proof is invalid |
| `PERMISSION_DENIED` | Authenticated caller is not admitted for the operation |
| `NOT_FOUND` | Principal, external link, Session, target standing, or Run Actor is not visible |
| `ALREADY_EXISTS` | An immutable ID or identity mapping conflicts |
| `FAILED_PRECONDITION` | Current standing, children, provider, identity, or target state forbids the operation |
| `ABORTED` | An expected provider or virtual-principal revision is stale |
| `UNAVAILABLE` | Persistence, signing custody, Policyd, or required Auditd delivery is unavailable |
| `CANCELLED`, `DEADLINE_EXCEEDED` | The unary call did not complete |

Every actual administration mutation, Session creation, and actual revocation
is audited through Auditd. Reads, no-ops, and invocation issuance do not emit a
mutation event.
