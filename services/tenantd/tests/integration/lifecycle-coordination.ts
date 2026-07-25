import assert from "node:assert/strict";
import { Metadata, status, type ServiceError } from "@grpc/grpc-js";
import { after, before, describe, test } from "node:test";
import {
  LifecycleState,
  LifecycleStepKey,
  LifecycleStepOutcome,
  LifecycleStepState,
  type LifecycleStep
} from "../generated/v1/tenantd.js";
import {
  acknowledgeLifecycleStep
} from "../support/acknowledge-lifecycle-step.js";
import {
  createTenantdTestContext,
  type TenantdTestContext
} from "../support/create-tenantd-test-context.js";
import { getLifecycle } from "../support/get-lifecycle.js";
import {
  listLifecycleSteps
} from "../support/list-lifecycle-steps.js";
import {
  readFirstLifecycleStepEvent
} from "../support/read-first-lifecycle-step-event.js";
import {
  requestTenancyApi,
  type TenancyApiResponse
} from "../support/request-tenancy-api.js";
import { workloadMetadata } from "../support/workload-metadata.js";

interface TenantDocument {
  readonly metadata: {
    readonly name: string;
    readonly resourceVersion: string;
  };
  readonly status: {
    readonly lifecycle: string;
    readonly revision: number;
    readonly provisioningGeneration: number;
    readonly currentOperation?: {
      readonly id: string;
      readonly kind: string;
    };
  };
}

const basePath = "/apis/tenancy.ctlflow.com/v1alpha1";
let context: TenantdTestContext | undefined;

