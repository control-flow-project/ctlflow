---
title: execd API
description: Placement, Workload, and finite Run intent over gRPC.
weight: 60
---

`execd` owns Placement, Workload, and Run intent plus their bounded observed
status. Its checked contract is
[`ctlflow.execution.v1.ExecutionService`](https://github.com/control-flow-project/ctlflow/blob/main/services/execd/api/proto/v1/execd.proto).
All ten methods are unary gRPC. See the
[execd service specification](../../execd/) for admission, reconciliation,
Kubernetes ownership, and dependency-claim rules.

## Service definition

```proto
service ExecutionService {
  rpc DeclarePlacement(DeclarePlacementRequest) returns (Placement);
  rpc GetPlacement(GetPlacementRequest) returns (Placement);
  rpc ListPlacements(ListPlacementsRequest) returns (ListPlacementsResponse);

  rpc DeclareWorkload(DeclareWorkloadRequest) returns (Workload);
  rpc GetWorkload(GetWorkloadRequest) returns (Workload);
  rpc ListWorkloads(ListWorkloadsRequest) returns (ListWorkloadsResponse);

  rpc CreateRun(CreateRunRequest) returns (Run);
  rpc GetRun(GetRunRequest) returns (Run);
  rpc ListRuns(ListRunsRequest) returns (ListRunsResponse);
  rpc CancelRun(CancelRunRequest) returns (Run);
}
```

## Operation inventory

| Method | Request fields | Returns | Purpose |
| --- | --- | --- | --- |
| `DeclarePlacement` | identity, target, optional parent, constraints, desired state, optional expected revision | `Placement` | Creates or revision-controls Placement intent. |
| `GetPlacement` | `placement_id` | `Placement` | Reads intent and observed realization. |
| `ListPlacements` | exact target, page fields | Placement page | Lists Placements at one target. |
| `DeclareWorkload` | identity, Placement, declaration, optional expected revision | `Workload` | Creates or revision-controls Workload intent. |
| `GetWorkload` | `workload_id` | `Workload` | Reads intent, admitted Package snapshot, status, and endpoints. |
| `ListWorkloads` | `placement_id`, page fields | Workload page | Lists Workloads in one Placement. |
| `CreateRun` | `run_id`, `workload_id` | `Run` | Admits one execution of a finite Workload. |
| `GetRun` | `run_id` | `Run` | Reads one retained Run. |
| `ListRuns` | `workload_id`, page fields | Run page | Lists Runs for one finite Workload. |
| `CancelRun` | `run_id` | `Run` | Convergently requests cancellation of a nonterminal Run. |

There is no separate Job record or RPC. There is also no watch, wait, log,
exec, generic manifest, route, endpoint-resolution, or dependency-management
operation.

## Placement

A Placement identifies where execution and state belong. Its target is
exactly one of:

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

`PlacementConstraints` declares the finite ceiling inherited by admitted
Workloads and Runs:

| Field | Meaning |
| --- | --- |
| `admitted_modes` | Continuous, finite, or both |
| `max_replicas_per_continuous_workload` | Replica ceiling |
| `max_run_duration_seconds` | Finite Run duration ceiling |
| `max_run_attempts` | Finite Run attempt ceiling |
| `max_resources_per_execution` | CPU millis and memory bytes ceiling |
| `max_persistent_storage_bytes_per_workload` | Storage ceiling |
| `dependency_provisioners` | Exact dependency type to provisioner selections |

### Declare a Workspace Placement

```json
{
  "placementId": "workspace_atlas",
  "target": {
    "workspace": {
      "tenantId": "northwind",
      "workspaceId": "atlas"
    }
  },
  "parentPlacementId": "tenant_northwind",
  "constraints": {
    "admittedModes": [
      "WORKLOAD_MODE_CONTINUOUS",
      "WORKLOAD_MODE_FINITE"
    ],
    "maxReplicasPerContinuousWorkload": 4,
    "maxRunDurationSeconds": "3600",
    "maxRunAttempts": 3,
    "maxResourcesPerExecution": {
      "cpuMillis": 2000,
      "memoryBytes": "4294967296"
    },
    "maxPersistentStorageBytesPerWorkload": "10737418240",
    "dependencyProvisioners": [
      {
        "dependencyTypeId": "postgresql",
        "provisionerId": "postgres_standard"
      }
    ]
  },
  "desiredState": "DESIRED_STATE_ACTIVE"
}
```

The returned `Placement` adds:

| Field | Meaning |
| --- | --- |
| `revision` | Desired-intent revision |
| `realization.status_revision` | Revision of observed status |
| `realization.observed_revision` | Highest desired revision evaluated |
| `realization.phase` | `PENDING`, `READY`, `SUSPENDED`, `DEGRADED`, or `RETIRED` |
| `realization.reason` | Closed reason for the phase |
| `created_at`, `updated_at` | Record times |

RPC success means the intent was committed. It does not mean the Kubernetes
Namespace is ready.

## Workload declaration

A Workload selects one App component and one behavior:

| Field | Meaning |
| --- | --- |
| `desired_state` | `ACTIVE`, `SUSPENDED`, or `RETIRED` |
| `package_component` | App ID and component ID |
| `resources` | CPU millis and memory bytes |
| `configd_targets` | Exact configuration or secret versions by purpose |
| `dependencies` | Package dependency selections and provisioning-parameter references |
| `persistent_storage` | Named mount paths and capacities |
| `continuous` | Replica count and selected interface IDs |
| `finite` | Optional Actor principal, Run duration, and max attempts |

Exactly one of `continuous` or `finite` is present.

### Declare a continuous application

```json
{
  "workloadId": "chat_api",
  "placementId": "workspace_atlas",
  "declaration": {
    "desiredState": "DESIRED_STATE_ACTIVE",
    "packageComponent": {
      "appId": "chat_atlas",
      "componentId": "api"
    },
    "resources": {
      "cpuMillis": 500,
      "memoryBytes": "536870912"
    },
    "configdTargets": [
      {
        "purpose": "runtime",
        "configuration": {
          "configurationId": "chat_runtime",
          "configurationVersionId": "chat_runtime_v1"
        }
      },
      {
        "purpose": "database",
        "secret": {
          "secretId": "chat_database",
          "secretVersionId": "chat_database_v1"
        }
      }
    ],
    "dependencies": [
      {
        "componentId": "api",
        "dependencyName": "Primary database",
        "dependencyId": "database",
        "provisioningParameters": []
      }
    ],
    "persistentStorage": [],
    "continuous": {
      "replicas": 2,
      "interfaceIds": [
        "http"
      ]
    }
  }
}
```

Before committing, Execd reads the App and exact Package generation from
Pkgd, verifies the App's Placement and scope, and snapshots the admitted
component:

```json
{
  "appId": "chat_atlas",
  "appRevision": "1",
  "packageId": "chat",
  "packageGeneration": "1",
  "componentId": "api"
}
```

The returned Workload also carries revision, realization status, endpoint
status, and timestamps. The reconciler later creates the owned
ServiceAccount, projections, claims, storage, Kubernetes workload resources,
and private Services. Admitted public HTTP interfaces receive an Edged
sidecar only for Tenant or Workspace continuous Workloads.

## Finite Workload and Run

A finite Workload is reusable execution intent. It is not itself one
execution:

```json
{
  "workloadId": "document_review",
  "placementId": "workspace_atlas",
  "declaration": {
    "desiredState": "DESIRED_STATE_ACTIVE",
    "packageComponent": {
      "appId": "reviewer_atlas",
      "componentId": "worker"
    },
    "resources": {
      "cpuMillis": 1000,
      "memoryBytes": "1073741824"
    },
    "configdTargets": [],
    "dependencies": [],
    "persistentStorage": [
      {
        "storageId": "state",
        "mountPath": "/data",
        "capacityBytes": "1073741824"
      }
    ],
    "finite": {
      "actorPrincipalId": "agent:reviewer",
      "runDurationSeconds": "900",
      "maxAttempts": 2
    }
  }
}
```

One invocation creates one Run:

```json
{
  "runId": "run_01k1f2",
  "workloadId": "document_review"
}
```

The returned `Run` is an immutable execution snapshot plus mutable observed
status:

| Field | Meaning |
| --- | --- |
| `run_id`, `workload_id`, `workload_revision` | Retry identity and source intent |
| `placement_id`, `target` | Exact execution fence |
| `actor_principal_id` | Optional configured Actor |
| `execution` | Admitted Package, resources, Configd targets, dependencies, storage, duration, attempts |
| `phase` | `PENDING`, `STARTING`, `RUNNING`, `CANCELLING`, `SUCCEEDED`, `FAILED`, or `CANCELLED` |
| `reason` | Closed reason for the current phase |
| `attempt_count`, `revision` | Observed execution and concurrency state |
| lifecycle timestamps | Created, started, updated, and completed times |

For a non-Global Run with an Actor, the reconciler calls
`identityd.IssueRunInvocation` and projects the returned short-lived
invocation into the Run. It then realizes one Kubernetes Job.

`CancelRun` takes only `run_id`:

```json
{
  "runId": "run_01k1f2"
}
```

The first nonterminal cancellation request is committed and audited. Repeating
the request while cancellation is already requested is idempotent. A
succeeded or failed Run returns `FAILED_PRECONDITION`.

## Pagination

`ListPlacements`, `ListWorkloads`, and `ListRuns` use ascending immutable-ID
keyset pagination. A zero page size selects 50; admitted values are 1 through
100. Each response returns the last emitted ID only when another page exists:

```json
{
  "workloadId": "document_review",
  "pageSize": 50,
  "afterRunId": "run_01k1f2"
}
```

Execd stores no cursor.

## Outcomes

| Status | Execd meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Invalid field, enum, combination, bound, page, or revision |
| `NOT_FOUND` | Record, parent, App, component, standing, or target is absent or concealed |
| `ALREADY_EXISTS` | Placement, Workload, or Run identity conflicts |
| `FAILED_PRECONDITION` | Lifecycle, constraint, Package, storage, interface, Actor, or terminal state forbids the request |
| `ABORTED` | Expected revision or post-dependency recheck changed |
| `RESOURCE_EXHAUSTED` | A declared finite resource or concurrency ceiling is reached |
| `UNAUTHENTICATED` | Required operator, workload, or invocation identity is invalid |
| `PERMISSION_DENIED` | Caller admission or capability check failed |
| `UNAVAILABLE` | Persistence or an obligatory synchronous dependency is unavailable |
| `CANCELLED`, `DEADLINE_EXCEEDED` | The unary call did not complete |

Asynchronous Configd, provisioner, Kubernetes, and workload failures appear
in `realization` or `Run` status. They do not become a later transport result
or select a fallback.
