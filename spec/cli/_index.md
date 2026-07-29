---
title: CLI
description: Infrastructure-operator connection, command, input, and output rules.
weight: 30
---

`ctlflow` is the infrastructure-operator CLI. It operates against one
Kubernetes installation at a time and does not log in to a Tenant.

## Connection

The CLI resolves kubeconfig using:

```text
--kubeconfig
KUBECONFIG
standard kubeconfig path
```

`--context` selects a Kubernetes context. For a private service, the CLI asks
the Kubernetes API for an authorized port-forward, then presents the selected
kubeconfig client certificate end to end to the gRPC service.

CtlFlow stores no second login, credential database, active Tenant, or fleet
context.

## Installation

```text
ctlflow init [--context CONTEXT]
```

`init` is an idempotent local infrastructure operation. It applies the signed
CtlFlow Kubernetes manifests through the selected kubeconfig and waits for
their declared probes. It creates no Tenant, User, Placement, Package, or
other CtlFlow domain record.

## Command law

Commands use:

```text
ctlflow <verb> <resource> [name] [flags]
```

Every command maps to one or more explicitly approved owner operations. A CLI
name, flag, or help page cannot create an API. The approved command areas are:

- [Tenants](tenants/)
- [Workspaces](workspaces/)

No other operator command is specified.

## Common flags

```text
--kubeconfig PATH
--context NAME
--tenant TENANT
-f, --filename FILE
-o, --output table|json|yaml
--limit COUNT
--after ID
--revision REVISION
--force
```

`--force` suppresses a local destructive confirmation only. It never changes
the RPC, bypasses authorization, or weakens Domain invariants.

Lists return one bounded page. `--after` is the last emitted immutable ID and
is validated as untrusted input; the CLI does not fetch every page
automatically.

Structured input is YAML or JSON. Output preserves the owning contract's
fields. Raw diagnostics and credentials are never printed.