describe("Lifecycle coordination", { concurrency: false }, () => {
before(async () => {
  context = await createTenantdTestContext({
    registerAggregatedApi: true
  });
});

after(async () => {
  await context?.stop();
  context = undefined;
});

test("returns exact retained Tenant and Workspace lifecycle facts", async () => {
  const tenant = await getLifecycle(
    requireContext().client,
    { target: { tenant: { tenantId: "tenant_active" } } },
    kernelMetadata());
  assert.equal(tenant.lifecycle, LifecycleState.LIFECYCLE_STATE_ACTIVE);
  assert.equal(tenant.target?.tenant?.tenantId, "tenant_active");
  assert.equal(tenant.parentTenantLifecycle, undefined);
  assert.equal(tenant.resourceRevision, 12n);
  assert.equal(tenant.provisioningGeneration, 1n);
  assert.ok(tenant.cacheExpiresAt);

  const workspace = await getLifecycle(
    requireContext().client,
    {
      target: {
        workspace: {
          tenantId: "tenant_active",
          workspaceId: "workspace_active"
        }
      }
    },
    kernelMetadata());
  assert.equal(workspace.lifecycle, LifecycleState.LIFECYCLE_STATE_ACTIVE);
  assert.equal(
    workspace.parentTenantLifecycle,
    LifecycleState.LIFECYCLE_STATE_ACTIVE);
  assert.equal(workspace.target?.workspace?.workspaceId, "workspace_active");

  for (const request of [
    {},
    { target: { tenant: { tenantId: "Tenant" } } }
  ]) {
    await assert.rejects(
      getLifecycle(requireContext().client, request, kernelMetadata()),
      hasStatus(status.INVALID_ARGUMENT));
  }
  await assert.rejects(
    getLifecycle(
      requireContext().client,
      {
        target: {
          workspace: {
            tenantId: "tenant_suspended",
            workspaceId: "workspace_active"
          }
        }
      },
      kernelMetadata()),
    hasStatus(status.NOT_FOUND));
});

test("applies authentication, caller admission, and invocation fences", async () => {
  await assert.rejects(
    getLifecycle(
      requireContext().client,
      { target: { tenant: { tenantId: "tenant_active" } } },
      new Metadata()),
    hasStatus(status.UNAUTHENTICATED));

  await assert.rejects(
    getLifecycle(
      requireContext().client,
      { target: { tenant: { tenantId: "tenant_active" } } },
      workloadMetadata(requireContext().kubernetes.unadmittedToken)),
    hasStatus(status.PERMISSION_DENIED));

  const invocation = requireContext().invocation.sign({
    tenantId: "tenant_suspended"
  });
  await assert.rejects(
    getLifecycle(
      requireContext().client,
      { target: { tenant: { tenantId: "tenant_active" } } },
      workloadMetadata(
        requireContext().kubernetes.callerToken,
        invocation)),
    hasStatus(status.NOT_FOUND));
});

test("delivers only each authenticated owner's typed provisioning work", async () => {
  const tenant = await createTenant("Lifecycle Owner Work");
  const expectations = ownerExpectations();

  for (const expected of expectations) {
    const page = await listLifecycleSteps(
      requireContext().client,
      { pageSize: 100 },
      workloadMetadata(expected.token));
    const step = requireTenantStep(page.steps, tenant.metadata.name);
    assert.equal(step.stepKey, expected.key);
    assert.equal(step.state, LifecycleStepState.LIFECYCLE_STEP_STATE_PENDING);
    assert.equal(step.lifecycleOperationId, tenant.status.currentOperation?.id);
    assert.equal(
      step.provisioningGeneration,
      BigInt(tenant.status.provisioningGeneration));

    if (expected.key === LifecycleStepKey.LIFECYCLE_STEP_KEY_IDENTITY) {
      assert.equal(
        step.identity?.initialAdministrator?.loginIdentifier,
        "owner@example.com");
      assert.equal(step.packages, undefined);
    } else if (
      expected.key === LifecycleStepKey.LIFECYCLE_STEP_KEY_PACKAGES
    ) {
      assert.equal(step.packages?.baselinePackages[0]?.packageId, "pkg_base");
      assert.equal(step.identity, undefined);
    } else {
      assert.equal(step.identity, undefined);
      assert.equal(step.packages, undefined);
    }
  }

  await assert.rejects(
    listLifecycleSteps(
      requireContext().client,
      { pageSize: 10 },
      kernelMetadata()),
    hasStatus(status.PERMISSION_DENIED));
});

test("acknowledges each owner idempotently and activates the Tenant", async () => {
  const tenant = await createTenant("Lifecycle Complete");
  const expectations = ownerExpectations();
  let firstRequest: Parameters<typeof acknowledgeLifecycleStep>[1]
    | undefined;
  let firstResponse:
    Awaited<ReturnType<typeof acknowledgeLifecycleStep>> | undefined;

  for (const [index, owner] of expectations.entries()) {
    const page = await listLifecycleSteps(
      requireContext().client,
      { pageSize: 100 },
      workloadMetadata(owner.token));
    const step = requireTenantStep(page.steps, tenant.metadata.name);
    const request = {
      target: step.target,
      lifecycleOperationId: step.lifecycleOperationId,
      provisioningGeneration: step.provisioningGeneration,
      stepKey: step.stepKey,
      expectedStepRevision: step.stepRevision,
      ownerRevision: BigInt(index + 10),
      outcome: LifecycleStepOutcome.LIFECYCLE_STEP_OUTCOME_COMPLETE,
      idempotencyKey: `complete-${tenant.metadata.name}-${index}`
    };

    if (index === 0) {
      await assert.rejects(
        acknowledgeLifecycleStep(
          requireContext().client,
          request,
          workloadMetadata(expectations[1]!.token)),
        hasStatus(status.PERMISSION_DENIED));
    }

    const response = await acknowledgeLifecycleStep(
      requireContext().client,
      request,
      workloadMetadata(owner.token));
    assert.equal(
      response.stepState,
      LifecycleStepState.LIFECYCLE_STEP_STATE_COMPLETE);
    assert.equal(
      response.lifecycle,
      index === expectations.length - 1
        ? LifecycleState.LIFECYCLE_STATE_ACTIVE
        : LifecycleState.LIFECYCLE_STATE_PROVISIONING);
    if (index === 0) {
      firstRequest = request;
      firstResponse = response;
    }
  }

  assert.ok(firstRequest);
  assert.ok(firstResponse);
  const replay = await acknowledgeLifecycleStep(
    requireContext().client,
    firstRequest,
    workloadMetadata(expectations[0]!.token));
  assert.deepEqual(replay, firstResponse);

  await assert.rejects(
    acknowledgeLifecycleStep(
      requireContext().client,
      { ...firstRequest, ownerRevision: 999n },
      workloadMetadata(expectations[0]!.token)),
    hasStatus(status.ALREADY_EXISTS));

  const fact = await getLifecycle(
    requireContext().client,
    { target: { tenant: { tenantId: tenant.metadata.name } } },
    kernelMetadata());
  assert.equal(fact.lifecycle, LifecycleState.LIFECYCLE_STATE_ACTIVE);
  assert.equal(fact.currentOperationId, undefined);
});

test("blocks, exposes the reason, and retries the same lifecycle step", async () => {
  const tenant = await createTenant("Lifecycle Retry");
  const identity = ownerExpectations()[0]!;
  const pending = requireTenantStep(
    (await listLifecycleSteps(
      requireContext().client,
      { pageSize: 100 },
      workloadMetadata(identity.token))).steps,
    tenant.metadata.name);
  const blocked = await acknowledgeLifecycleStep(
    requireContext().client,
    {
      target: pending.target,
      lifecycleOperationId: pending.lifecycleOperationId,
      provisioningGeneration: pending.provisioningGeneration,
      stepKey: pending.stepKey,
      expectedStepRevision: pending.stepRevision,
      ownerRevision: 50n,
      outcome: LifecycleStepOutcome.LIFECYCLE_STEP_OUTCOME_BLOCKED,
      blockedReason: "directory unavailable",
      idempotencyKey: `block-${tenant.metadata.name}`
    },
    workloadMetadata(identity.token));
  assert.equal(blocked.lifecycle, LifecycleState.LIFECYCLE_STATE_FAILED);
  assert.equal(
    blocked.stepState,
    LifecycleStepState.LIFECYCLE_STEP_STATE_BLOCKED);

  const blockedStep = requireTenantStep(
    (await listLifecycleSteps(
      requireContext().client,
      { pageSize: 100 },
      workloadMetadata(identity.token))).steps,
    tenant.metadata.name);
  assert.equal(blockedStep.blockedReason, "directory unavailable");

  const current = await getTenant(tenant.metadata.name);
  const retriedResponse = await api({
    method: "PUT",
    path: `${basePath}/tenants/${tenant.metadata.name}/retry`,
    headers: { "Idempotency-Key": `retry-${tenant.metadata.name}` },
    body: lifecycleAction(current.metadata.resourceVersion)
  });
  assert.equal(retriedResponse.statusCode, 202, retriedResponse.text);
  const retried = requireTenant(retriedResponse);
  assert.equal(retried.status.lifecycle, "provisioning");
  assert.equal(
    retried.status.currentOperation?.id,
    tenant.status.currentOperation?.id);
  assert.equal(
    retried.status.provisioningGeneration,
    tenant.status.provisioningGeneration);

  const pendingAgain = requireTenantStep(
    (await listLifecycleSteps(
      requireContext().client,
      { pageSize: 100 },
      workloadMetadata(identity.token))).steps,
    tenant.metadata.name);
  assert.equal(
    pendingAgain.state,
    LifecycleStepState.LIFECYCLE_STEP_STATE_PENDING);
  assert.equal(pendingAgain.blockedReason, undefined);
  assert.ok(pendingAgain.stepRevision > pending.stepRevision);
});

test("pages owner work and expires a continuation after new delivery", async () => {
  await createTenant("Lifecycle Page One");
  await createTenant("Lifecycle Page Two");
  const identity = ownerExpectations()[0]!;
  const first = await listLifecycleSteps(
    requireContext().client,
    { pageSize: 1 },
    workloadMetadata(identity.token));
  assert.equal(first.steps.length, 1);
  assert.notEqual(first.nextPageToken, "");

  const second = await listLifecycleSteps(
    requireContext().client,
    { pageSize: 1, pageToken: first.nextPageToken },
    workloadMetadata(identity.token));
  assert.equal(second.deliveryRevision, first.deliveryRevision);
  assert.equal(second.steps.length, 1);

  const expiring = await listLifecycleSteps(
    requireContext().client,
    { pageSize: 1 },
    workloadMetadata(identity.token));
  await createTenant("Lifecycle Page Mutation");
  await assert.rejects(
    listLifecycleSteps(
      requireContext().client,
      { pageSize: 1, pageToken: expiring.nextPageToken },
      workloadMetadata(identity.token)),
    hasStatus(status.FAILED_PRECONDITION));
});

test("watches durable work strictly after an owner delivery cursor", async () => {
  const identity = ownerExpectations()[0]!;
  const beforeCreate = await listLifecycleSteps(
    requireContext().client,
    { pageSize: 100 },
    workloadMetadata(identity.token));
  const tenant = await createTenant("Lifecycle Watch");
  const event = await readFirstLifecycleStepEvent(
    requireContext().client,
    { afterDeliverySequence: beforeCreate.deliveryRevision },
    workloadMetadata(identity.token),
    { deadline: Date.now() + 2_000 });
  assert.ok(event.deliverySequence > beforeCreate.deliveryRevision);
  assert.equal(
    event.step?.target?.tenant?.tenantId,
    tenant.metadata.name);
  assert.equal(
    event.step?.stepKey,
    LifecycleStepKey.LIFECYCLE_STEP_KEY_IDENTITY);
});
});

