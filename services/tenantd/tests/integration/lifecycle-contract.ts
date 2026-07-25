import assert from "node:assert/strict";
import {
  Metadata,
  status,
  type ClientReadableStream,
  type ServiceError
} from "@grpc/grpc-js";
import { after, before, describe, test } from "node:test";
import {
  AcknowledgeLifecycleStepRequest,
  GetLifecycleRequest,
  LifecycleStepKey,
  LifecycleStepOutcome,
  LifecycleStepState,
  ListLifecycleStepsRequest,
  WatchLifecycleStepsRequest,
  type DeepPartial,
  type LifecycleStep,
  type LifecycleStepEvent
} from "../generated/v1/tenantd.js";
import {
  acknowledgeLifecycleStep
} from "../support/acknowledge-lifecycle-step.js";
import {
  createTenantdTestContext,
  type TenantdTestContext
} from "../support/create-tenantd-test-context.js";
import { createTestTenant } from "../support/create-test-tenant.js";
import { getLifecycle } from "../support/get-lifecycle.js";
import {
  listLifecycleSteps
} from "../support/list-lifecycle-steps.js";
import {
  findSpansForTrace
} from "../support/telemetry/find-spans-for-trace.js";
import {
  waitForExport
} from "../support/telemetry/wait-for-export.js";
import { workloadMetadata } from "../support/workload-metadata.js";

let context: TenantdTestContext | undefined;

