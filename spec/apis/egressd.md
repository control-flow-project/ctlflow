---
title: egressd API
description: Purpose-bound external HTTP proxy contract, rules, and rewrite example.
weight: 100
---

`egressd` is the private controlled external HTTP boundary for one consumer,
purpose, and HTTPS origin. Its checked contracts are:

- [`openapi.yaml`](https://github.com/control-flow-project/ctlflow/blob/main/services/egressd/api/http/v1/openapi.yaml)
- [`binding.schema.json`](https://github.com/control-flow-project/ctlflow/blob/main/services/egressd/api/config/v1/binding.schema.json)
- [`secrets.schema.json`](https://github.com/control-flow-project/ctlflow/blob/main/services/egressd/api/config/v1/secrets.schema.json)

See the [egressd service specification](../../egressd/) for rule selection,
header isolation, streaming, and failure behavior.

## Method and path inventory

One catch-all path includes `/` and every nested origin-form path:

| Method | Request body | Result |
| --- | --- | --- |
| `GET` | none | Mediated upstream response or fixed boundary error |
| `HEAD` | none | Mediated upstream response headers or fixed boundary error |
| `POST` | optional bounded stream | Mediated upstream response or fixed boundary error |
| `PUT` | optional bounded stream | Mediated upstream response or fixed boundary error |
| `PATCH` | optional bounded stream | Mediated upstream response or fixed boundary error |
| `DELETE` | optional bounded stream | Mediated upstream response or fixed boundary error |
| `OPTIONS` | optional bounded stream | Mediated upstream response or fixed boundary error |

The process binding narrows this inventory. A method present in OpenAPI is
usable only when one binding rule admits it for the request path. Egressd has
no configuration, destination, policy, preview, cache, watch, or secret-read
API.

## Process binding

One Egressd process serves one exact caller and one exact HTTPS origin:

```json
{
  "schema_version": 1,
  "binding_id": "document_provider",
  "caller": {
    "namespace": "workspace-atlas",
    "service_account": "document-worker"
  },
  "origin": "https://api.provider.example",
  "rules": [
    {
      "rule_id": "submit_document",
      "methods": [
        "POST"
      ],
      "match": {
        "kind": "prefix",
        "path": "/documents"
      },
      "upstream_path_prefix": "/v2/jobs",
      "forward_request_headers": [
        "content-type"
      ],
      "forward_response_headers": [
        "content-type",
        "location"
      ],
      "set_request_headers": [
        {
          "name": "authorization",
          "value": {
            "secret_name": "provider_bearer"
          }
        }
      ],
      "maximum_request_body_bytes": 1048576,
      "maximum_response_body_bytes": 1048576,
      "forward_trace_context": false
    }
  ]
}
```

Secret values arrive in a disjoint projection:

```json
{
  "schema_version": 1,
  "values": [
    {
      "name": "provider_bearer",
      "value": "Bearer <projected-provider-token>"
    }
  ]
}
```

The caller receives neither document. Changing the caller, origin, rules, or
secret values replaces the process.

## Caller authentication

Every request carries:

```http
Proxy-Authorization: Bearer <bound Kubernetes workload token>
```

Egressd validates issuer, audience, lifetime, Pod binding, namespace, and
ServiceAccount against its projected installation trust. The header is
consumed and never sent upstream. Network location, source IP, `Host`, and
ordinary `Authorization` do not authenticate the caller.

Missing or invalid workload authentication returns `407 Proxy Authentication
Required`.

## Rewrite example

Consumer request:

```http
POST /documents/contract-42?notify=true HTTP/1.1
Host: document-egress.workspace-atlas.svc
Proxy-Authorization: Bearer <bound workload token>
Content-Type: application/json
X-Unapproved-Debug: true

{"source":"contract-42"}
```

The rule above produces:

```http
POST /v2/jobs/contract-42?notify=true HTTP/1.1
Host: api.provider.example
Authorization: Bearer <projected-provider-token>
Content-Type: application/json

{"source":"contract-42"}
```

The matched prefix is replaced and the original query is preserved.
`X-Unapproved-Debug` is absent because it is not on the forwarding allowlist.
The configured header replacement wins over any caller `Authorization`
value.

The caller cannot select another scheme, authority, port, origin, rule, or
secret.

## Rule selection

Each rule declares:

| Field | Meaning |
| --- | --- |
| `rule_id` | Bounded stable rule identity |
| `methods` | Non-empty subset of the seven contract methods |
| `match` | Exact or segment-boundary prefix path |
| `upstream_path_prefix` | Replacement path prefix |
| `forward_request_headers` | Request-header allowlist |
| `forward_response_headers` | Response-header allowlist |
| `set_request_headers` | Literal or named-secret replacements |
| request and response body bounds | Positive values no greater than 64 MiB |
| `forward_trace_context` | Whether valid W3C trace context may cross the boundary |

For one request, the longest matching method-and-path rule wins; an exact
match outranks a prefix of equal length; ordinal rule ID breaks the remaining
tie. Ambiguous or unreachable rule sets fail startup.

Egressd never forwards caller `Host`, `Proxy-Authorization`, `Forwarded`,
`X-Forwarded-*`, `Ctlflow-*`, or hop-by-hop headers. It never follows
redirects. A 3xx response is filtered and returned as an ordinary upstream
response.

## Protocol neutrality

Rules operate on HTTP method, path, headers, body limits, and trace context.
They contain no S3, OIDC, model-provider, database, or application-specific
logic. A product-specific protocol adapter remains outside Egressd.

## Boundary outcomes

| Condition | Result |
| --- | --- |
| Malformed request target | `400` |
| No admitted path | `404` |
| Path exists but method is not admitted | `405` with admitted methods |
| Missing or invalid workload token | `407` |
| Body too large | `413` |
| Request target too large | `414` |
| Binding concurrency exhausted | `429` with bounded `Retry-After` |
| Headers too large | `431` |
| Upstream TLS, DNS, connection, protocol, or pre-commit size failure | `502` |
| Upstream deadline | `504` |

Ordinary upstream statuses and admitted response data pass through. Egressd
boundary errors use a fixed non-disclosing plain-text representation.

## Bounds

| Resource | Bound |
| --- | ---: |
| Rules per binding | 256 |
| Named secret values | 256 |
| Request target | 16 KiB |
| Request headers | 32 KiB |
| Request or response body | 64 MiB |
| Active requests per process | 256 |
| Upstream lifetime | 5 minutes |

Individual rules may only narrow these ceilings.
