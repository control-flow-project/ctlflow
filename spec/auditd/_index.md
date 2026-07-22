---
title: auditd
weight: 70
---

`auditd` owns immutable security and activity evidence.

## Owns

| Record | Meaning |
| --- | --- |
| Audit event | One attributable action or outcome |
| Audit export | Asynchronous bounded extraction of Audit Events |

It serves read-only `auditevents` and mutable `auditexports` in
`audit.ctlflow.com/v1alpha1`.

## Evidence

Every Audit Event records enough identity to distinguish a person from delegated work:

```text
 actor      job-123                 virtual principal
 account    usr-456                 attached account
 context    ctx-789                 placement/data boundary
 action     files.read
 target     /workspaces/wsp-123/files/report.pdf
 outcome    allowed
```

Events also carry time, source component, request and trace identity, and a bounded typed detail.
Credentials, request bodies, application payloads, file contents, model prompts, and program logs
are not audit fields.

Evidence covers domain mutations, authentication, policy and egress decisions, App and Run
lifecycle, Event delivery, quota refusal, and Kubernetes realization outcomes.

Every durable CtlFlow service writes evidence to its transactional outbox in the same commit as the
domain mutation. `auditd` ingests batches idempotently under the authenticated service identity.
Tenant workloads cannot submit Audit Events directly.

Queries are Tenant-fenced, time-bounded, and paginated. Exports are asynchronous records whose
bytes are written to configured object storage and retrieved through a short-lived `egressd`
transfer.

## Retention and integrity

Audit Events are immutable through the administrative API. Retention may remove expired content in
bounded ranges, but deletion itself remains auditable and preserves enough integrity metadata to
detect an altered sequence. Ordinary record deletion can never erase audit history silently.

`auditd` is not the program log store and not Kubernetes audit. Those record different evidence.

## Invariants

- An accepted event is immutable and idempotently attributable to one source action.
- Workload actors include both virtual principal and attached account.
- Tenant callers can never query another Tenant's partition.
- Export APIs return metadata and expiring transfer access, never export bytes.
- Audit unavailability cannot cause committed source evidence to disappear; bounded outboxes retry
  and eventually backpressure evidence-requiring mutations rather than dropping entries.
