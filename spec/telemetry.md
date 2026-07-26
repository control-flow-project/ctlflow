---
title: Telemetry
weight: 24
---

CtlFlow uses OpenTelemetry for vendor-neutral traces, metrics, and correlated structured logs.
W3C Trace Context is the only distributed trace envelope, and OTLP is the service-to-collector
export protocol.

## Propagation

Every declared public HTTP route and internal HTTP or gRPC operation extracts
and injects:

```text
traceparent
tracestate
```

An absent valid parent starts a new trace. A valid external parent is accepted only as correlation;
it grants no identity, authority, routing, tenancy, or sampling privilege. Malformed or oversized
trace context is discarded and replaced with a new trace rather than forwarded.

An `authd` or `edged` route applies installation sampling policy to an
external parent rather than trusting its sampled flag. Internal hops propagate
the resulting decision through standard trace flags.

CtlFlow does not propagate W3C baggage. Identity, Placement, routing, and authorization facts come
from authenticated workload and invocation context, never caller-controlled telemetry fields.

Trace context remains separate from:

```text
workload token or approved client certificate   immediate process identity
invocation JWT              User or Job Actor context
idempotency key             retry identity for one domain mutation
```

W3C trace and span identity is the sole transport correlation model.

## Instrumentation

Every kernel service instruments:

- public HTTP and direct gRPC operations;
- outbound kernel, application, Kubernetes, and admitted external calls;
- database operations and direct audit delivery;
- bounded queueing, retries, cancellation, and dependency waits;
- any contract-declared stream with finite lifecycle and backpressure
  measurements; and
- process health, readiness, saturation, and telemetry-export failure.

Every implementation uses its language's OpenTelemetry SDK and produces the same service and
operation identity at the wire boundary. Implementation-specific runtime measurements may be added
without changing service semantics.

Logs are structured and carry their current trace and span IDs when one exists. Program output,
kernel audit evidence, and telemetry logs remain distinct data classes.

## Attributes and content

Resource attributes identify the deployed service, implementation, version, environment,
Kubernetes workload, and Placement using standard OpenTelemetry semantic conventions where one
exists and `ctlflow.*` attributes otherwise. Trusted Kubernetes enrichment overwrites conflicting
workload-supplied ownership attributes.

Validated Tenant, Workspace, Placement, App, Job, Run, Actor kind, and outcome may be span or
structured-log attributes when required by policy. User, Actor, request, Run, object, trace, and
other unbounded identifiers are forbidden as metric dimensions.

For a gRPC operation or outbound gRPC dependency call, `ctlflow.outcome` is
the final canonical gRPC status name in uppercase underscore form. A successful
RPC is `OK`, including a successful response carrying a domain denial.
Closed domain results such as `allow` and `deny` use a separate
`ctlflow.decision` attribute and never overload the transport outcome.

Telemetry never contains:

- browser cookies, Kubernetes tokens, invocation JWTs, or authorization headers;
- secret, credential, verifier, nonce, or key material;
- request or response bodies, application records, file contents, prompts, or model responses;
- raw database statements containing values; or
- unbounded exception, provider, header, query, or payload content.

Error recording uses bounded stable classifications. Telemetry backends are not trusted with
domain authority merely because they receive correlated identifiers.

## Collection and export

Services export OTLP asynchronously to a standard OpenTelemetry Collector supplied by the
installation:

```text
 service or managed runtime
          |
          | bounded asynchronous OTLP
          v
 OpenTelemetry Collector
          |
          +---- configured trace backend
          +---- configured metric backend
          +---- configured log backend
```

The Collector is infrastructure, not a kernel service or record owner. Installation manifests
supply its endpoint, exporter configuration, and exporter credentials so `configd` does not depend
on itself for observability. Collector topology may change from one gateway to node-local or
Placement-specific collectors without changing service contracts.

`execd` injects the admitted standard OpenTelemetry endpoint and resource configuration into
managed workloads. A runtime may emit additional application telemetry, but the Collector derives
or overwrites protected Tenant, Workspace, Placement, and workload identity from trusted
Kubernetes context. Workload intake has finite per-Placement limits, so an untrusted workload
cannot create an unbounded Collector queue or suppress kernel telemetry.

External trace propagation through `egressd` is disabled unless the exact destination policy
admits it. Even when admitted, baggage, identity context, and internal authorization metadata are
never forwarded.

Authd never propagates CtlFlow trace headers or baggage to its external
authentication provider. It creates a local outbound child span and propagates
the resulting trace context only to its Identityd calls.

## Failure and sampling

Telemetry is never a synchronous dependency of domain work. Export uses finite queues, batches,
timeouts, retry budgets, and memory. Collector or backend failure drops bounded operational
telemetry and increments local failure measurements; it does not fail readiness, reject domain
requests, or create an unbounded backlog.

Sampling is an installation concern and propagates through standard trace flags. Delayed Jobs and
other work that outlives an initiating request start a new trace linked to the admitted parent
context rather than retaining an indefinitely open parent span.

## Audit separation

`auditd` stores authoritative, unsampled security and mutation evidence. OpenTelemetry stores
operational observations that may be sampled, delayed, or dropped.

```text
auditd          authority, attribution, retention, legal deletion
OpenTelemetry   diagnosis, performance, saturation, correlation
```

Audit envelopes may record trace and span IDs. Missing telemetry never permits missing required
audit evidence, and a telemetry export cannot satisfy a direct audit obligation.

## Verification

Canonical integration evidence runs a real OpenTelemetry Collector and proves:

- trace continuity across Authd and Identityd Session calls and across
  Tenantd, Policyd, Identityd, Auditd, and database calls;
- no Authd trace or baggage propagation to the controlled external provider;
- correct parent-child relationships;
- malformed external context replacement and baggage rejection;
- correlation of structured logs without credential or payload disclosure;
- bounded metrics without prohibited high-cardinality dimensions;
- continued domain operation during Collector outage and backpressure.
