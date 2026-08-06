---
title: pkgd API
description: Immutable Package generations and installed App intent over gRPC.
weight: 40
---

`pkgd` owns immutable Package generations and installed App intent. Its
checked contract is
[`ctlflow.packages.v1.PackageService`](https://github.com/control-flow-project/ctlflow/blob/main/services/pkgd/api/proto/v1/pkgd.proto).
All five methods are unary gRPC. See the
[pkgd service specification](../../pkgd/) for declaration validation,
admission, and audit behavior.

## Service definition

```proto
service PackageService {
  rpc DeclarePackage(DeclarePackageRequest) returns (Package);
  rpc GetPackage(GetPackageRequest) returns (Package);
  rpc CreateApp(CreateAppRequest) returns (App);
  rpc GetApp(GetAppRequest) returns (App);
  rpc SetAppPackageGeneration(SetAppPackageGenerationRequest) returns (App);
}
```

## Operation inventory

| Method | Request fields | Returns | Purpose |
| --- | --- | --- | --- |
| `DeclarePackage` | complete immutable Package generation | `Package` | Admits one exact Package generation. |
| `GetPackage` | `package_id`, `generation` | `Package` | Reads one exact generation. |
| `CreateApp` | `app_id`, scope, Placement, Package ID, desired generation | `App` | Creates installed App intent. |
| `GetApp` | `app_id` | `App` | Reads one App. |
| `SetAppPackageGeneration` | `app_id`, `expected_revision`, desired generation | `App` | Changes the App's sole mutable field. |

Pkgd does not build or transfer artifacts, list Packages or Apps, provision
dependencies, create Kubernetes resources, or manage App runtime state.

## Package declaration

A Package generation is a complete immutable declaration:

| Field | Shape | Meaning |
| --- | --- | --- |
| `package_id` | string | Stable Package identity |
| `generation` | positive uint64 | Sequential immutable generation |
| `version` | string | Package-supplied version label |
| `provenance` | `source_uri`, `source_digest` | Source identity and digest |
| `components` | component ID, OCI repository and manifest digest, and declared product operations | Independently runnable artifacts and the operations they implement |
| `interfaces` | interface ID, component, protocol, contract ID, port | Component-owned network interfaces |
| `dependencies` | name, optional ID, component, type, canonical options JSON | Required provisioned or service dependency |
| `exposures` | exposure ID and interface ID | Package interfaces that may be exposed |

Interface protocol is closed over HTTP and gRPC. Dependency options are
canonical JSON bytes; the protobuf JSON representation therefore carries them
as base64.

### Example Package

```json
{
  "packageId": "chat",
  "generation": "1",
  "version": "1.0.0",
  "provenance": {
    "sourceUri": "https://packages.example.com/chat",
    "sourceDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "components": [
    {
      "componentId": "api",
      "artifact": {
        "repository": "registry.example.com/products/chat-api",
        "manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      },
      "declaredOperations": [
        "messages.post",
        "messages.read"
      ]
    }
  ],
  "interfaces": [
    {
      "interfaceId": "http",
      "componentId": "api",
      "protocol": "INTERFACE_PROTOCOL_HTTP",
      "contractId": "chat.v1.http",
      "port": 8080
    }
  ],
  "dependencies": [
    {
      "name": "Primary database",
      "dependencyId": "database",
      "componentId": "api",
      "dependencyType": "postgresql",
      "options": {
        "canonicalJson": "eyJ2ZXJzaW9uIjoxN30="
      }
    }
  ],
  "exposures": [
    {
      "exposureId": "web",
      "interfaceId": "http"
    }
  ]
}
```

The response repeats the admitted declaration and adds `declared_at`.
Redeclaring the same Package ID and generation with identical content returns
the existing record. Different content at that identity returns
`ALREADY_EXISTS`.

## App scope

`AppScope` is a `oneof` with exactly one branch:

```json
{ "global": {} }
```

```json
{ "tenant": { "tenantId": "northwind" } }
```

```json
{
  "workspace": {
    "tenantId": "northwind",
    "workspaceId": "atlas"
  }
}
```

```json
{
  "user": {
    "tenantId": "northwind",
    "accountPrincipalId": "user:maya"
  }
}
```

The App's scope, Placement ID, and Package ID are immutable.

## Create an App

```json
{
  "appId": "chat_atlas",
  "scope": {
    "workspace": {
      "tenantId": "northwind",
      "workspaceId": "atlas"
    }
  },
  "placementId": "workspace_atlas",
  "packageId": "chat",
  "desiredPackageGeneration": "1"
}
```

Response:

```json
{
  "appId": "chat_atlas",
  "scope": {
    "workspace": {
      "tenantId": "northwind",
      "workspaceId": "atlas"
    }
  },
  "placementId": "workspace_atlas",
  "packageId": "chat",
  "desiredPackageGeneration": "1",
  "revision": "1",
  "createdAt": "2026-07-29T08:30:00Z",
  "updatedAt": "2026-07-29T08:30:00Z"
}
```

Creating an App records desired installation identity. It does not start a
process. Execd later reads the App and exact Package generation while
admitting a Workload.

## Change Package generation

```json
{
  "appId": "chat_atlas",
  "expectedRevision": "1",
  "desiredPackageGeneration": "2"
}
```

The target Package generation must already exist. An exact no-op returns the
current App without advancing its revision or emitting another audit event.

## Callers

| Caller | Admitted operations |
| --- | --- |
| Infrastructure operator | All five methods |
| Exact `SERVICE/svc_execd` workload | `GetPackage`, `GetApp` |
| Configured product backend with invocation and capability | `CreateApp`, `GetApp`, `SetAppPackageGeneration` at Tenant, Workspace, or User scope |

Global App management has no product-capability path.

## Outcomes

| Status | Pkgd meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Invalid identity, generation, scope, component graph, interface, dependency, exposure, or canonical options |
| `NOT_FOUND` | Exact Package generation or App is absent or outside the invocation fence |
| `ALREADY_EXISTS` | Package generation or App ID is bound to different content |
| `FAILED_PRECONDITION` | Referenced Package generation or Placement relationship is not admissible |
| `ABORTED` | App `expected_revision` is stale |
| `UNAUTHENTICATED` | Required caller or invocation identity is invalid |
| `PERMISSION_DENIED` | Caller admission or capability check failed |
| `UNAVAILABLE` | Persistence or a required identity, policy, or audit dependency is unavailable |
| `CANCELLED`, `DEADLINE_EXCEEDED` | The unary call did not complete |
