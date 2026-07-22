---
title: Access
weight: 15
---

CtlFlow separates infrastructure identity, tenant identity, delegated workload authority, and
concrete runtime identity. None can be substituted for another.

## Infrastructure operators

`ctlflow` uses standard kubeconfig and Kubernetes authentication. It does not maintain a login,
credential, or active-tenant database.

```text
 ctlflow --context CLUSTER
          |
          | kubeconfig authentication
          v
 Kubernetes API server
          |
          | RBAC + aggregated API routing
          v
 owning CtlFlow service
```

Normal operator access uses an explicit Kubernetes group and least-privilege ClusterRoles.
Bootstrap cluster credentials are break-glass credentials, not routine CtlFlow identity.

## Tenant users

Tenant login is owned by `identityd`. Browser sessions are opaque, secure cookies and are not
Kubernetes credentials. A platform backend may exchange a valid session for a short-lived bearer
credential scoped to the same Tenant principal and one named audience: the aggregated CtlFlow APIs
or an admitted App endpoint. That credential never reaches the browser.

```text
 browser -- session cookie --> platform backend
                                 |
                                 | validate and exchange
                                 v
                              identityd
                                 |
                                 | short-lived audience-bound credential
                                 v
                       Kubernetes API server
                                 |
                                 v
                         owning domain service
```

Login is tenant-scoped. A login started from a Workspace returns to that Workspace, but access
still depends on current Workspace membership. Workspace admission may narrow the Tenant's enabled
identity providers; it cannot add another provider or grant membership.

Kubernetes RBAC admits tenant principals only to the appropriate aggregated API groups. The owning
service then enforces tenant fencing and domain management rules. Tenant configuration can never
grant infrastructure-operator authority.

## Management authority

| Caller | Management boundary |
| --- | --- |
| Infrastructure operator | Every CtlFlow record in the selected infrastructure |
| Tenant administrator | Tenant-owned records in one Tenant |
| Workspace administrator | Shared records in one Workspace, within Tenant policy |
| Ordinary user | That User's private Apps, Jobs, Runs, and evidence |
| Service account | Runtime delegation only; no browser administration |

Tenant and Workspace administrators are expressed by Membership role, not separate account kinds.
Management authority over CtlFlow records does not automatically grant application-data access.
That is evaluated by `policyd`.

Lists, watches, logs, Events, artifacts, and audit evidence use the same visibility fence as direct
reads. A caller cannot discover an otherwise invisible record through a collection or error.

## Workload authority

Every App component and Job has a virtual principal attached to an existing human or service
account. Private user-created workloads attach to the creator. Administrators creating shared
workloads must select the attached account.

Principal references are stable domain references:

- account: `usr-*`;
- Job: `job-*`;
- App component: `app-*/components/<component-key>`.

Effective authority is the intersection defined in [Model](../model/). A Job or component cannot
gain authority merely because it runs in a broader Context or because an administrator created it.

## Runtime identity

Each concrete execution receives a dedicated Kubernetes ServiceAccount and short-lived,
audience-bound credential. Runtime services derive the caller from that verified workload
identity and the controller's binding; tenant, User, Context, App, Job, and Run headers supplied by
the caller are never trusted as identity.

App and Job code is untrusted with respect to the substrate. Its ServiceAccount has no Kubernetes
API authority, and Package contracts cannot request privileged containers, host namespaces, host
paths, or arbitrary native manifests. Storage, network, secret, and runtime identity bindings are
created only by `controller-manager` from admitted domain intent.

An internal App request carries a verifiable caller credential addressed to the receiving App. A
resource-owning App may present that credential to `policyd` while authenticating as itself; it
cannot replace the original caller with an asserted principal string. Receiving a policy decision
does not let it exercise the caller's credential against another workload because every destination
validates audience and concrete runtime source.

Some standard clients require familiar credential fields. A proxy may issue a short-lived
protocol-shaped credential whose only purpose is to identify one workload to that proxy. It is not
the upstream credential and cannot grant another workload access.

## Service identity

Each CtlFlow component has its own Kubernetes ServiceAccount. Direct service calls use TLS and a
short-lived credential whose audience names the destination. The receiver admits only named
service identities for each internal operation. Shared daemon credentials and unauthenticated
internal listeners are forbidden.
