# CtlFlow

CtlFlow is a Kubernetes-backed kernel for multi-tenant application platforms.
It owns Tenant and Workspace records, identity, authorization, Package and App
intent, configuration and secret projection, execution intent, browser
authentication, ingress, controlled egress, and audit evidence.

The repository contains the normative specification, language-neutral wire
contracts, C# NativeAOT service implementations, TypeScript migrations,
canonical integration tests, and Kubernetes deployment assets.

## Architecture

```text
infrastructure operator
  -> ctlflow CLI
  -> kubeconfig-authorized port-forward
  -> private service gRPC API

browser
  -> authd                       sign-in and sign-out
  -> edged -> product workload  authenticated application traffic

product or kernel workload
  -> owning service
       -> identityd              current identity and invocation facts
       -> policyd                capability decision
       -> auditd                 successful mutation evidence

execd
  -> pkgd                        exact App and Package intent
  -> configd                     exact consumer projections
  -> Kubernetes                 Namespaces, workloads, Jobs, storage, Services

managed workload
  -> egressd
  -> exact configured HTTPS origin
```

Kubernetes owns infrastructure, containment, scheduling, and process
execution. CtlFlow services own the domain records and decisions. Every record
has one owning service and every operation appears in one checked versioned
contract.

## Services and APIs

| Service | Responsibility | Contract |
| --- | --- | --- |
| `tenantd` | Tenants and Workspaces | [12 unary RPCs](spec/apis/tenantd.md) |
| `identityd` | Principals, standing, Groups, Sessions, invocation identity | [7 unary RPCs](spec/apis/identityd.md) |
| `policyd` | Capability grants and access decisions | [1 unary RPC](spec/apis/policyd.md) |
| `pkgd` | Immutable Package generations and installed App intent | [5 unary RPCs](spec/apis/pkgd.md) |
| `configd` | Configuration, secret custody, exact consumer projections | [5 unary RPCs](spec/apis/configd.md) |
| `execd` | Placements, Workloads, Runs, Kubernetes realization | [10 unary RPCs](spec/apis/execd.md) |
| `auditd` | Immutable typed kernel mutation evidence | [1 unary RPC](spec/apis/auditd.md) |
| `authd` | Public browser authentication protocol | [3 HTTP routes](spec/apis/authd.md) |
| `edged` | Public bound application reverse proxy | [7 HTTP methods](spec/apis/edged.md) |
| `egressd` | Private purpose-bound external HTTP proxy | [7 HTTP methods](spec/apis/egressd.md) |

The complete API inventory is in [spec/apis](spec/apis/_index.md). Protobuf and
OpenAPI files under each service's `api/` directory are the wire authority.

## Repository layout

```text
spec/                         normative Hugo-compatible specification
  apis/                       explained API reference and examples
  <service>/                  service behavior and invariants
  csharp/                     C# implementation and release rules

services/<service>/
  api/                        callee-owned proto, OpenAPI, and binding schemas
  migrations/                 common TypeScript Knex schema history
  tests/                      canonical TypeScript integration suite
  csharp/                     shipping C# NativeAOT implementation
  kubernetes/                 checked Kustomize deployment assets

testing/mesh/                 shared Minikube integration-test harness
tooling/native/               gated NativeAOT publication
layouts/                      Hugo templates
static/css/                   specification-site styles
```

A directory exists only when the service owns that kind of artifact. For
example, stateless services have no migrations.

## Toolchain

The repository pins:

| Tool | Version |
| --- | --- |
| Node.js | `26.1.0` from `.nvmrc` |
| npm | `11.x` |
| .NET SDK | `10.0.302` from `global.json` |
| Hugo launcher package | `hugo-bin` `0.149.2` |
| Minikube | `v1.38.1` |
| Kubernetes test cluster | `v1.34.0` |

Docker is required by the Minikube test profile and container release gates.
The test profile uses the Docker driver and containerd runtime.

Install JavaScript dependencies:

```bash
npm ci
```

Install the repository-pinned Minikube binary:

```bash
npm run setup:minikube
```

## Specification site

Build the static site:

```bash
npm run build
```

Run the development server:

```bash
npm run dev
```

The server binds to `0.0.0.0:7780`. Open `http://<development-machine>:7780/`
from another machine on the same network.

The specification is normative. Before changing a contract or implementation,
update every affected specification page and reconcile its ownership,
messages, errors, dependencies, flows, security, and evidence requirements.

## Build and test

Each service has a root build and test command. For example:

```bash
npm run build:tenantd
npm run test:tenantd
```

The canonical TypeScript suite runs against the shipping service process in
the shared Minikube mesh. It uses real file-backed persistence, real
dependency services, real workload identity, a real OpenTelemetry Collector,
and public wire contracts. Product behavior tests do not use mocks or
in-process substitute transports.

Available service test commands are:

```text
npm run test:auditd
npm run test:identityd
npm run test:policyd
npm run test:tenantd
npm run test:pkgd
npm run test:configd
npm run test:execd
npm run test:edged
npm run test:egressd
npm run test:authd
```

Run repository tooling tests with:

```bash
npm run test:tooling
```

Every C# service has a container release gate:

```bash
npm run verify:container:tenantd
```

Durable services also have a migration-container gate:

```bash
npm run verify:migration-container:tenantd
```

Replace `tenantd` with the service being verified. The exact script inventory
is in [package.json](package.json).

## Contract ownership

- Hand-authored protobuf and OpenAPI files define the API.
- Generated clients and descriptors are deterministic build output.
- Callers consume the callee-owned contract; they do not copy it.
- TypeScript Knex migrations are the sole schema history.
- Service-root TypeScript tests are the language-neutral behavior contract.
- C#-local tests cover only implementation-specific NativeAOT, Entity
  Framework, and packaging evidence.
- A behavior absent from the specification and checked contract is not part of
  the service.

Start with the [specification overview](spec/_index.md), then read the
[model](spec/model.md), [API reference](spec/apis/_index.md), [end-to-end
flows](spec/flows.md), and [implementation rules](spec/implementation.md).
