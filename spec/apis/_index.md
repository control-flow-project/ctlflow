---
title: API reference
description: Versioned gRPC and HTTP contracts owned by the CtlFlow kernel services.
weight: 20
---

Every CtlFlow operation belongs to one service and one checked, versioned
contract. An operation, field, route, or status absent from that contract does
not exist. The pages in this section explain the contracts; the checked
protobuf and OpenAPI files remain the wire authority.

## Inventory

| Service | Protocol | Operations | Contract |
| --- | --- | ---: | --- |
| [`tenantd`](tenantd/) | private unary gRPC | 12 | [`tenantd.proto`](https://github.com/control-flow-project/ctlflow/blob/main/services/tenantd/api/proto/v1/tenantd.proto) |
| [`identityd`](identityd/) | private unary gRPC | 34 | [`identityd.proto`](https://github.com/control-flow-project/ctlflow/blob/main/services/identityd/api/proto/v1/identityd.proto) |
| [`policyd`](policyd/) | private unary gRPC | 1 | [`policyd.proto`](https://github.com/control-flow-project/ctlflow/blob/main/services/policyd/api/proto/v1/policyd.proto) |
| [`pkgd`](pkgd/) | private unary gRPC | 5 | [`pkgd.proto`](https://github.com/control-flow-project/ctlflow/blob/main/services/pkgd/api/proto/v1/pkgd.proto) |
| [`configd`](configd/) | private unary gRPC | 5 | [`configd.proto`](https://github.com/control-flow-project/ctlflow/blob/main/services/configd/api/proto/v1/configd.proto) |
| [`execd`](execd/) | private unary gRPC | 11 | [`execd.proto`](https://github.com/control-flow-project/ctlflow/blob/main/services/execd/api/proto/v1/execd.proto) |
| [`auditd`](auditd/) | private unary gRPC | 1 | [`auditd.proto`](https://github.com/control-flow-project/ctlflow/blob/main/services/auditd/api/proto/v1/auditd.proto) |
| [`authd`](authd/) | public HTTP | 3 routes | [`openapi.yaml`](https://github.com/control-flow-project/ctlflow/blob/main/services/authd/api/http/v1/openapi.yaml) |
| [`edged`](edged/) | public bound HTTP proxy | 7 methods | [`openapi.yaml`](https://github.com/control-flow-project/ctlflow/blob/main/services/edged/api/http/v1/openapi.yaml) |
| [`egressd`](egressd/) | private bound HTTP proxy | 7 methods | [`openapi.yaml`](https://github.com/control-flow-project/ctlflow/blob/main/services/egressd/api/http/v1/openapi.yaml) |

The approved surface is 69 unary RPCs and 17 HTTP method/route combinations.
There are no gRPC streams, watch APIs, generic command endpoints, or
caller-defined response shapes.

## Operator transport

`ctlflow` selects one installation through a certificate-backed kubeconfig.
For a private service, it asks the Kubernetes API server for an authorized
port-forward and then speaks end-to-end TLS and gRPC through that tunnel. The
selected kubeconfig client certificate authenticates the operator to the
service.

```text
ctlflow
   |
   | kubeconfig authentication and port-forward authorization
   v
Kubernetes API server
   |
   | byte transport only
   v
private service gRPC listener
   ^
   | end-to-end TLS and kubeconfig client certificate
   +------------------------------------------------ ctlflow
```

Kubernetes does not translate, implement, or persist the CtlFlow request. A
request field or metadata header cannot replace the certificate subject. This
transport does not imply a CRD, aggregated Kubernetes API, HTTP mirror, or
second administrative contract.

## Internal gRPC calls

Every private call carries four independent concerns:

| Concern | Source |
| --- | --- |
| Immediate process identity | Bound Kubernetes ServiceAccount token |
| Optional User or Run Actor | Short-lived `identityd` invocation JWT |
| Operation lifetime | gRPC deadline and cancellation |
| Correlation | W3C `traceparent` and `tracestate` |

The callee authenticates the immediate caller, validates any permitted
invocation, and fences the target independently. Tenant, Workspace, Actor, and
Run fields in a message never create authority.

Public cookie and external bearer values do not become private transport
authentication. A public boundary may pass an opaque credential only as typed
request data to the service that owns it. For example, `edged` passes a Session
credential to `identityd.ExchangeSession`; Identityd returns a short-lived
invocation JWT for the exact bound target.

## Public and bound HTTP

`authd` owns only:

```text
POST /auth/v1/begin
GET  /auth/v1/callback
POST /auth/v1/logout
```

`edged` and `egressd` each own one catch-all contract at the root and nested
paths for exactly `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, and
`OPTIONS`. A process-private binding fixes the application target for Edged or
the external HTTPS origin and rules for Egressd. The request cannot select a
different destination.

Edged authenticates one opaque Identityd Session cookie. Egressd authenticates
one bound workload bearer in `Proxy-Authorization`; ordinary `Authorization`
remains rule-controlled upstream data. Neither proxy has a route-management,
destination-management, preview, or cache API.

## Example notation

gRPC examples use protobuf JSON notation:

- `bytes` fields are base64 strings;
- 64-bit integer fields are decimal strings;
- timestamps use RFC 3339 strings;
- enum values use their full protobuf names;
- omitted optional fields are absent, not empty strings; and
- a `oneof` contains exactly one named branch.

The examples show request and response messages after transport
authentication. They are not unauthenticated `grpcurl` commands. Operator
calls are normally made by `ctlflow`; service calls use generated clients from
the callee-owned proto.

## Collections

Every collection is bounded. The owning contract states its ordering and
continuation values.

Tenant and Workspace lists use immutable-ID keyset pagination:

```text
page_size
after_tenant_id or after_workspace_id
```

The response returns at most the admitted page size and the last emitted ID
when another page exists. Continuation values are validated as untrusted
input. They are not stored server-side and do not grant visibility.

Identityd direct-Group lists use the same keyset shape over immutable Group
IDs:

```text
page_size
after_group_id
```

They return only direct Groups at the exact requested target and repeat
workload admission, invocation validation, standing, and fence checks for
every page.

Execd Placement, Workload, and Run lists use ascending immutable-ID keysets:

```text
page_size
after_placement_id, after_workload_id, or after_run_id
```

Page size zero means 50; an explicit size is 1 through 100. Execd returns a
last-emitted-ID continuation only when another record exists and stores no
cursor.

Tenantd, Identityd, and Execd are the only services with list RPCs. No other
service owns a page size, continuation value, or cursor state.

## Statuses

gRPC services use only the statuses needed by an operation:

| Status | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | A required value is absent, malformed, conflicting, or outside its bound |
| `NOT_FOUND` | The exact visible target does not exist |
| `ALREADY_EXISTS` | An immutable identity, declaration or publication key, or audit event identity already owns conflicting content |
| `FAILED_PRECONDITION` | Current domain state forbids the request |
| `ABORTED` | An expected revision no longer matches |
| `RESOURCE_EXHAUSTED` | A documented finite input or capacity bound is reached |
| `UNAUTHENTICATED` | Required caller identity cannot be established |
| `PERMISSION_DENIED` | The caller is authenticated but not admitted |
| `UNAVAILABLE` | Required persistence or an obligatory integration is unavailable |
| `CANCELLED` / `DEADLINE_EXCEEDED` | The call did not complete before cancellation or deadline |

A successful domain denial from `policyd.CheckAccess` is an `OK` RPC carrying
`ACCESS_DECISION_DENY`, not a transport error.

Raw database, provider, Kubernetes, credential, and stack diagnostics never
cross a service boundary.

Any textual rendering of a gRPC status uses its canonical uppercase
underscore name exactly, including `OK`, `ALREADY_EXISTS`,
`PERMISSION_DENIED`, and `DEADLINE_EXCEEDED`. A language runtime's enum
spelling, casing, or concatenation never becomes a wire, telemetry, log, or
evidence value.

## Cross-cutting obligations

Only a contract-listed actual mutation constructs typed evidence in Domain and
calls `auditd.RecordAuditBatch` directly after commit. Reads, denials,
validation or dependency failures, retries, no-ops, and later realization
outcomes create no mutation evidence. A source service retains no private
audit delivery state, outbox, queue, journal, or source sequence.

Every operation emits bounded OpenTelemetry traces, metrics, and structured
logs. Trace context is the operational correlation mechanism; telemetry is
not authoritative audit evidence.

Generated descriptors are release inventory. Tests fail when a descriptor
adds a method or field without matching normative specification and canonical
behavior evidence.
