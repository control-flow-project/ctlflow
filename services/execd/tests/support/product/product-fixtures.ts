import assert from "node:assert/strict";
import {
  readFile
} from "node:fs/promises";
import {
  credentials,
  status,
  type ChannelCredentials
} from "@grpc/grpc-js";
import {
  DesiredState,
  RealizationPhase,
  type Placement,
  type ResolveWorkloadOperationBindingResponse,
  type Workload
} from "../../generated/v1/execd.js";
import {
  PolicyServiceClient
} from "../../generated/v1/policyd.js";
import {
  getExecdTestContext
} from "../../suite/get-execd-test-context.js";
import {
  getExecdTestSuite
} from "../../suite/get-execd-test-suite.js";
import {
  callUnary
} from "../call-unary.js";
import {
  getPlacementNamespace
} from "../kubernetes/get-placement-namespace.js";
import {
  listOwnedKubernetesObjects
} from "../kubernetes/list-owned-kubernetes-objects.js";
import {
  matchGrpcStatus
} from "../match-grpc-status.js";
import {
  callProductApp,
  findRunningProductPod,
  type ProductCheckResult
} from "./call-product-app.js";
import {
  waitFor
} from "../wait-for.js";
import {
  workloadMetadata
} from "../workload-metadata.js";
import {
  createWorkloadRequest
} from "../workloads/create-workload-request.js";

// Shared fixture registry and helpers for the product-authorization
// acceptance tests. The Package ID is the operation namespace and the
// admitted App ID anchors every resource path.
export const tenantId = "tenant-a";
export const workspaceId = "workspace-a";
export const accountId = "user:alice";
export const chatPackage = "example.chat";
export const filesPackage = "example.files";
export const rollPackage = "example.roll";
export const grantedOperation = "messages.post";
export const ungrantedOperation = "messages.read";
export const kernelLexicalOperation = "tenants.read";

export interface ProductFixture {
  readonly appId: string;
  readonly namespace: string;
  readonly accountName: string;
  readonly subject: string;
}

// Suspending a Placement or Workload deletes its Pods, and resuming creates
// new ones, so the current Pod is resolved for every call rather than cached.
export async function currentProductPod(
  target: ProductFixture
): Promise<string> {
  return await findRunningProductPod(
    getExecdTestSuite().kubernetes,
    target.namespace,
    target.accountName);
}

const fixtures = new Map<string, ProductFixture>();
let policydClient: PolicyServiceClient | undefined;

export interface RealizeProductOptions {
  readonly packageId: string;
  readonly appId: string;
  readonly placementId: string;
  readonly scope: Record<string, unknown>;
  readonly generation?: bigint;
}

export async function realizeProduct(
  name: string,
  options: RealizeProductOptions
): Promise<void> {
  const context = getExecdTestContext();
  const suite = getExecdTestSuite();
  await callUnary((done) => context.pkgd.client.createApp({
    appId: options.appId,
    scope: options.scope,
    placementId: options.placementId,
    packageId: options.packageId,
    desiredPackageGeneration: options.generation ?? 1n
  }, done));
  const workloadId = `wld_${name}`;
  await declareWorkload(createWorkloadRequest({
    workloadId,
    placementId: options.placementId,
    appId: options.appId,
    mode: "continuous",
    // These fixtures stay resident for the rest of the file, so they claim
    // the smallest workable slice of the single-node test cluster.
    resources: {
      cpuMillis: 25,
      memoryBytes: 32n * 1_024n * 1_024n
    }
  }));
  await waitFor(
    async () => await getWorkload(workloadId),
    (value) =>
      value.realization?.phase
        === RealizationPhase.REALIZATION_PHASE_READY,
    60_000);
  const namespace = await getPlacementNamespace(
    suite.kubernetes,
    options.placementId);
  const serviceAccounts = await listOwnedKubernetesObjects(
    suite.kubernetes,
    "serviceaccounts",
    {
      "execution.ctlflow.io/owner-service": "execd",
      "execution.ctlflow.io/workload-id": workloadId
    },
    namespace);
  assert.equal(serviceAccounts.length, 1);
  const accountName = serviceAccounts[0]!.metadata.name;
  await findRunningProductPod(
    suite.kubernetes,
    namespace,
    accountName);
  fixtures.set(name, {
    appId: options.appId,
    namespace,
    accountName,
    subject:
      `system:serviceaccount:${namespace}:${accountName}`
  });
}

