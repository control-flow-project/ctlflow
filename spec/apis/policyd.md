---
title: policyd API
description: Capability authorization decision contract and request flow.
weight: 30
---

`policyd` owns path-and-operation authorization decisions. Its checked
contract is
[`ctlflow.policy.v1.PolicyService`](https://github.com/control-flow-project/ctlflow/blob/main/services/policyd/api/proto/v1/policyd.proto).
It has one unary gRPC method. See the
[policyd service specification](../../policyd/) for grant matching and
resource-path rules.

## Service definition

```proto
service PolicyService {
  rpc CheckAccess(CheckAccessRequest) returns (CheckAccessResponse);
}
```

## CheckAccess

`CheckAccess` evaluates one operation against one canonical resource path for
the independently authenticated invocation Actor.

Request fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `operation` | string | Immutable operation token. Policyd classifies the authenticated caller first, so a kernel service and a package may use the same lexical token without crossing authority |
| `resource_path` | string | Canonical operation-specific path built by that owner |
| `tenant_id` | string | Exact Tenant policy target for standing and policy evaluation |
| `workspace_id` | optional string | Present only when the policy target is one exact Workspace |

Response:

| Field | Type | Meaning |
| --- | --- | --- |
| `decision` | `AccessDecision` | `ACCESS_DECISION_ALLOW` or `ACCESS_DECISION_DENY` |

`ACCESS_DECISION_UNSPECIFIED` is a wire sentinel and is never a valid
successful response.

## Example

A product backend asks Tenantd to change a Tenant display name. Tenantd
authenticates the backend, validates the invocation JWT, constructs the
operation token and path from its own catalog, then calls Policyd:

```json
{
  "operation": "tenants.update_display_name",
  "resourcePath": "/tenants/northwind",
  "tenantId": "northwind"
}
```

Allowed response:

```json
{
  "decision": "ACCESS_DECISION_ALLOW"
}
```

Denied response:

```json
{
  "decision": "ACCESS_DECISION_DENY"
}
```

Both responses use gRPC status `OK`. The owner translates a deny into its own
`PERMISSION_DENIED` result without executing the mutation.

## Decision flow

```text
product backend
  -> tenantd.UpdateTenant
       immediate caller: bound workload token
       Actor context: validated invocation JWT
       |
       | CheckAccess(
       |   tenants.update_display_name,
       |   /tenants/northwind,
       |   northwind)
       v
     policyd
       -> identityd.ResolvePrincipal
       -> identityd.ListPrincipalGroups
       -> evaluate current direct grants
       <- allow | deny
```

Actor and attached account are not request fields. Policyd gets them from the
validated invocation JWT and current Identityd facts. The calling service
cannot supply a Role, Group list, grant, decision cache key, or reusable
authorization credential.

### Product workload example

A realized chat workload enforces one operation declared by its admitted
Package generation:

```json
{
  "operation": "messages.post",
  "resourcePath": "/tenants/northwind/workspaces/atlas/apps/chat_atlas/topics/general",
  "tenantId": "northwind",
  "workspaceId": "atlas"
}
```

```text
chat workload
  -> identityd.GetInvocationVerificationKeys   on cache miss
  -> policyd.CheckAccess
       -> execd.ResolveWorkloadOperationBinding
       -> apply Placement and App fences
       -> identityd.ResolvePrincipal
       -> identityd.ListPrincipalGroups
       -> evaluate (package, chat, messages.post)
       <- allow | deny
```

The lexical operation token is namespaced by the Package ID returned by Execd.
Another Package may declare `messages.post` without sharing its grants.

## Matching

The decision is allow only when all required conditions hold:

1. the immediate workload owns the declared operation;
2. the invocation Actor and attached account have current policy-target standing;
3. the canonical operation and resource path are valid for that owner;
4. a current direct principal, attached-account, or Group grant matches; and
5. no target or revision fence fails.

There are no deny rules. Absence of a current matching allow produces
`ACCESS_DECISION_DENY`.

## Outcomes

| Status | Policyd meaning |
| --- | --- |
| `OK` | A closed `ALLOW` or `DENY` decision was produced |
| `INVALID_ARGUMENT` | Operation, path, or target shape is malformed |
| `UNAUTHENTICATED` | Workload or invocation identity is invalid |
| `PERMISSION_DENIED` | The immediate workload does not own the operation |
| `NOT_FOUND` | The policy target lies outside visible standing |
| `UNAVAILABLE` | Policy persistence, Execd authority, or required Identityd facts are unavailable |
| `CANCELLED`, `DEADLINE_EXCEEDED` | The unary call did not complete |

Checks are ephemeral reads. Policyd does not mint a reusable decision token,
emit a mutation audit event, or expose an explain operation.
