---
title: egressd
weight: 75
---

`egressd` is the stateless controlled external HTTP boundary for one
purpose-bound consumer binding. It owns the allow-or-reject decision for that
binding but no Tenant, Placement, Package, secret, provider, or durable
record.

## Deployment model

One Egressd process serves one binding and one exact HTTPS origin. The origin
contains only scheme, DNS host, and optional explicit port; it has no
userinfo, non-root path, query, or fragment. An admitted
provisioner or Execd creates the binding Service and projects two disjoint
strict documents:

- non-secret rule configuration; and
- secret values referenced by rule name.

The installation separately projects the workload-token issuer, audience,
maximum lifetime, verification-key set, and finite upstream TLS trust bundle.
Those values are process bootstrap trust, not caller input, binding rules,
Configd records, or ambient host trust.

The checked schemas are:

```text
services/egressd/api/config/v1/binding.schema.json
services/egressd/api/config/v1/secrets.schema.json
```

Both use `schema_version = 1`, reject duplicate and unknown fields, and are
bounded to 1 MiB. Rules, caller identity, origin, and secret values are fixed
for the process lifetime; change replaces the process. Startup rejection exits
nonzero with one bounded generic diagnostic and no configuration, credential,
secret, or stack detail. Egressd has no configuration, destination, policy,
preview, watch, or secret-release API.

## Caller authentication

The process admits exactly one configured Kubernetes namespace and
ServiceAccount. Every request carries:

```text
Proxy-Authorization: Bearer <bound Kubernetes workload token>
```

Egressd validates issuer, audience, lifetime, Pod binding, namespace, and
ServiceAccount locally using the projected installation verification
parameters. The header is removed before the upstream request. The ordinary
`Authorization` header remains provider/application data and is forwarded only
when the matched rule admits or replaces it.

Missing or invalid proxy authentication is `407 Proxy Authentication
Required`. Network reachability, source IP, Host, or another request header
never authenticates the caller.

## HTTP rules

The checked `services/egressd/api/http/v1/openapi.yaml` owns the complete
private HTTP proxy surface. Root and nested paths admit exactly `GET`, `HEAD`,
`POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS`. Health and readiness exist
only on the separate probe listener.

Each rule declares:

- one or more admitted methods;
- one exact or segment-boundary prefix path match;
- one replacement upstream path prefix;
- request-header allowlist;
- response-header allowlist;
- literal or named-secret request-header replacements;
- positive request and response body bounds no greater than 64 MiB; and
- whether valid W3C trace context may cross the external boundary.

Rule IDs are unique. Header names are case-insensitive and represented in
lower case; header replacement names and named secrets are unique within
their collections. Rules cannot contain equal method/path matches. For one
request, Egressd selects matching method-and-path rules by longest path and
then ordinal rule ID. An exact match outranks a prefix of equal length. If a
path matches but its method does not, `405` returns the sorted union of methods
admitted by every matching path rule.
Path rewriting replaces only the matched prefix and preserves the original
query. Path traversal, encoded separators, controls, invalid percent
encoding, userinfo, fragments, and caller-selected schemes or authorities are
rejected.

Caller `Host`, `Proxy-Authorization`, `Forwarded`, `X-Forwarded-*`,
`Ctlflow-*`, and hop-by-hop headers never reach the upstream. The configured
origin supplies scheme, authority, TLS server name, and port; its certificate
must chain to the projected upstream trust bundle. A rule's header replacement
wins over a forwarded value. Secret values are read only while constructing
the upstream request, are never returned, and are redacted from exceptions,
logs, telemetry, and debugger formatting.

A binding that forwards or sets a protected or hop-by-hop header, references
an absent secret, repeats a semantic key, or contains an unreachable or
ambiguous rule fails startup and readiness.

Egressd does not follow redirects. A 3xx response is returned as an ordinary
upstream response after response-header filtering, so a redirect can never
escape the configured origin inside Egressd. Request and response bodies
stream with finite backpressure and byte counts; Egressd does not interpret
JSON, forms, OIDC, S3, model providers, or another application protocol.

## Failure contract

| Condition | Result |
| --- | --- |
| Missing or invalid workload authentication | `407` |
| No admitted path | `404` |
| Path exists but method is not admitted | `405` with the rule's admitted methods |
| Malformed target | `400` |
| Request target, headers, or body exceed a bound | `414`, `431`, or `413` |
| Binding concurrency exhausted | `429` with bounded `Retry-After` |
| Upstream TLS, DNS, connection, or protocol failure | `502` |
| Upstream response exceeds its bound before response commitment | `502` |
| Upstream deadline | `504` |

Ordinary upstream statuses and admitted response data pass through. Errors
generated by Egressd after HTTP request dispatch have a fixed plain-text body
and disclose no caller, binding, rule, origin, secret, upstream, or stack
detail. The HTTP server may reject a syntactically invalid request before
dispatch with only its fixed status and connection behavior.
If a streamed upstream response exceeds its bound after caller response
commitment, Egressd cancels both directions and closes the response; it cannot
replace already committed bytes with another status.

## Bounds

A binding contains at most 256 rules and 256 named secret values. A request
target is at most 16 KiB, headers 32 KiB, request or response body at most
64 MiB, active requests at most 256, and upstream lifetime at most five
minutes. Rule limits may only narrow those ceilings.

## Telemetry and verification

Stable operation names are `egressd.http.<lower-method>`. Trace context is
always used for local correlation and crosses the external boundary only when
the exact matched rule allows it. Baggage never crosses.

Telemetry contains only method, closed rule ID, status class, outcome,
latency, and saturation. It excludes path, query, origin, headers, bodies,
caller identity, credentials, secrets, and raw errors. Egressd emits no
mutation audit event.

Canonical evidence uses the shipping listener, real workload-token
verification, strict projected documents, and a separately controlled HTTPS
origin. It proves every method, exact and prefix matching, rewriting, header
and secret replacement, caller and destination isolation, redirects,
streaming, bounds, cancellation, upstream failures, trace policy, redaction,
implementation release gates, and Kubernetes packaging.