describe("Lifecycle direct-operation contract", { concurrency: false }, () => {
before(async () => {
  context = await createTenantdTestContext({
    registerAggregatedApi: true
  });
});

after(async () => {
  await context?.stop();
  context = undefined;
});

test("returns every retained Tenant lifecycle with a bounded cache expiry", async () => {
  for (const [tenantId, lifecycle, revision] of requireContext()
    .retainedTenants) {
    const startedAt = Date.now();
    const response = await getLifecycle(
      requireContext().client,
      { target: { tenant: { tenantId } } },
      kernelMetadata());
    assert.equal(response.lifecycle, lifecycle);
    assert.equal(response.resourceRevision, BigInt(revision));
    assert.equal(response.target?.tenant?.tenantId, tenantId);
    assert.ok(response.cacheExpiresAt);
    assert.ok(response.cacheExpiresAt.getTime() > startedAt);
    assert.ok(response.cacheExpiresAt.getTime() <= startedAt + 60_000);
  }
});

test("exports the lifecycle operation and its database child span", async () => {
  const traceId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const metadata = kernelMetadata();
  metadata.set("traceparent", `00-${traceId}-cccccccccccccccc-01`);
  const response = await getLifecycle(
    requireContext().client,
    { target: { tenant: { tenantId: "tenant_active" } } },
    metadata);
  assert.equal(response.target?.tenant?.tenantId, "tenant_active");

  await waitForExport(
    requireContext().collector.tracesPath,
    (value) => {
      const spans = findSpansForTrace(value, traceId);
      const server = spans.find(
        (span) => span.name === "tenantd.GetLifecycle");
      const database = spans.find(
        (span) => span.name === "tenantd.db.query_lifecycle");
      return server !== undefined
        && database !== undefined
        && typeof server.spanId === "string"
        && database.parentSpanId === server.spanId;
    });
});

test("validates list authentication, page size, and token syntax", async () => {
  await assert.rejects(
    listLifecycleSteps(requireContext().client, {}, new Metadata()),
    hasStatus(status.UNAUTHENTICATED));
  await assert.rejects(
    listLifecycleSteps(
      requireContext().client,
      {},
      workloadMetadata(requireContext().kubernetes.unadmittedToken)),
    hasStatus(status.PERMISSION_DENIED));
  await assert.rejects(
    listLifecycleSteps(
      requireContext().client,
      { pageSize: 101 },
      identityMetadata()),
    hasStatus(status.INVALID_ARGUMENT));
  await assert.rejects(
    listLifecycleSteps(
      requireContext().client,
      { pageToken: "not!canonical" },
      identityMetadata()),
    hasStatus(status.INVALID_ARGUMENT));
});

test("rejects absent, wrong-owner, expired, and superseded page tokens", async () => {
  await createPendingTenant("Lifecycle Tokens One", "tokens-one");
  await createPendingTenant("Lifecycle Tokens Two", "tokens-two");

  await assert.rejects(
    listLifecycleSteps(
      requireContext().client,
      { pageSize: 1, pageToken: "missing_token" },
      identityMetadata()),
    hasStatus(status.FAILED_PRECONDITION));

  const wrongOwner = await firstPageToken();
  await assert.rejects(
    listLifecycleSteps(
      requireContext().client,
      { pageSize: 1, pageToken: wrongOwner },
      configurationMetadata()),
    hasStatus(status.FAILED_PRECONDITION));

  const expired = await firstPageToken();
  await requireContext().database.connection("lifecycle_page_cursors")
    .where({ page_token: expired })
    .update({ expires_at_unix_ms: 1 });
  await assert.rejects(
    listLifecycleSteps(
      requireContext().client,
      { pageSize: 1, pageToken: expired },
      identityMetadata()),
    hasStatus(status.FAILED_PRECONDITION));

  const superseded = await firstPageToken();
  await createPendingTenant("Lifecycle Tokens Three", "tokens-three");
  await assert.rejects(
    listLifecycleSteps(
      requireContext().client,
      { pageSize: 1, pageToken: superseded },
      identityMetadata()),
    hasStatus(status.FAILED_PRECONDITION));
});

test("uses the documented default and maximum lifecycle page sizes", async () => {
  for (let index = 0; index < 51; index += 1) {
    await createPendingTenant(
      `Default Page ${String(index)}`,
      `default-page-${String(index)}`);
  }

  const defaultPage = await listLifecycleSteps(
    requireContext().client,
    {},
    identityMetadata());
  assert.equal(defaultPage.steps.length, 50);
  assert.notEqual(defaultPage.nextPageToken, "");

  const maximumPage = await listLifecycleSteps(
    requireContext().client,
    { pageSize: 100 },
    identityMetadata());
  assert.ok(maximumPage.steps.length >= 51);
  assert.ok(maximumPage.steps.length <= 100);
});

test("validates watch authentication, cursor, lifetime, and termination", async () => {
  await assert.rejects(
    readWatchFailure({}, new Metadata()),
    hasStatus(status.UNAUTHENTICATED));
  await assert.rejects(
    readWatchFailure(
      {},
      workloadMetadata(requireContext().kubernetes.unadmittedToken)),
    hasStatus(status.PERMISSION_DENIED));

  const current = await listLifecycleSteps(
    requireContext().client,
    { pageSize: 100 },
    identityMetadata());
  await assert.rejects(
    readWatchFailure(
      { afterDeliverySequence: current.deliveryRevision + 1n },
      identityMetadata()),
    hasStatus(status.INVALID_ARGUMENT));

  const startedAt = Date.now();
  const events = await readWatchToEnd(
    { afterDeliverySequence: current.deliveryRevision },
    identityMetadata());
  assert.deepEqual(events, []);
  assert.ok(Date.now() - startedAt >= 900);
  assert.ok(Date.now() - startedAt < 3_000);

  await assert.rejects(
    readWatchFailure(
      { afterDeliverySequence: current.deliveryRevision },
      identityMetadata(),
      { deadline: Date.now() + 100 }),
    hasStatus(status.DEADLINE_EXCEEDED));
  await assert.rejects(
    cancelWatch(
      { afterDeliverySequence: current.deliveryRevision },
      identityMetadata()),
    hasStatus(status.CANCELLED));
});

test("validates every acknowledgement field before persistence", async () => {
  const step = await createIdentityStep(
    "Lifecycle Invalid Ack",
    "invalid-ack");
  const valid = acknowledgementFor(step, "valid-ack-shape");
  const invalid: readonly DeepPartial<AcknowledgeLifecycleStepRequest>[] = [
    { ...valid, target: undefined },
    { ...valid, target: { tenant: { tenantId: "Tenant" } } },
    { ...valid, lifecycleOperationId: "" },
    { ...valid, provisioningGeneration: 0n },
    { ...valid, stepKey: LifecycleStepKey.LIFECYCLE_STEP_KEY_UNSPECIFIED },
    { ...valid, expectedStepRevision: 0n },
    { ...valid, ownerRevision: 0n },
    { ...valid, outcome: LifecycleStepOutcome.LIFECYCLE_STEP_OUTCOME_UNSPECIFIED },
    {
      ...valid,
      outcome: LifecycleStepOutcome.LIFECYCLE_STEP_OUTCOME_BLOCKED
    },
    { ...valid, blockedReason: "not allowed for complete" },
    {
      ...valid,
      outcome: LifecycleStepOutcome.LIFECYCLE_STEP_OUTCOME_BLOCKED,
      blockedReason: "x".repeat(201)
    },
    { ...valid, idempotencyKey: "not canonical!" }
  ];

  for (const request of invalid) {
    await assert.rejects(
      acknowledgeLifecycleStep(
        requireContext().client,
        request,
        identityMetadata()),
      hasStatus(status.INVALID_ARGUMENT));
  }
});

test("distinguishes missing, stale, conflicting, and completed steps", async () => {
  const missingStep = await createIdentityStep(
    "Lifecycle Missing Step",
    "missing-step");
  await requireContext().database.connection("lifecycle_deliveries")
    .where({
      operation_id: missingStep.lifecycleOperationId,
      step_key: LifecycleStepKey.LIFECYCLE_STEP_KEY_IDENTITY
    })
    .delete();
  await requireContext().database.connection("lifecycle_steps")
    .where({
      operation_id: missingStep.lifecycleOperationId,
      step_key: LifecycleStepKey.LIFECYCLE_STEP_KEY_IDENTITY
    })
    .delete();
  await assert.rejects(
    acknowledgeLifecycleStep(
      requireContext().client,
      acknowledgementFor(missingStep, "missing-step-ack"),
      identityMetadata()),
    hasStatus(status.NOT_FOUND));

  const step = await createIdentityStep(
    "Lifecycle Ack Outcomes",
    "ack-outcomes");
  const valid = acknowledgementFor(step, "ack-outcomes-valid");

  await assert.rejects(
    acknowledgeLifecycleStep(
      requireContext().client,
      {
        ...valid,
        target: { tenant: { tenantId: "tnt_missing" } }
      },
      identityMetadata()),
    hasStatus(status.FAILED_PRECONDITION));
  await assert.rejects(
    acknowledgeLifecycleStep(
      requireContext().client,
      {
        ...valid,
        lifecycleOperationId: "lop_missing"
      },
      identityMetadata()),
    hasStatus(status.FAILED_PRECONDITION));
  await assert.rejects(
    acknowledgeLifecycleStep(
      requireContext().client,
      {
        ...valid,
        provisioningGeneration: valid.provisioningGeneration! + 1n
      },
      identityMetadata()),
    hasStatus(status.FAILED_PRECONDITION));
  await assert.rejects(
    acknowledgeLifecycleStep(
      requireContext().client,
      {
        ...valid,
        expectedStepRevision: valid.expectedStepRevision! + 1n
      },
      identityMetadata()),
    hasStatus(status.ABORTED));

  const accepted = await acknowledgeLifecycleStep(
    requireContext().client,
    valid,
    identityMetadata());
  assert.equal(
    accepted.stepState,
    LifecycleStepState.LIFECYCLE_STEP_STATE_COMPLETE);
  await assert.rejects(
    acknowledgeLifecycleStep(
      requireContext().client,
      {
        ...valid,
        expectedStepRevision: accepted.stepRevision,
        idempotencyKey: "ack-outcomes-after-complete"
      },
      identityMetadata()),
    hasStatus(status.FAILED_PRECONDITION));
});

test("propagates auth, deadlines, cancellation, and schema unavailability", async () => {
  const step = await createIdentityStep(
    "Lifecycle Failures",
    "lifecycle-failures");
  const acknowledgement = acknowledgementFor(
    step,
    "lifecycle-failure-ack");

  await assert.rejects(
    acknowledgeLifecycleStep(
      requireContext().client,
      acknowledgement,
      new Metadata()),
    hasStatus(status.UNAUTHENTICATED));
  await assert.rejects(
    acknowledgeLifecycleStep(
      requireContext().client,
      acknowledgement,
      workloadMetadata(requireContext().kubernetes.unadmittedToken)),
    hasStatus(status.PERMISSION_DENIED));

  await assert.rejects(
    getLifecycle(
      requireContext().client,
      { target: { tenant: { tenantId: "tenant_active" } } },
      kernelMetadata(),
      { deadline: Date.now() - 1 }),
    hasStatus(status.DEADLINE_EXCEEDED));
  await assert.rejects(cancelGetLifecycle(), hasStatus(status.CANCELLED));
  await assert.rejects(
    listLifecycleSteps(
      requireContext().client,
      {},
      identityMetadata(),
      { deadline: Date.now() - 1 }),
    hasStatus(status.DEADLINE_EXCEEDED));
  await assert.rejects(cancelList(), hasStatus(status.CANCELLED));
  await assert.rejects(
    acknowledgeLifecycleStep(
      requireContext().client,
      acknowledgement,
      identityMetadata(),
      { deadline: Date.now() - 1 }),
    hasStatus(status.DEADLINE_EXCEEDED));
  await assert.rejects(
    cancelAcknowledgement(acknowledgement),
    hasStatus(status.CANCELLED));

  await requireContext().database.connection("knex_migrations_lock")
    .update({ is_locked: 1 });
  try {
    await assert.rejects(
      getLifecycle(
        requireContext().client,
        { target: { tenant: { tenantId: "tenant_active" } } },
        kernelMetadata()),
      hasStatus(status.UNAVAILABLE));
    await assert.rejects(
      listLifecycleSteps(
        requireContext().client,
        {},
        identityMetadata()),
      hasStatus(status.UNAVAILABLE));
    await assert.rejects(
      readWatchFailure({}, identityMetadata()),
      hasStatus(status.UNAVAILABLE));
    await assert.rejects(
      acknowledgeLifecycleStep(
        requireContext().client,
        acknowledgement,
        identityMetadata()),
      hasStatus(status.UNAVAILABLE));
  } finally {
    await requireContext().database.connection("knex_migrations_lock")
      .update({ is_locked: 0 });
  }
});
});