function ownerExpectations(): readonly {
  readonly key: LifecycleStepKey;
  readonly token: string;
}[] {
  const owners = requireContext().lifecycleOwners;
  return [
    {
      key: LifecycleStepKey.LIFECYCLE_STEP_KEY_IDENTITY,
      token: owners.identity.callerToken
    },
    {
      key: LifecycleStepKey.LIFECYCLE_STEP_KEY_CONFIGURATION,
      token: owners.configuration.callerToken
    },
    {
      key: LifecycleStepKey.LIFECYCLE_STEP_KEY_EXECUTION,
      token: owners.execution.callerToken
    },
    {
      key: LifecycleStepKey.LIFECYCLE_STEP_KEY_PACKAGES,
      token: owners.packages.callerToken
    }
  ];
}

function requireTenantStep(
  steps: readonly LifecycleStep[],
  tenantId: string
): LifecycleStep {
  const step = steps.find((candidate) =>
    candidate.target?.tenant?.tenantId === tenantId);
  const returnedTargets = steps.map((candidate) =>
    candidate.target?.tenant?.tenantId
    ?? candidate.target?.workspace?.workspaceId
    ?? "<missing>");
  assert.ok(
    step,
    `No lifecycle step found for ${tenantId}; returned `
      + returnedTargets.join(", "));
  return step;
}

