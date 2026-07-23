---
title: APIs
weight: 20
---

CtlFlow exposes aggregated administrative resources, direct kernel operations, and mediated
application traffic. All surfaces share one domain model and one owning service per record.

## Operator administration

The operator CLI calls the Kubernetes API server. Each CtlFlow API group is registered through
Kubernetes API aggregation and served by its owner.

```text
 ctlflow
    |
    | HTTPS + kubeconfig credential
    v
 Kubernetes API server
    |
    +-- authenticate Kubernetes subject
    +-- authorize API group, resource, and verb
    +-- attach aggregation identity
    v
 owning CtlFlow extension API
    |
    +-- enforce CtlFlow management boundary
    +-- validate domain invariants
    +-- mutate only its own store
```

CtlFlow domain records are not CRDs and are not stored in Kubernetes etcd. Aggregated resources use
Kubernetes discovery, metadata, status, error, list, watch, and content-negotiation conventions.

## Product administration

Tenant-facing products expose selected management operations through their own UI or API. The
browser enters through `edged`; the authenticated product backend App invokes the same
owning-service use case as the aggregated API.

```text
 product UI -> edged -> product backend App -> owning service
```

The product surface may offer a purpose-built form and JSON review for one operation. It cannot
change semantics, bypass a field, or create a second record shape.

## Administrative resource inventory

| API group | Resources | Owner |
| --- | --- | --- |
| `tenancy.ctlflow.com/v1alpha1` | `tenants`, `workspaces` | `tenantd` |
| `identity.ctlflow.com/v1alpha1` | `users`, `groups`, `groupmembers`, `memberships`, `identitylinks`, `sessions`, `ssoproviders`, `admissionpolicies`, read-only `virtualprincipals` and `runtimeprincipals` | `identityd` |
| `policy.ctlflow.com/v1alpha1` | `roles`, `rolebindings`, `accessgrants`, create-only `accessreviews` | `policyd` |
| `packages.ctlflow.com/v1alpha1` | `packages`, `apps`, and read-only `artifacts`, `servicecontracts`, and `exposures` | `pkgd` |
| `config.ctlflow.com/v1alpha1` | `configurations`, `secrets`, `providerconfigurations` | `configd` |
| `execution.ctlflow.com/v1alpha1` | `placements`, `placementconstraints`, `jobs`, `jobschedules`, `runs`, and read-only `workloads`, `dependencyclaims`, `dependencybindings`, and `endpoints` | `execd` |
| `egress.ctlflow.com/v1alpha1` | `egressdestinations`, `egresspolicies`, create-only `egressreviews` | `egressd` |
| `audit.ctlflow.com/v1alpha1` | read-only `auditevents` and mutable `auditexports` | `auditd` |

Every scoped resource carries an immutable global or Tenant boundary. Workspace and user resources
also carry their immutable parent references. A global User must be a non-login service User.
Package visibility and ownership are explicit fields; they are not inferred from Kubernetes
namespace.

Write-only secret material is accepted only through a named `material` subresource. Reads return
metadata and readiness but never the submitted value or native Secret name. Logs, cancellation,
artifacts, transfer, suspension, revocation, and other non-CRUD lifecycle operations are explicit
subresources.

## Resource conventions

- `metadata.name` is the opaque server-allocated ID unless a resource explicitly defines an
  immutable publication key.
- `spec` is desired domain state; `status` is observed state and conditions.
- Mutable records use `metadata.resourceVersion` for optimistic concurrency.
- Retriable mutations accept an idempotency key.
- Errors are Kubernetes `Status` documents with stable reason and field detail.
- Internal addresses, credentials, payloads, database errors, and provider diagnostics are not
  exposed.
- A record outside the caller's visibility is returned as not found.

Only documented selectors are accepted. Every Tenant collection supports exact Tenant selection.
Child collections support exact owner selection. A selector is added only for a stable indexed
field.

## Collections and streams

Every collection is bounded:

- requests use `limit` and an opaque `continue` token;
- responses return `metadata.continue` and `metadata.resourceVersion`;
- continuation preserves query, authorization fence, and ordering;
- every page is authenticated and authorized independently; and
- clients never fetch all pages implicitly.

Live administrative collections may support Kubernetes watch from a resource version. Evidence
queries additionally require a bounded time range. Logs use bounded pages and finite follow streams.

## Direct kernel operations

Direct service APIs are versioned, language-neutral contracts owned by the callee. Kernel
service-to-service contracts use gRPC. Public HTTP mediation remains HTTP.

| Service | Direct operations |
| --- | --- |
| `tenantd` | Resolve Tenant/Workspace address and coordinate lifecycle facts |
| `identityd` | Login, session validation, call exchange, proxy credentials, and principal resolution |
| `policyd` | Check or explain one operation on one canonical path |
| `pkgd` | Resolve Package declaration, App installation, service contract, exposure, and provider schema |
| `configd` | Resolve configuration and materialize an authorized secret binding |
| `execd` | Reconcile Placement, resolve endpoint, create/cancel Run, obtain logs, and report realization |
| `edged` | Proxy external request, preview resolution, drain, readiness, and bounded cache inspection |
| `egressd` | Proxy admitted HTTP, open HTTP stream, and preview a decision |
| `auditd` | Ingest idempotent evidence batches and manage exports |

Every direct request carries authenticated service or runtime identity plus request and trace IDs.
A request may name a target record, but body fields cannot override the authenticated principal,
attached account, source Tenant, or source Placement; the callee independently fences every target.

## Application endpoints

Applications own their GraphQL, HTTP, gRPC, WebSocket, and domain schemas. A Package declares only
the endpoint protocol, exposure, and service-contract identity needed to connect it.

`edged` resolves an external request from Tenant/Workspace address, Package exposure, and ready
`execd` endpoint. Internal consumers receive exact resolved endpoints from declared service
bindings and call them through Kubernetes networking.

## Bulk data

Administrative bodies contain metadata, not bulk bytes. Container images use OCI registry
protocols. Application objects, Run artifacts, and audit exports use configured dependency
transfers. Logs use bounded query and follow operations. Secret material uses write-only,
purpose-bound operations.

The mandatory cross-service envelopes and state transitions are defined in
[Contracts](../contracts/).
