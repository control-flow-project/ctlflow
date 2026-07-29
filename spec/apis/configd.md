---
title: configd API
description: Scoped configuration, secret custody, and projection operations over gRPC.
weight: 50
---

`configd` owns versioned non-secret configuration, encrypted secret custody,
and exact consumer projections. Its checked contract is
[`ctlflow.configuration.v1.ConfigurationService`](https://github.com/control-flow-project/ctlflow/blob/main/services/configd/api/proto/v1/configd.proto).
All five methods are unary gRPC. See the
[configd service specification](../../configd/) for custody, authorization,
and Kubernetes ownership.

## Service definition

```proto
service ConfigurationService {
  rpc PublishConfiguration(PublishConfigurationRequest)
      returns (PublishConfigurationResponse);
  rpc ResolveConfiguration(ResolveConfigurationRequest)
      returns (ResolveConfigurationResponse);
  rpc PublishSecret(PublishSecretRequest)
      returns (PublishSecretResponse);
  rpc GetSecretMetadata(GetSecretMetadataRequest)
      returns (GetSecretMetadataResponse);
  rpc ApplyProjection(ApplyProjectionRequest) returns (Projection);
}
```

## Operation inventory

| Method | Request fields | Returns | Purpose |
| --- | --- | --- | --- |
| `PublishConfiguration` | identity, binding, optional expected revision, JSON bytes, optional claim pair | configuration and version metadata | Publishes one immutable non-secret version and makes it current. |
| `ResolveConfiguration` | identity, exact version, binding | metadata and JSON bytes | Reads one exact configuration version. |
| `PublishSecret` | identity, binding, optional expected revision, material bytes, optional claim pair | secret and version metadata | Publishes one immutable secret version without returning its material. |
| `GetSecretMetadata` | secret identity and binding | secret and current-version metadata | Reads metadata only. |
| `ApplyProjection` | exact configuration or secret version plus binding | `Projection` | Materializes one admitted version for one exact consumer. |

Configd has no secret-material read, identity list, version list, binding
mutation, provider catalog, watch, stream, or delete operation.

## Consumer binding

Every managed identity is permanently bound to:

```text
Placement identity and closed scope
consumer identity
purpose
```

The protobuf shape is:

```json
{
  "placement": {
    "placementId": "workspace_atlas",
    "workspace": {
      "tenantId": "northwind",
      "workspaceId": "atlas"
    }
  },
  "consumerId": "chat_api",
  "purpose": "runtime"
}
```

Placement scope is exactly one of Global, Tenant, Workspace, or User. A User
scope contains `tenant_id` and `account_principal_id`. Binding fields cannot
be changed by publishing another version.

## Publish configuration

`content_json` contains one bounded canonical JSON document. In protobuf JSON,
the bytes appear as base64:

```json
{
  "configurationId": "chat_runtime",
  "configurationVersionId": "chat_runtime_v1",
  "binding": {
    "placement": {
      "placementId": "workspace_atlas",
      "workspace": {
        "tenantId": "northwind",
        "workspaceId": "atlas"
      }
    },
    "consumerId": "chat_api",
    "purpose": "runtime"
  },
  "contentJson": "eyJsb2dMZXZlbCI6ImluZm8ifQ=="
}
```

Decoded content:

```json
{
  "logLevel": "info"
}
```

Response:

```json
{
  "configuration": {
    "configurationId": "chat_runtime",
    "binding": {
      "placement": {
        "placementId": "workspace_atlas",
        "workspace": {
          "tenantId": "northwind",
          "workspaceId": "atlas"
        }
      },
      "consumerId": "chat_api",
      "purpose": "runtime"
    },
    "currentConfigurationVersionId": "chat_runtime_v1",
    "revision": "1",
    "createdAt": "2026-07-29T08:30:00Z",
    "updatedAt": "2026-07-29T08:30:00Z"
  },
  "version": {
    "configurationVersionId": "chat_runtime_v1",
    "configurationId": "chat_runtime",
    "contentLength": 19,
    "contentSha256": "7aU6oUQyyW8V+i3w8n31kvP3CkN/qLYIVccVXtU3TaI=",
    "createdAt": "2026-07-29T08:30:00Z"
  }
}
```

A later version includes the current positive `expected_revision`. Publishing
the same immutable version and content is retryable; changing content at an
existing version ID is not.

`ResolveConfiguration` requires the identity, exact version, and exact same
binding:

```json
{
  "configurationId": "chat_runtime",
  "configurationVersionId": "chat_runtime_v1",
  "binding": {
    "placement": {
      "placementId": "workspace_atlas",
      "workspace": {
        "tenantId": "northwind",
        "workspaceId": "atlas"
      }
    },
    "consumerId": "chat_api",
    "purpose": "runtime"
  }
}
```

It returns configuration metadata, version metadata, and the original
canonical JSON bytes.

## Publish secret

Secret publication has the same identity, revision, and binding structure,
but accepts opaque material:

```json
{
  "secretId": "chat_database",
  "secretVersionId": "chat_database_v1",
  "binding": {
    "placement": {
      "placementId": "workspace_atlas",
      "workspace": {
        "tenantId": "northwind",
        "workspaceId": "atlas"
      }
    },
    "consumerId": "chat_api",
    "purpose": "database"
  },
  "material": "c2FtcGxlLXRlc3QtdmFsdWU="
}
```

The response contains `SecretMetadata` and `SecretVersionMetadata`. It does
not echo material, material length, a digest, provider coordinates, or a
Kubernetes Secret name.

`GetSecretMetadata` accepts only `secret_id` and the exact binding. Its
response identifies the current version and revisions, never material.

## Provisioner publication

An exact configured provisioner controller may publish generated
configuration or secret output for an Execd-owned dependency claim. It
supplies both:

```json
{
  "dependencyClaimId": "claim_01k1d2",
  "dependencyClaimRevision": "3"
}
```

The pair is either wholly present or wholly absent. Configd verifies the exact
claim owner, current revision, provisioner, Placement, and Workload before
accepting the version. Ordinary operator and product-backend publication
omits both fields.

## Apply projection

Execd requests one exact target:

```json
{
  "target": {
    "secret": {
      "secretId": "chat_database",
      "secretVersionId": "chat_database_v1"
    }
  },
  "binding": {
    "placement": {
      "placementId": "workspace_atlas",
      "workspace": {
        "tenantId": "northwind",
        "workspaceId": "atlas"
      }
    },
    "consumerId": "chat_api",
    "purpose": "database"
  }
}
```

Configd validates the Execd-owned Namespace and Workload ServiceAccount,
applies its convention-named Kubernetes projection, and returns opaque
projection metadata:

```json
{
  "projectionId": "projection_01k1d4",
  "target": {
    "secret": {
      "secretId": "chat_database",
      "secretVersionId": "chat_database_v1"
    }
  },
  "binding": {
    "placement": {
      "placementId": "workspace_atlas",
      "workspace": {
        "tenantId": "northwind",
        "workspaceId": "atlas"
      }
    },
    "consumerId": "chat_api",
    "purpose": "database"
  },
  "projectionRevision": "1",
  "createdAt": "2026-07-29T08:31:00Z",
  "updatedAt": "2026-07-29T08:31:00Z"
}
```

Execd never receives the configuration content or secret material through
this method.

## Callers

| Caller | Admitted operations |
| --- | --- |
| Infrastructure operator | All management operations at every scope |
| Capability-admitted product backend | Four management operations at non-Global scope |
| Exact `SERVICE/svc_execd` workload | `ApplyProjection` only |
| Exact configured provisioner controller | Publication operations for its exact non-Global claim |

## Outcomes

| Status | Configd meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Invalid identity, binding, version, content, material, target, or claim pair |
| `NOT_FOUND` | Exact identity, version, binding, projection target, or claim is absent |
| `ALREADY_EXISTS` | Immutable identity or version is bound to different content |
| `FAILED_PRECONDITION` | Current binding, claim, owner, or projection state forbids the operation |
| `ABORTED` | `expected_revision` or dependency-claim revision is stale |
| `UNAUTHENTICATED` | Required caller or invocation identity is invalid |
| `PERMISSION_DENIED` | Caller admission or capability check failed |
| `UNAVAILABLE` | Persistence, custody, Kubernetes, or required dependency is unavailable |
| `CANCELLED`, `DEADLINE_EXCEEDED` | The unary call did not complete |
