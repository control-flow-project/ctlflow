---
title: CLI
weight: 30
---

`ctlflow` is the infrastructure-operator CLI. It operates against one Kubernetes infrastructure at
a time and can target any Tenant in that infrastructure. Tenant administrators and users operate
through platform-provided surfaces over the same domain APIs.

## Connection

The CLI loads standard kubeconfig and calls the configured Kubernetes API server. It has no login
command, credential store, or active-Tenant state.

```text
 ctlflow
    |
    | kubeconfig + selected Kubernetes context
    v
 kube-apiserver
    |
    v
 aggregated CtlFlow APIs
```

Kubeconfig is resolved from `--kubeconfig`, then `KUBECONFIG`, then the standard default. The
`--context` flag selects a Kubernetes context. The `--scope` flag names a CtlFlow Context; the two
are unrelated.

## Command form

```text
ctlflow <group> <verb> [ID] [flags]
```

The groups are:

```text
tenant  workspace  membership  context  quota
user    sso
package profile    app
job     run        event
policy  egress     audit
```

Commands use opaque IDs returned by the API. Display names never select records. Package
`name@version` and profile name are the only documented immutable client keys.

Common verbs retain one meaning:

- `list`, `get`, `create`, `update`, and `delete` operate on records;
- `suspend` and `resume` preserve records while changing admission;
- `enable` and `disable` control activation;
- `add` and `remove` manage relationships;
- `run`, `cancel`, `wait`, `logs`, and `download` are explicit lifecycle or data operations; and
- `check` and `explain` evaluate policy without mutation.

The command pages list the complete surface. A command is a direct wrapper over one documented API
operation; the CLI does not invent client-only behavior.

## Common flags

```text
--kubeconfig PATH       kubeconfig file
--context NAME          Kubernetes context
--tenant TENANT         explicit Tenant target
--infrastructure        explicit infrastructure target where supported
--all-tenants           cross-Tenant list target
--scope CONTEXT         CtlFlow Context target
-f, --filename FILE     YAML or JSON input; - reads stdin
-o, --output FORMAT     table, json, or yaml
--limit COUNT           requested page size
--continue TOKEN        opaque continuation token
--field-selector EXPR   selectors declared by the resource
--resource-version V    optimistic-concurrency precondition
--idempotency-key KEY   mutation identity preserved across retries
--wait                   wait for an asynchronous operation
--watch                  watch from a resource version
--follow                 follow a finite live stream
--force                  suppress destructive confirmation
```

Tenant-scoped mutations always name `--tenant`. Cross-Tenant list operations use
`--all-tenants`; they never broaden a mutation. Destructive commands confirm the selected
infrastructure, Tenant, and record unless `--force` is supplied. `--force` never bypasses server
authorization or validation.

## Documents and output

Structured records use YAML or JSON documents accepted with `-f`. Secret values are supplied only
to explicitly write-only commands and are never printed or returned by a read.

List commands return one bounded page. They do not fetch subsequent pages implicitly. JSON and YAML
preserve the Kubernetes resource envelope; table output is for humans and is not a machine
contract.

`ctlflow version`, `ctlflow status`, and `ctlflow completion SHELL` are the only utility commands.
Raw Kubernetes diagnostics remain in `kubectl`; `ctlflow` does not clone Pod, node, namespace, or
manifest-management commands.

## Areas

- [Tenants](tenants/) and [Workspaces](workspaces/)
- [Contexts](contexts/) and [Quotas](quotas/)
- [Users](users/) and [SSO](sso/)
- [Packages](packages/) and [Profiles](profiles/)
- [Apps](apps/), [Jobs](jobs/), [Runs](runs/), [Events](events/), and [Logs](logs/)
- [Policy](policy/), [Egress](egress/), and [Audit](audit/)