async function createPendingTenant(
  displayName: string,
  key: string
): Promise<void> {
  await createTestTenant(
    requireContext(),
    displayName,
    `${key}.example.com`,
    `create-${key}`);
}

async function createIdentityStep(
  displayName: string,
  key: string
): Promise<LifecycleStep> {
  const tenant = await createTestTenant(
    requireContext(),
    displayName,
    `${key}.example.com`,
    `create-${key}`);
  const page = await listLifecycleSteps(
    requireContext().client,
    { pageSize: 100 },
    identityMetadata());
  const step = page.steps.find((candidate) =>
    candidate.target?.tenant?.tenantId === tenant.metadata.name);
  assert.ok(step);
  return step;
}

function acknowledgementFor(
  step: LifecycleStep,
  idempotencyKey: string
): DeepPartial<AcknowledgeLifecycleStepRequest> {
  return {
    target: step.target,
    lifecycleOperationId: step.lifecycleOperationId,
    provisioningGeneration: step.provisioningGeneration,
    stepKey: step.stepKey,
    expectedStepRevision: step.stepRevision,
    ownerRevision: 1n,
    outcome: LifecycleStepOutcome.LIFECYCLE_STEP_OUTCOME_COMPLETE,
    idempotencyKey
  };
}

async function firstPageToken(): Promise<string> {
  const page = await listLifecycleSteps(
    requireContext().client,
    { pageSize: 1 },
    identityMetadata());
  assert.notEqual(page.nextPageToken, "");
  return page.nextPageToken;
}

