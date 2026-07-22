---
title: egressd
weight: 65
---

`egressd` is the controlled outbound HTTP boundary for Tenant workloads and CtlFlow components.

## Owns

| Record | Meaning |
| --- | --- |
| Egress destination | Approved HTTPS origin, logical endpoint, credential strategy, and rewrite rules |
| Egress policy | Workload principals, Context, methods, and paths admitted to a destination |

It serves `egressdestinations`, `egresspolicies`, and create-only `egressreviews` in
`egress.ctlflow.com/v1alpha1`.

## Request flow

```text
 App component, Run, or CtlFlow component
          |
          | logical HTTP request
          v
       egressd
          |
          +-- establish workload principal and Context
          +-- require a matching destination policy
          +-- remove caller authentication
          +-- apply deterministic generic HTTP rewrites
          +-- apply the approved credential from Secret custody
          +-- record evidence
          |
          v
    approved HTTPS origin
```

Destinations use typed authentication and rewrite configuration, never executable scripts.
Rewrites may change headers, path prefixes, query parameters, and derived namespace segments using
only authenticated runtime facts and approved secret fields. They cannot let caller data select a
different Tenant or physical origin.

This model supports standard HTTP clients, including S3-compatible clients, without giving
`egressd` provider-specific domain rules. A logical bucket or path can be rewritten into an opaque
Tenant/Context/workload namespace before the real upstream request is signed.

CtlFlow components use the same proxy under their component identity and owner-authorized,
purpose-bound destination bindings. For example, an SSO provider binds `identityd` to approved
Destinations for discovery and token exchange. This does not grant `identityd` ambient use of other
Destinations.

Real upstream credentials remain in Kubernetes Secret custody. When a standard SDK requires a
credential-shaped input, `egressd` may issue a short-lived credential that identifies one workload
to the proxy. It is not the upstream credential and is rejected from another workload identity.

## Safety

- Workload egress is default-deny except through admitted platform paths.
- Destinations use HTTPS and an explicitly approved origin.
- Tenant-owned destinations cannot resolve to loopback, link-local, cluster, metadata-service, or
  private infrastructure ranges; infrastructure operators may admit an exact private range.
- Resolved addresses are checked against the destination's admitted range on every new connection.
- Each request is matched on canonical method and path before rewriting.
- Caller-supplied upstream authentication is discarded.
- Redirects are not followed automatically; a new target requires a new policy decision.
- Request, response, connection, and concurrency bounds are finite installation policy, not part of
  the destination's application meaning.

`egressd` also mediates short-lived upload and download access for Run artifacts and Audit exports.
It transfers or authorizes bytes but owns no artifact or export metadata.

## Boundaries and invariants

- `egressd` is a generic HTTP policy proxy, not an application-specific gateway or service mesh.
- `policyd` decides application-data operations; egress policy independently decides external
  network use.
- No request reaches an origin without one matching enabled destination and policy.
- Secret values never appear in records, responses, reviews, or logs.
- A Destination referenced by an Egress policy, SSO provider, or artifact/export binding cannot be
  deleted.
