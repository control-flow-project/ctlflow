---
title: Planes
description: Control-plane, data-plane, and external-boundary ownership.
weight: 5
---

CtlFlow separates domain ownership, trusted protocol mediation, and Kubernetes
realization.

```text
DOMAIN OWNERS                 PROTOCOL BOUNDARIES         KUBERNETES

tenant and identity           authd                      namespaces
policy and packages           edged                      workloads
configuration                 egressd                    Services
placement intent                                          volumes
audit evidence                                            native policy
```

These are ownership boundaries, not additional APIs.

## Domain ownership

Each durable CtlFlow record has one owning kernel service. A private operation
exists only in that owner's versioned gRPC contract. Operators reach it through
a kubeconfig-authorized port-forward and end-to-end client certificate.

Domain identity is not reconstructed from Kubernetes names, labels, or
objects. Kubernetes objects are derived realization state.

## Protocol mediation

`authd`, `edged`, and `egressd` reserve distinct protocol boundaries:

- authentication HTTP;
- general application HTTP; and
- controlled outbound HTTP.

Authd and Edged are public; Egressd is a purpose-bound private HTTP Service.
A route exists only in a checked versioned HTTP contract. A mediation boundary
cannot expose another service's private gRPC API or become another domain
record owner.

## Kubernetes realization

Kubernetes owns containment, scheduling, native workload state, networking,
and storage primitives. `execd` is the sole general CtlFlow owner that
translates admitted workload intent into those primitives.

`configd` has one narrow disjoint write boundary for secret custody and
authorized ConfigMap or Secret projections. Provider controllers may own their own custom
resources and external systems; those objects are not CtlFlow domain APIs.

CtlFlow never gives application code Kubernetes credentials or authority to
create or inspect workloads.

## Telemetry

Every process exports bounded OpenTelemetry data to an installation Collector.
The Collector is infrastructure, not a kernel service or record authority.
Authoritative security and mutation evidence remains in Auditd.