export function fixture(name: string): ProductFixture {
  const value = fixtures.get(name);
  assert.ok(value, `Product fixture ${name} is not realized`);
  return value;
}

export async function productCheck(
  target: ProductFixture,
  request: {
    readonly operation: string;
    readonly resourcePath: string;
    readonly tenantId: string;
    readonly workspaceId?: string;
  }
): Promise<ProductCheckResult> {
  const suite = getExecdTestSuite();
  const invocation = suite.invocation.sign({
    tenantId: request.tenantId,
    ...(request.workspaceId === undefined
      ? {}
      : { workspaceId: request.workspaceId })
  });
  return await callProductApp(
    suite.kubernetes,
    target.namespace,
    await currentProductPod(target),
    {
      ...request,
      invocationToken: invocation
    });
}

// Restoring a suspended dependency restarts it; the next product call is
// only meaningful once the container can reach it again.
export async function waitForProductRecovery(
  target: ProductFixture,
  request: {
    readonly operation: string;
    readonly resourcePath: string;
    readonly tenantId: string;
    readonly workspaceId?: string;
  }
): Promise<void> {
  await waitFor(
    async () => await productCheck(target, request),
    (value) => value.decision === "allow",
    120_000);
}

export function workspacePath(appId: string): string {
  return `/tenants/${tenantId}/workspaces/${workspaceId}/apps/${appId}`;
}

export function tenantPath(appId: string): string {
  return `/tenants/${tenantId}/apps/${appId}`;
}

export function accountPath(account: string, appId: string): string {
  return `/tenants/${tenantId}/accounts/${account}/apps/${appId}`;
}

export function appPath(base: string, trailing: string): string {
  return `${base}/${trailing}`;
}

export function packageGrant(
  packageId: string,
  operation: string,
  target: { readonly tenantId: string; readonly workspaceId?: string }
): {
  readonly owner: { readonly kind: "package"; readonly id: string };
  readonly operation: string;
  readonly basePath: string;
  readonly match: "exact" | "subtree";
  readonly subject: {
    readonly kind: "principal";
    readonly id: string;
  };
  readonly target: {
    readonly tenantId: string;
    readonly workspaceId?: string;
  };
} {
  return {
    owner: { kind: "package", id: packageId },
    operation,
    basePath: `/tenants/${target.tenantId}`,
    match: "subtree",
    subject: { kind: "principal", id: accountId },
    target
  };
}

export async function declarePlacement(
  request: Parameters<
    ReturnType<typeof getExecdTestContext>["client"]["declarePlacement"]
  >[0]
): Promise<Placement> {
  return await callUnary((done) =>
    getExecdTestContext().client.declarePlacement(request, done));
}

export async function declareWorkload(
  request: Parameters<
    ReturnType<typeof getExecdTestContext>["client"]["declareWorkload"]
  >[0]
): Promise<Workload> {
  return await callUnary((done) =>
    getExecdTestContext().client.declareWorkload(request, done));
}

export async function getWorkload(workloadId: string): Promise<Workload> {
  return await callUnary((done) =>
    getExecdTestContext().client.getWorkload({ workloadId }, done));
}

export async function getPlacement(placementId: string): Promise<Placement> {
  return await callUnary((done) =>
    getExecdTestContext().client.getPlacement({ placementId }, done));
}

export async function suspendPlacement(placement: Placement): Promise<void> {
  await callUnary((done) => getExecdTestContext().client.declarePlacement(
    {
      placementId: placement.placementId,
      target: placement.target,
      parentPlacementId: placement.parentPlacementId,
      constraints: placement.constraints,
      desiredState: DesiredState.DESIRED_STATE_SUSPENDED,
      expectedRevision: placement.revision
    },
    done));
}

export async function resumePlacement(placementId: string): Promise<void> {
  const current = await getPlacement(placementId);
  await callUnary((done) => getExecdTestContext().client.declarePlacement(
    {
      placementId: current.placementId,
      target: current.target,
      parentPlacementId: current.parentPlacementId,
      constraints: current.constraints,
      desiredState: DesiredState.DESIRED_STATE_ACTIVE,
      expectedRevision: current.revision
    },
    done));
}