async function createTenant(displayName: string): Promise<TenantDocument> {
  const key = displayName.toLowerCase().replaceAll(" ", "-");
  const response = await api({
    method: "POST",
    path: `${basePath}/tenants`,
    headers: { "Idempotency-Key": `create-${key}` },
    body: {
      apiVersion: "tenancy.ctlflow.com/v1alpha1",
      kind: "Tenant",
      metadata: {},
      spec: {
        displayName,
        address: {
          authority: `${key}.example.com`,
          pathPrefix: "/"
        },
        initialAdministrator: {
          displayName: "Owner",
          loginIdentifier: "owner@example.com"
        },
        baselinePackages: [
          { packageId: "pkg_base", packageVersion: "1.0.0" }
        ]
      }
    }
  });
  assert.equal(response.statusCode, 201, response.text);
  return requireTenant(response);
}

async function getTenant(tenantId: string): Promise<TenantDocument> {
  const response = await api({
    method: "GET",
    path: `${basePath}/tenants/${tenantId}`
  });
  assert.equal(response.statusCode, 200, response.text);
  return requireTenant(response);
}

function lifecycleAction(resourceVersion: string): Record<string, unknown> {
  return {
    apiVersion: "tenancy.ctlflow.com/v1alpha1",
    kind: "LifecycleAction",
    resourceVersion
  };
}

async function api(
  options: Parameters<typeof requestTenancyApi>[1]
): Promise<TenancyApiResponse> {
  return requestTenancyApi(requireContext().kubernetesApi, options);
}

function requireTenant(response: TenancyApiResponse): TenantDocument {
  assert.equal(typeof response.body, "object");
  assert.notEqual(response.body, null);
  assert.equal((response.body as { kind?: unknown }).kind, "Tenant");
  return response.body as TenantDocument;
}

function kernelMetadata(): Metadata {
  return workloadMetadata(requireContext().kubernetes.callerToken);
}

function hasStatus(expected: status): (error: unknown) => boolean {
  return (error: unknown): boolean =>
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as ServiceError).code === expected;
}

function requireContext(): TenantdTestContext {
  assert.ok(context);
  return context;
}