async function readWatchToEnd(
  request: DeepPartial<WatchLifecycleStepsRequest>,
  metadata: Metadata,
  options?: { readonly deadline: number }
): Promise<readonly LifecycleStepEvent[]> {
  const events: LifecycleStepEvent[] = [];
  const call = watch(request, metadata, options);
  return await new Promise((resolve, reject) => {
    call.on("data", (event: LifecycleStepEvent) => events.push(event));
    call.once("error", reject);
    call.once("end", () => resolve(events));
  });
}

async function readWatchFailure(
  request: DeepPartial<WatchLifecycleStepsRequest>,
  metadata: Metadata,
  options?: { readonly deadline: number }
): Promise<never> {
  const call = watch(request, metadata, options);
  return await new Promise<never>((_resolve, reject) => {
    call.once("error", reject);
    call.once("end", () =>
      reject(new Error("Lifecycle watch ended without an error")));
  });
}

async function cancelWatch(
  request: DeepPartial<WatchLifecycleStepsRequest>,
  metadata: Metadata
): Promise<never> {
  const call = watch(request, metadata);
  const failed = new Promise<never>((_resolve, reject) => {
    call.once("error", reject);
    call.once("end", () =>
      reject(new Error("Cancelled lifecycle watch ended without an error")));
  });
  call.cancel();
  return await failed;
}