// The binding subject for a Workload that needs no realized pod: admission,
// not realization, grants authority, so the retained subject is resolvable as
// soon as the declaration commits.
export async function waitForBindingSubject(
  workloadId: string
): Promise<string> {
  const suite = getExecdTestSuite();
  const namespace = await getPlacementNamespace(
    suite.kubernetes,
    "product_workspace");
  const accounts = await waitFor(
    async () => await listOwnedKubernetesObjects(
      suite.kubernetes,
      "serviceaccounts",
      {
        "execution.ctlflow.io/owner-service": "execd",
        "execution.ctlflow.io/workload-id": workloadId
      },
      namespace),
    (value) => value.length === 1,
    30_000);
  return `system:serviceaccount:${namespace}:`
    + accounts[0]!.metadata.name;
}

export async function assertHostDecision(
  subject: string,
  expected: typeof status.OK
    | typeof status.PERMISSION_DENIED
): Promise<void> {
  const context = getExecdTestContext();
  const suite = getExecdTestSuite();
  const policyd = await suite.kubernetes.createWorkloadCredentials("policyd");
  const request = {
    serviceAccountSubject: subject,
    operation: grantedOperation
  };
  if (expected === status.OK) {
    const binding =
      await callUnary<ResolveWorkloadOperationBindingResponse>(
        (done) => context.capabilityClient.resolveWorkloadOperationBinding(
          request,
          workloadMetadata(policyd.callerToken),
          done));
    assert.equal(binding.packageId, chatPackage);
    return;
  }

  await assert.rejects(
    callUnary((done) =>
      context.capabilityClient.resolveWorkloadOperationBinding(
        request,
        workloadMetadata(policyd.callerToken),
        done)),
    matchGrpcStatus(status.NOT_FOUND));
}

export async function assertProductTokenProjection(
  target: ProductFixture
): Promise<void> {
  const suite = getExecdTestSuite();
  const result = await suite.kubernetes.runKubectl([
    "get",
    "pod",
    await currentProductPod(target),
    "--namespace",
    target.namespace,
    "--output",
    "json"
  ]);
  const pod = JSON.parse(result.stdout) as {
    readonly spec: {
      readonly volumes: readonly {
        readonly name: string;
        readonly projected?: {
          readonly sources: readonly {
            readonly serviceAccountToken?: {
              readonly audience: string;
              readonly expirationSeconds: number;
              readonly path: string;
            };
          }[];
        };
      }[];
    };
  };
  const tokenVolume = pod.spec.volumes.find(
    (volume) => volume.name === "product-token");
  assert.ok(tokenVolume?.projected);
  const source = tokenVolume.projected.sources
    .map((item) => item.serviceAccountToken)
    .find((item) => item !== undefined);
  assert.ok(source);
  assert.equal(source.path, "token");
  assert.equal(source.expirationSeconds, 600);
  assert.notEqual(source.audience, "ctlflow-edged");
}

export async function mintHostToken(
  target: ProductFixture
): Promise<string> {
  const suite = getExecdTestSuite();
  const context = getExecdTestContext();
  const accountName = target.subject.split(":").at(-1);
  assert.ok(accountName);
  const token = (await suite.kubernetes.runKubectl([
    "create",
    "token",
    accountName,
    "--namespace",
    target.namespace,
    `--audience=${context.execdWorkload.audience}`,
    "--duration=10m",
    "--bound-object-kind=Pod",
    `--bound-object-name=${await currentProductPod(target)}`
  ])).stdout.trim();
  assert.notEqual(token.length, 0);
  return token;
}

export async function getPolicydClient(): Promise<PolicyServiceClient> {
  if (policydClient !== undefined) {
    return policydClient;
  }
  const suite = getExecdTestSuite();
  const channel: ChannelCredentials = credentials.createSsl(
    await readFile(suite.policyd.certificateAuthorityPath));
  policydClient = new PolicyServiceClient(
    `127.0.0.1:${String(suite.policyd.process.grpcPort)}`,
    channel,
    {
      "grpc.ssl_target_name_override": suite.policyd.serverName,
      "grpc.default_authority": suite.policyd.serverName
    });
  return policydClient;
}
