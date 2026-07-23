---
title: egressd
weight: 75
---

`egressd` is the controlled external HTTP boundary for CtlFlow workloads and kernel services.

## Owns

| Record | Meaning |
| --- | --- |
| Egress destination | Approved HTTP origin and deterministic mediation rules |
| Egress policy | Which exact principals, dependencies, Placements, methods, and paths may use it |
| Egress review | Side-effect-free effective decision |

It serves `egressdestinations`, `egresspolicies`, and create-only `egressreviews` in
`egress.ctlflow.com/v1alpha1`.

## Activities

- Authenticate the calling runtime or kernel service.
- Resolve its current principal, Placement, App or Job, and dependency through `identityd` and
  `execd`.
- Require one matching enabled destination and policy.
- Canonicalize method, origin, path, query, and headers before matching.
- Remove caller-supplied cookies and upstream authentication.
- Apply deterministic path, query, and header rewrites.
- Obtain exact-purpose secret material from `configd`.
- Apply the configured upstream HTTP authentication.
- Enforce finite request, response, connection, stream, redirect, and concurrency bounds.
- Proxy ordinary and streaming HTTP.
- Record every allow, deny, rewrite identity, target, status class, and timing outcome.

## Request flow

```text
 App component, Run, or kernel service
          |
          | process-bound proxy credential
          v
       egressd
          +-- establish runtime and declared dependency
          +-- enforce Placement and destination policy
          +-- remove caller authentication
          +-- apply generic HTTP rewrites
          +-- obtain purpose-bound material from configd
          +-- apply approved upstream authentication
          |
          v
    exact approved HTTP origin
```

A destination is rooted at one approved origin. Rules may rewrite canonical path prefixes, query
parameters, and headers using authenticated runtime facts and configured constants. Caller data
cannot select another Tenant, physical namespace, credential, or origin.

Provider-specific protocols belong to provider Packages or controllers. For example, an
S3-compatible gateway may expose the S3 protocol to an App, derive logical object namespaces, and
use `egressd` for its own admitted HTTP call to external storage. `egressd` contains no Files,
bucket, model-provider, or database domain behavior.

## Process-bound credentials

When a standard HTTP client requires credential-shaped configuration, `identityd` issues a
short-lived credential for one runtime, dependency, and `egressd` audience. It identifies the
caller to `egressd`; it is not accepted by the external origin and cannot be replayed from another
runtime.

Real upstream secret material remains in `configd` custody. It is released only for one admitted
destination operation and never returned to the caller.

## Network safety

- Workload external network access is default-deny.
- Every destination has an exact admitted origin and address policy.
- Tenant destinations cannot resolve to loopback, link-local, cluster, metadata-service, or
  infrastructure-private addresses.
- Address admission is rechecked on each new connection.
- Policy matching occurs before rewriting and upstream authentication.
- Redirects are rejected unless the resulting request independently matches an admitted
  destination.
- Non-HTTP traffic is not proxied.
- Slow readers and writers cannot create unbounded buffering.

## Direct operations

| Operation | Purpose |
| --- | --- |
| Fetch | Proxy one bounded admitted HTTP exchange |
| OpenHttpStream | Proxy one bounded streaming HTTP exchange |
| Preview | Return the effective decision and rewrite identity without forwarding |
| Health / Ready | Report local and required dependency readiness |

## Invariants

- No request reaches an origin without one matching enabled destination and policy.
- Caller-supplied upstream authentication is discarded.
- Secret material never appears in records, responses, reviews, errors, or logs.
- Rewrites derive protected namespace facts only from authenticated owner records.
- Egress admission is independent of application-object authorization.
- A referenced destination cannot be deleted until its policies and bindings are removed.
