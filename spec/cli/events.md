---
title: Events
weight: 65
---

Events are immutable application facts and their delivery evidence.

```text
ctlflow event list --tenant TENANT [--scope CONTEXT] [--type TYPE] [--watch]
ctlflow event get EVENT --tenant TENANT
ctlflow event delivery list EVENT --tenant TENANT
ctlflow event delivery get EVENT DELIVERY --tenant TENANT
```

Only an authenticated App component or Run may publish an Event through `eventd`'s runtime API.
The CLI can inspect Events but cannot impersonate a workload to publish them.

An Event records its declared type, source principal, Context, occurrence and acceptance time, and
bounded payload metadata. A delivery records the matching Trigger, attempts, outcome, and resulting
Run. Lists are paginated; watches begin from an explicit resource version.
