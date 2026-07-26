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
- Validate its Kubernetes workload identity, optional invocation JWT, or process-bound proxy
  credential and resolve Placement, App or Job, and dependency through `execd`.
- Require one matching enabled destination and policy.
- Canonicalize method, origin, path, query, and headers before matching.
- Remove caller-supplied cookies and upstream authentication.
- Apply deterministic path, query, and header rewrites.
- Obtain exact-purpose secret material from `configd`.
- Apply the configured upstream HTTP authentication.
- Create an internal client span and propagate W3C trace context externally only when the exact
  destination policy admits it.
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
          +-- apply destination trace-propagation policy
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

`egressd` validates signed identity credentials locally from the bounded `identityd` verification
key set. It does not call `identityd` on the request path. A kernel service may instead call with
its bound Kubernetes token when its exact egress policy admits that service.

Real upstream secret material remains in `configd` custody. It is released only for one admitted
destination operation and never returned to the caller.

## Telemetry boundary

`egressd` always records a bounded internal client span. External propagation is disabled by
default. When the exact destination enables W3C Trace Context, `egressd` injects only
`traceparent` and admitted `tracestate`; it never forwards baggage, invocation JWTs, Kubernetes
tokens, cookies, protected identity fields, or internal authorization metadata.

Destination and rewrite identity may be telemetry attributes. Full URLs, arbitrary query values,
headers, bodies, and upstream diagnostics are not.

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

| Operation | Surface | Purpose |
| --- | --- | --- |
| ForwardHttp | private HTTP data plane | Proxy one ordinary or streaming exchange through an exact binding |
| PreviewEgress | private gRPC | Return the effective decision and rewrite identity without forwarding |
| Health | private Kubernetes probe | Report whether the process is live |
| Ready | private Kubernetes probe | Report whether required dependencies permit forwarding |

### Forwarding contract

`execd` projects a consumer-specific egress binding containing an internal base endpoint and the
name of the process-bound credential slot. The endpoint fixes destination, policy, dependency,
consumer, Placement, and binding generation before a request begins:

```text
<egressd internal origin>/v1/bindings/<opaque-binding-id>/<relative-upstream-path>
```

The fixed prefix is removed before configured rewriting. A caller may choose only method, relative
path, admitted query values, admitted ordinary headers, and body/stream inside that binding. It
cannot supply another destination, origin, policy, consumer namespace, Secret, or binding through
headers, query, body, redirects, DNS, or an absolute-form request target.

`ForwardHttp` authenticates the immediate runtime or kernel service and, for a runtime, validates
the short-lived process-and-dependency credential locally. It then resolves the current binding
through `execd`, evaluates destination policy, canonicalizes the outbound request, strips all
caller authentication and protected headers, applies deterministic rewrites, obtains only required
material from `configd`, and opens TLS to the exact admitted origin.

Ordinary and streaming requests use the same operation. Request/response byte limits, header
limits, connection and first-byte deadlines, total lifetime, concurrent streams, redirect count,
and backpressure are finite destination-policy fields. Bodies stream with bounded buffers; they are
never placed in audit or telemetry. A downstream disconnect cancels upstream work.

The response preserves admitted upstream status and ordinary headers while removing credentials,
cookies, hop-by-hop fields, internal routing, and prohibited diagnostics. `egressd` does not retry
non-idempotent methods. An explicitly configured idempotent retry remains within the same origin,
credential purpose, request deadline, and finite retry budget.

### Rewrite and review contract

A destination has one immutable owner scope and approved HTTPS origin. Its versioned rule set may:

- replace one exact path prefix;
- add, replace, or remove named query fields;
- add, replace, or remove named headers;
- derive bounded namespace values from authenticated Tenant, Workspace, Placement, App/Job,
  dependency, and binding IDs; and
- place one exact `configd` Secret version into a declared upstream authentication slot.

Rules are ordered, typed, finite, and validated at commit. They cannot execute code, interpolate
caller-controlled templates into protected values, parse bodies, change origin after admission, or
name a provider-specific concept.

`PreviewEgress` receives the same binding, method, relative path, admitted query/header names, and
body-length metadata but no body or Secret material. It returns allow/deny, destination and policy
revisions, canonical upstream origin class, rewrite-rule IDs, redacted resulting path/header names,
trace-propagation decision, finite limits, and first stable denying layer. It never returns a URL
with query values, upstream authentication, physical namespace, or reusable allow capability.

### Failure contract

Malformed input is `400`; missing or invalid proxy identity is `401`; valid identity without policy
is `403`; unknown or invisible binding/destination is `404`; body or concurrency bounds use `413`
or `429`; required owner/configuration unavailability is `503`; connection/response deadline is
`504`. An upstream status is returned only after an admitted connection succeeds. Internal
resolution, DNS, policy, Secret, and provider detail remains a stable redacted class.

## Administrative resources

An Egress destination has immutable global or Tenant owner and origin, plus enabled state,
address-admission policy, finite transport limits, deterministic rewrite rules, optional exact
Secret references, and external trace-propagation policy. An Egress policy has immutable owner
scope and finite allow-only matches over exact principal/dependency, Placement fence, destination,
methods, and canonical path classes. Neither record can move scope.

An EgressReview is create-only, side-effect-free, and enters the same evaluator as
`PreviewEgress`. Destination disable blocks new connections immediately; deletion requires every
policy, `configd` reference, and `execd` binding to be removed. Lists and watches use exact owner
selectors and bounded pagination.

## Callers and dependencies

| Callee | Purpose |
| --- | --- |
| `tenantd` | Validate destination Tenant and optional Workspace state |
| `identityd` | Refresh the bounded proxy-credential verification-key set |
| `execd` | Resolve exact runtime, Placement, dependency, and binding generation |
| `configd` | Release one exact-purpose upstream Secret version |
| `auditd` | Record every forwarding decision and policy mutation |

`identityd` also uses an explicitly bound destination for SSO provider HTTP. Kernel services may
use a binding under their own workload identity without a runtime proxy credential only when the
exact policy admits that service.

## Verification

Canonical evidence covers destination/policy CRUD and revision conflicts, process credential
binding and replay from another runtime, every rewrite type and ordering edge, namespace
derivation, Secret substitution/redaction, absolute-target and origin escape, DNS rebinding,
redirect re-admission, prohibited address classes, all methods and streaming modes, finite
buffering/backpressure, disconnect/cancellation, timeout and retry budgets, trace opt-in and
identity-header stripping, preview equivalence, destination disable/delete references,
cross-Tenant isolation, dependency outage, public error redaction, and required audit/telemetry
evidence.

## Invariants

- No request reaches an origin without one matching enabled destination and policy.
- Caller-supplied upstream authentication is discarded.
- Secret material never appears in records, responses, reviews, errors, or logs.
- Rewrites derive protected namespace facts only from authenticated owner records.
- Egress admission is independent of application-object authorization.
- External trace propagation requires explicit destination policy and never carries identity
  context.
- A referenced destination cannot be deleted until its policies and bindings are removed.