function watch(
  request: DeepPartial<WatchLifecycleStepsRequest>,
  metadata: Metadata,
  options?: { readonly deadline: number }
): ClientReadableStream<LifecycleStepEvent> {
  return requireContext().client.watchLifecycleSteps(
    WatchLifecycleStepsRequest.create(request),
    metadata,
    options);
}

async function cancelGetLifecycle(): Promise<never> {
  return await new Promise<never>((_resolve, reject) => {
    const call = requireContext().client.getLifecycle(
      GetLifecycleRequest.create({
        target: { tenant: { tenantId: "tenant_active" } }
      }),
      kernelMetadata(),
      (error) => reject(error ?? new Error("Cancelled GetLifecycle succeeded")));
    call.on("error", () => undefined);
    call.cancel();
  });
}

async function cancelList(): Promise<never> {
  return await new Promise<never>((_resolve, reject) => {
    const call = requireContext().client.listLifecycleSteps(
      ListLifecycleStepsRequest.create({}),
      identityMetadata(),
      (error) => reject(error ?? new Error("Cancelled lifecycle list succeeded")));
    call.on("error", () => undefined);
    call.cancel();
  });
}

async function cancelAcknowledgement(
  request: DeepPartial<AcknowledgeLifecycleStepRequest>
): Promise<never> {
  return await new Promise<never>((_resolve, reject) => {
    const call = requireContext().client.acknowledgeLifecycleStep(
      AcknowledgeLifecycleStepRequest.create(request),
      identityMetadata(),
      (error) =>
        reject(error ?? new Error("Cancelled acknowledgement succeeded")));
    call.on("error", () => undefined);
    call.cancel();
  });
}

function identityMetadata(): Metadata {
  return workloadMetadata(
    requireContext().lifecycleOwners.identity.callerToken);
}

function configurationMetadata(): Metadata {
  return workloadMetadata(
    requireContext().lifecycleOwners.configuration.callerToken);
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
