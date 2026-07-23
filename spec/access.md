---
title: Access
weight: 15
---

CtlFlow distinguishes infrastructure operators, Tenant accounts, virtual principals, concrete
runtime principals, and external callers. None can be substituted for another.

## Infrastructure operators

`ctlflow` loads standard kubeconfig and calls the selected Kubernetes API server. Kubernetes
authenticates the request and routes CtlFlow resources to their aggregated API owners.

```text
 ctlflow --context CLUSTER
          |
          | kubeconfig credential
          v
 Kubernetes API server
          |
          | authentication, RBAC, aggregation identity
          v
 owning CtlFlow service
```

`ctlflow init` is the sole pre-kernel path. It applies signed CtlFlow manifests, waits for the kernel,
and uses a one-time initialization operation to bind the authenticated Kubernetes subject as the
first infrastructure operator. Initialization is idempotent and permanently closes after success.

Routine operator access uses an explicit least-privilege Kubernetes group. CtlFlow has no operator
password database, active-Tenant login, or reusable bootstrap token.

The authenticated Kubernetes subject is the Actor for operator mutations and is preserved in audit
evidence. It is not converted into an `identityd` User or virtual principal.

## Accounts

`identityd` owns human and service Users. Human and ordinary service Users belong to one Tenant. A
global service User belongs to the installation, cannot sign in, and can bound only global
workloads. A Membership gives a Tenant User standing in one Tenant or Workspace and may carry the
built-in CtlFlow management role `admin` or `member`. Product roles, teams, committees, and
audiences are Groups rather than management roles.

Tenant login is Tenant-scoped. A login started from a Workspace returns there, but current Workspace
Membership and admission policy still determine access. A Workspace may narrow its Tenant's enabled
identity providers and cannot add another provider.

Human browser sessions are opaque secure cookies. Service Users cannot use SSO or hold browser
sessions. A product backend may exchange a valid session for a short-lived credential addressed to
one CtlFlow management audience or one admitted App endpoint. The browser never receives that
credential.

```text
 browser -- opaque cookie --> edged --> product backend App
                                |               |
                                | validate      | exchange for exact target
                                v               v
                            identityd       identityd
                                                |
                                                | audience-bound credential
                                                v
                                      owning service or App endpoint
```

## Management boundaries

| Caller | Maximum management boundary |
| --- | --- |
| Infrastructure operator | Every CtlFlow record in the selected installation |
| Tenant administrator | Tenant-owned records in one Tenant |
| Workspace administrator | Workspace-owned records within Tenant limits |
| Ordinary User | That User's permitted private Apps, Jobs, Runs, configuration, and evidence |
| Tenant service User | Explicit delegated runtime operations; no browser administration |
| Global service User | Explicit global workload delegation; no Tenant or browser standing |

Every owner enforces its own boundary after authentication. Lists, watches, logs, errors, and
evidence use the same visibility fence as direct reads. An invisible record is reported as not
found.

## Delegated workload identity

Every App component and Job has a stable virtual principal attached to one existing User valid for
the target Placement. Global work requires a global service User. Tenant and Workspace work
requires current standing in that boundary. A private user Placement requires its exact owning
User. An administrator creating shared automation selects an existing admitted human or service
User explicitly.

Every App component or Job attempt receives a workload-scoped Kubernetes ServiceAccount. Each
concrete Pod/process authenticates through its runtime proxy and receives a distinct runtime
principal and process-bound credential. Replacing a Pod changes those runtime facts without
changing the virtual principal, attached account, or workload ServiceAccount.

The effective authority is always the intersection documented in [Model](../model/). Placement,
network reachability, Package installation, or administrator authorship never grants application
authority by itself.

## Actor-preserving calls

An internal request distinguishes:

- the Actor whose authority initiated the operation;
- the Actor's attached account when the Actor is virtual;
- the immediate calling App component or Run;
- that caller's attached account and source Placement;
- the concrete runtime principal;
- the exact target audience; and
- request, parent-call, and trace identities.

Each workload endpoint is fronted by a trusted runtime proxy realized by `execd`. It validates the
source and target-audience credential, removes protected caller headers, and injects trusted context
into the private application listener.

For an outbound call, application code requests a credential using one declared dependency name
and, when preserving a human Actor, the current opaque invocation handle. The application cannot
select a URL, Tenant, Placement, principal, account, or audience. `identityd` resolves those facts
and issues a new short-lived credential for the exact endpoint.

```text
 App A private listener
          |
          | dependency name + invocation handle
          v
 App A runtime proxy ---- exchange ----> identityd
          |
          | new audience-bound credential
          v
 Kubernetes Service -> App B runtime proxy -> App B private listener
```

An autonomous call omits the invocation handle and acts as the calling virtual principal. An inbound
credential is never forwarded to a second audience. Raw TCP dependencies carry workload identity
only and cannot claim per-request human delegation.

## Runtime and proxy credentials

Tenant application code has no Kubernetes API authority. It cannot create Pods, read Secrets, mount
volumes, or inspect another namespace.

Some standard clients require credential-shaped configuration. `identityd` may mint a short-lived,
process-bound proxy credential that identifies one runtime and one dependency to a trusted proxy.
It is not an upstream credential, cannot be used from another runtime, and grants no ambient access.

`egressd` ignores caller-supplied upstream authentication and applies only the credential selected by
the admitted destination policy. Secret material comes from `configd` and never enters domain
records, evidence, or error text.

## Kernel service identity

Each kernel service has its own Kubernetes ServiceAccount and destination-specific service
credential. The receiver accepts only named service identities for each internal operation.
Shared daemon credentials, caller-asserted service headers, and unauthenticated internal listeners
are forbidden.
