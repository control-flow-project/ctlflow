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

Tenant login is Tenant-scoped. Public login, callback, logout, cookie, origin, and browser-protocol
handling belongs only to `authd`. Private identity, provider, admission, Session, and token
operations belong only to `identityd`. A login started from a Workspace returns there, but current
Workspace Membership and admission policy still determine access. A Workspace may narrow its
Tenant's enabled identity providers and cannot add another provider.

Human browser Sessions are opaque secure cookies. Service Users cannot use SSO or hold browser
Sessions. The cookie is accepted only by `authd` and `edged`; it never enters an application or
another kernel service.

```text
 browser ---- authentication HTTP ----> authd ---- private login operations ----> identityd
    |
    | opaque Session cookie
    v
  edged ---- private Session exchange ----> identityd
    |
    | short-lived invocation JWT
    v
 product or domain App runtime proxy
```

`identityd` derives the User, Actor, Tenant, optional Workspace, and optional Run from current
records. It never signs caller-supplied identity fields. The browser never receives the internal
invocation JWT.

## Invocation identity

An invocation JWT is an asymmetrically signed, short-lived internal identity assertion. It contains:

```text
iss             identityd issuer for this installation
aud             installation-scoped internal audience
sub             canonical subject-account principal
act.sub         canonical actual Actor principal when it differs from sub
tenant_id       absent only for admitted global work
workspace_id    present only for Workspace context
session_id      present for browser-derived invocation
run_id          present for Run-derived invocation
iat, nbf, exp   issued, not-before, and expiry times
jti             unique invocation-token ID
```

Tenant and Workspace IDs in an invocation use
`[a-z0-9][a-z0-9_-]{0,63}`. Session, Run, and invocation-token IDs use
`[a-z0-9][a-z0-9._~-]{0,127}`. These are opaque identifiers despite their canonical transport
grammar. A Workspace context always includes its parent Tenant. Exactly one of `session_id` and
`run_id` is present. A Session invocation has no separate Actor; a Run invocation has exactly one
`act.sub` virtual principal distinct from the attached account in `sub`.

For a direct human action, `act` is absent and Actor is `sub`. For a Job, including one presented by
a product as an agent, `sub` names the attached User and `act` is an object containing only the
virtual principal's `sub`. Nested actor chains are rejected. Session and Run are mutually exclusive
origins. The token contains no role, grant, resolved endpoint, permission snapshot, trace context,
or Kubernetes identity.

Invocation tokens expire no later than 60 seconds after issuance. They have no refresh-token form,
are never persisted as Job credentials, and are never returned in logs, evidence, errors, or
telemetry. A delayed Run obtains a fresh token from its admitted runtime context when execution
starts.

`identityd` publishes a bounded private verification-key set. Receivers cache it for the supplied
finite lifetime and validate token signature, key ID, issuer, installation audience, not-before,
expiry, subject, Actor, and scope locally. Signing material never leaves `identityd`.

Revoking a Session, disabling an account, or removing standing blocks new tokens immediately.
Already issued tokens remain bounded by the 60-second maximum; there is no second distributed
revocation check on every domain call.

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

Every App component or Job attempt receives a workload-scoped Kubernetes ServiceAccount. Kubernetes
projects a bound, rotating token only into its trusted runtime proxy. Application containers never
receive a Kubernetes token. Each concrete Pod/process also has a distinct runtime principal.
Replacing a Pod changes the bound token and runtime facts without changing the virtual principal,
attached account, or declared workload identity.

The effective authority is always the intersection documented in [Model](../model/). Placement,
network reachability, Package installation, or administrator authorship never grants application
authority by itself.

## Internal calls

Every internal HTTP or gRPC call carries:

```text
authorization: Bearer <bound Kubernetes ServiceAccount token>
ctlflow-invocation: Bearer <identityd invocation JWT>   optional
traceparent: <W3C trace context>
tracestate: <W3C vendor state>                         optional
```

The workload token establishes the immediate service, App component, or Run. The invocation JWT
establishes the subject account and Actor on whose behalf the call proceeds. The receiver validates
both independently, checks that the workload may call the operation, and evaluates current domain
authorization. Reachability and a valid user token never grant an operation by themselves.

One invocation JWT propagates unchanged through its short lifetime. It uses the installation's
internal audience rather than an endpoint audience. Immediate-caller identity changes at every hop
through the workload token, so forwarding the invocation JWT does not hide which service made the
call and does not require an `identityd` exchange on every dependency.

After a Session or Run establishes an invocation, every downstream call made on its behalf must
carry that JWT. A service cannot silently drop it and continue under broader service authority,
replace its Actor, or convert an autonomous call into a human action.

```text
 edged
   | workload: service:edged
   | invocation: subject=user:maya, actor=user:maya
   v
 App A runtime proxy
   | workload: app:app-a/component:api
   | same invocation JWT
   v
 App B runtime proxy
```

Each runtime proxy removes caller-supplied protected context before injecting its verified
projection into the private application listener. Application code selects only a declared
dependency. It cannot select another Tenant, Placement, workload identity, or attached account.

An autonomous call has no invocation JWT and acts only as its authenticated workload and virtual
principal. Raw TCP bindings carry workload identity only because they have no standard portable
per-request invocation envelope.

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

Each kernel service has its own Kubernetes ServiceAccount and bound token. A receiver validates the
Kubernetes issuer, signature, installation audience, expiry, bound workload, namespace, and exact
ServiceAccount subject, then admits only named callers for each operation. The installation
declares a finite maximum token lifetime; runtimes request no more than that lifetime and receivers
reject tokens whose issued-to-expiry interval exceeds it.

Validation uses the installation's bounded local verification-key cache rather than a TokenReview
call on every request. Workload suspension, replacement, or deletion blocks new tokens; the maximum
accepted lifetime bounds the consequence of an already issued token.

There is no service-owned certificate authority, per-daemon application certificate, shared daemon
credential, caller-asserted service header, or unauthenticated internal domain listener. Public TLS
belongs to Kubernetes ingress. Optional internal transport encryption belongs to the Kubernetes
network substrate and does not change the application identity contract.

An aggregated administrative API listener uses Kubernetes-native serving certificates and
request-header client authentication supplied for API aggregation. That substrate path authenticates
the Kubernetes API server only; its certificate and forwarded headers are never accepted on a
direct gRPC or application listener.

## Exposure boundary

`edged` and `authd` are the only public kernel daemons. `edged` accepts general external application
traffic; `authd` accepts authentication protocol traffic. Every other kernel daemon has only a
private Kubernetes Service and no Ingress, external load balancer, NodePort, or public domain API.

A public daemon may expose private liveness and readiness endpoints for Kubernetes operation, but
it cannot combine its public protocol with another service's private domain API.
