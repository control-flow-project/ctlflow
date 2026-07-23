---
title: CLI
weight: 30
---

`ctlflow` is the infrastructure-operator CLI. It operates against one Kubernetes installation at a
time and may manage every Tenant there. Tenant administrators and users use product-provided
surfaces over the same owning-service operations.

## Initialization and connection

Before CtlFlow exists:

```text
ctlflow init [--context CONTEXT]
```

`init` loads kubeconfig, applies the signed CtlFlow release manifests, waits for readiness, binds the
authenticated Kubernetes subject as the first operator, creates global configuration and Placement,
and permanently closes initialization.

After initialization, the CLI calls aggregated CtlFlow APIs through the Kubernetes API server:

```text
 ctlflow
    |
    | kubeconfig + selected Kubernetes context
    v
 Kubernetes API server
    |
    v
 owning CtlFlow service
```

Kubeconfig resolution follows `--kubeconfig`, then `KUBECONFIG`, then the standard default. The
`--context` flag selects a Kubernetes context. CtlFlow maintains no login, credential store, active
Tenant, or fleet database.

## Command form

Commands follow Kubernetes verb-first conventions:

```text
ctlflow <verb> <resource> [NAME] [flags]
```

Examples:

```text
ctlflow get tenants
ctlflow create tenant -f tenant.yaml --wait
ctlflow get workspaces --tenant ten-123
ctlflow install app pkg-456 --tenant ten-123 --placement plc-789 -f app.yaml
ctlflow run job job-123 --tenant ten-123 --wait
```

Common verbs have one meaning:

- `get`, `create`, `apply`, and `delete` operate on records;
- `suspend`, `resume`, `enable`, and `disable` change explicit lifecycle;
- `publish` and `revoke` manage immutable Packages;
- `install`, `upgrade`, `scale`, and `remove` manage Apps;
- `run`, `cancel`, `wait`, `logs`, and `download` manage execution and bounded data;
- `set`, `rotate`, and `revoke` manage configuration or secret lifecycle;
- `add` and `remove` manage explicit relationships;
- `resolve`, `check`, and `explain` evaluate without mutation; and
- `redact` and `delete` are distinct audit-payload operations.

The CLI does not clone native Pod, node, namespace, Secret, manifest, or container commands. Those
remain `kubectl` operations.

## Common flags

```text
--kubeconfig PATH       kubeconfig file
--context NAME          Kubernetes context
--global                explicit global scope
--tenant TENANT         explicit Tenant target
--workspace WORKSPACE   explicit Workspace target
--user USER             explicit User target
--all-tenants           cross-Tenant list target
--placement PLACEMENT   CtlFlow Placement target
-f, --filename FILE     YAML or JSON input; - reads stdin
-o, --output FORMAT     table, json, or yaml
--limit COUNT           requested page size
--continue TOKEN        opaque continuation token
--field-selector EXPR   selector declared by the resource
--resource-version V    optimistic-concurrency precondition
--idempotency-key KEY   mutation identity preserved across retries
--wait                   wait for terminal operation state
--watch                  watch from a resource version
--follow                 follow a finite live stream
--force                  suppress destructive confirmation
```

Every scoped mutation names exactly one `--global` or `--tenant` guard, and the server requires it
to match the resource body and current owner. A child-resource read spanning several Tenants
requires `--all-tenants`; `get tenants` is itself the installation-scoped Tenant inventory.
Destructive commands confirm installation, Tenant, and record unless `--force` is supplied.
`--force` never bypasses server authorization, lifecycle, or referential checks.

## Documents and output

Structured records use YAML or JSON with `-f`. Secret material is accepted only by explicitly
write-only commands and is never printed, echoed, or returned by a read.

List commands return one bounded page and never fetch every continuation implicitly. JSON and YAML
preserve the Kubernetes resource envelope. Table output is for humans and is not a machine contract.

`ctlflow version`, `ctlflow status`, and `ctlflow completion SHELL` are the only utility commands.

## Areas

- [Tenants](tenants/) and [Workspaces](workspaces/)
- [Users and Groups](users/) and [SSO](sso/)
- [Placements](placements/), [Configuration](config/), and [Execution State](execution/)
- [Packages](packages/) and [Apps](apps/)
- [Jobs](jobs/), [Runs](runs/), and [Logs](logs/)
- [Policy](policy/), [Egress](egress/), and [Audit](audit/)
