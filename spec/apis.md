---
title: APIs
weight: 20
---

CtlFlow has two API surfaces: aggregated administrative resources and direct runtime operations.
They share the same domain model and authorization rules but serve different callers.

## Administrative APIs

Administrative clients call the Kubernetes API server. Each CtlFlow API group is registered
through Kubernetes API aggregation and served by its owning service.

```text
 client
   |
   | HTTPS + Kubernetes credential
   v
 kube-apiserver
   |
   +-- authenticate
   +-- authorize API group/resource/verb
   +-- record Kubernetes audit event
   |
   v
 owning extension API server
   |
   +-- trust identity only from the authenticated aggregation proxy
   +-- enforce tenant and management fences
   +-- validate domain invariants
   +-- read or write its own store
```

CtlFlow defines no CRDs. Aggregated resources use Kubernetes discovery, metadata, status, error,
list, watch, and content-negotiation conventions, but their state is stored by CtlFlow services,
not in etcd.

### Resource inventory

| API group | Resources | Owner |
| --- | --- | --- |
| `tenancy.ctlflow.com/v1alpha1` | `tenants`, `workspaces`, `contexts`, `quotas` | `tenantd` |
| `catalog.ctlflow.com/v1alpha1` | `packages`, `resourceprofiles` | `catalogd` |
| `exec.ctlflow.com/v1alpha1` | `apps`, `jobs`, `jobtriggers`, `runs` | `execd` |
| `identity.ctlflow.com/v1alpha1` | `users`, `identitylinks`, `memberships`, `sessions`, `ssoproviders`, `admissionpolicies` | `identityd` |
| `events.ctlflow.com/v1alpha1` | `events`, `eventdeliveries` | `eventd` |
| `policy.ctlflow.com/v1alpha1` | `accessgrants`, create-only `accessreviews` | `policyd` |
| `egress.ctlflow.com/v1alpha1` | `egressdestinations`, `egresspolicies`, create-only `egressreviews` | `egressd` |
| `audit.ctlflow.com/v1alpha1` | read-only `auditevents`, `auditexports` | `auditd` |

All tenant-owned resources are cluster-scoped API objects carrying an immutable Tenant reference.
This avoids mapping domain tenancy onto Kubernetes namespaces or API scoping. Catalog records are
infrastructure-wide. Contexts are derived and read-only. Events and Audit Events are immutable
evidence.

Write-only credential and secret operations are subresources of the record that owns the binding.
They return revision and readiness, never the submitted value or native Secret name.

Named lifecycle and data operations are also explicit subresources: App, Job, and Run logs; App
and Job secret binding; Run cancellation, artifacts, and transfer; and Audit Export transfer. A
CLI action cannot exist without its corresponding resource or subresource contract.
Package revocation is a terminal status subresource and does not mutate the published Package body.

## Resource conventions

- `metadata.name` is the opaque server-allocated ID unless the resource has an explicitly defined
  immutable catalog key.
- `spec` is desired domain state; `status` is observed state and conditions.
- Mutable records use `metadata.resourceVersion` for optimistic concurrency.
- Create and named mutation operations accept an idempotency key so transport retries cannot
  duplicate committed work.
- Errors are Kubernetes `Status` responses with stable reason and field information. Internal
  addresses, credentials, payloads, and database errors are never exposed.
- A record outside the caller's visibility is reported as not found rather than becoming an
  existence oracle.

Only selectors documented by a resource are accepted. Every tenant-owned collection supports a
Tenant selector; child collections support their owner reference. Additional selectors are added
only when backed by a stable domain field, not as an implementation convenience.

## Collections and streams

Every collection is bounded:

- requests use `limit` and an opaque `continue` token;
- responses return `metadata.continue` and `metadata.resourceVersion`;
- continuation preserves the original query and ordering;
- every page is authenticated, authorized, and tenant-fenced; and
- clients never fetch all pages implicitly.

Collections that expose live state may support Kubernetes watch from a resource version. Evidence
queries may additionally use a bounded time range. Program logs use bounded pages and a finite
follow stream rather than pretending to be ordinary mutable resources.

## Runtime APIs

Runtime APIs are direct authenticated service endpoints. They do not traverse the Kubernetes API
server simply to reach a service.

| Owner | Runtime operation |
| --- | --- |
| `identityd` | Start and complete login, validate/logout session, exchange backend credential |
| `eventd` | Publish one declared Event |
| `policyd` | Let a protected resource service check or explain a caller operation on one path |
| `egressd` | Proxy one admitted outbound HTTP request or issue an artifact transfer |
| `auditd` | Ingest trusted evidence from a CtlFlow component |
| `controller-manager` | Accept validated write-only secret material from an owning service |

Runtime request bodies cannot select their own authenticated principal or widen its Context. A
direct endpoint uses a protocol appropriate to the operation; public semantics must remain
language-neutral and versioned.

## Bulk data

Administrative API bodies contain metadata, not bulk bytes. Run artifacts and audit exports move
between the client and object storage through short-lived transfers mediated by `egressd`. Logs
are read through bounded query or follow operations. Container images move through standard OCI
registry tooling.
