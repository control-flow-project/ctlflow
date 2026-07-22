---
title: Packages
weight: 45
---

A Package is an immutable infrastructure-wide App or Job definition.

```text
ctlflow package list
ctlflow package get PACKAGE
ctlflow package publish -f FILE
ctlflow package revoke PACKAGE [--force] [--wait]
```

`PACKAGE` accepts an opaque Package ID or `name@version`. Republishing the same canonical document
is idempotent; different content under the same key is a conflict. Packages are not updated or
deleted. Revocation is terminal: it prevents new instantiation and execution, stops Apps and Jobs
using that version, and preserves the Package and historical records for inspection. `--wait`
waits until `execd` and `controller-manager` report that affected execution has stopped.

An App Package declares one or more components. This abbreviated example shows the stable shape:

```yaml
name: chat
version: 1.0.0
kind: app
images:
  api: registry.example/chat@sha256:...
components:
  - key: api
    image: api
    lifecycle: continuous
    identity: replaceable
    resourceProfile: standard
    ports: [{ name: http, protocol: http, port: 8080 }]
declares:
  operations: [chat.read, chat.write]
  events: [chat.message-posted]
```

A Job Package declares one finite Run component:

```yaml
name: reviewer
version: 1.0.0
kind: job
images:
  worker: registry.example/reviewer@sha256:...
run:
  image: worker
  resourceProfile: standard
  capabilities: [files.read]
  acceptsEvents: [files.uploaded]
```

The versioned Package schema may also declare configuration, health checks, persistent-data and
secret slots, provided or required service endpoints, Event schemas, and Run input/output
contracts. It contains semantic requirements only, never native Kubernetes names or credentials.

OCI image bytes are published with registry tooling before Package publication. Every reference is
digest-pinned. CtlFlow stores and validates application operation and Event vocabulary without
interpreting its application meaning.
