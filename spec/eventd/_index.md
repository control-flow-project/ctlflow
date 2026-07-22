---
title: eventd
weight: 57
---

`eventd` owns durable application Events and their delivery to event-triggered Jobs.

## Owns

| Record | Meaning |
| --- | --- |
| Event | Immutable accepted fact from one App component or Run |
| Event delivery | Delivery state and outcome for one Event/Trigger pair |

It serves read-only `events` and `eventdeliveries` in `events.ctlflow.com/v1alpha1`. Workloads
publish through a direct authenticated runtime endpoint; administrative clients cannot publish as
a workload.

## Publication

A publication names a package-declared Event type, one Context, a source-local idempotency key, and
a bounded payload or completed Run artifact reference from that same Context. Runtime identity
supplies the Tenant and source principal. Caller-supplied identity fields cannot override them.

Before accepting an Event, `eventd` validates the publisher declaration through `catalogd`, the
Context through `tenantd`, and the payload against the declared schema. An acknowledgement means
the immutable Event is durably committed.

## Delivery

`eventd` observes enabled event Triggers from `execd`. A Trigger matches its declared Event type and
Context. For each match, `eventd` records a delivery and asks `execd` to create a Run using the
Event/Trigger pair as the idempotency identity.

```text
 App component or Run
          |
          | publish
          v
       eventd ---- match ----> execd ----> Run
          |
          +---- Event and delivery evidence
```

Delivery is at least once. Failed attempts remain visible and retry within bounded policy;
`execd` prevents duplicate Runs. Ordering is guaranteed only for one source principal in one
Context.

## Boundaries and invariants

- `catalogd` defines Event types, `execd` owns Triggers and Runs, and `eventd` owns accepted Events
  and delivery evidence.
- An acknowledged Event is immutable, Tenant-fenced, and attributable to one runtime principal.
- Undeclared types, invalid payloads, invalid Contexts, and disabled sources are rejected before
  persistence.
- Reusing one source idempotency key with different content is a conflict.
- `eventd` is not a realtime application message broker; chat, presence, and similar behavior stay
  in Apps.
