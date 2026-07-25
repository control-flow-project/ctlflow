import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, describe, test } from "node:test";
import {
  LifecycleState,
  LifecycleStepKey,
  LifecycleStepOutcome,
  type LifecycleStep
} from "../generated/v1/tenantd.js";
import {
  acknowledgeLifecycleStep
} from "../support/acknowledge-lifecycle-step.js";
import {
  createTenantBody
} from "../support/create-tenant-body.js";
import {
  createTenantdTestContext,
  type TenantdTestContext
} from "../support/create-tenantd-test-context.js";
import {
  createTestTenant
} from "../support/create-test-tenant.js";
import {
  createTestWorkspace
} from "../support/create-test-workspace.js";
import { getTestTenant } from "../support/get-test-tenant.js";
import { insertTenant } from "../support/insert-tenant.js";
import {
  listLifecycleSteps
} from "../support/list-lifecycle-steps.js";
import {
  requestTenancyApi
} from "../support/request-tenancy-api.js";
import {
  hasOperationLog
} from "../support/telemetry/has-operation-log.js";
import {
  readAllExports
} from "../support/telemetry/read-all-exports.js";
import {
  waitForExport
} from "../support/telemetry/wait-for-export.js";
import {
  waitForAuditEvents
} from "../support/wait-for-audit-events.js";
import {
  waitForAuditOutboxCount
} from "../support/wait-for-audit-outbox-count.js";
import { readProbeStatus } from "../support/read-probe-status.js";
import { workloadMetadata } from "../support/workload-metadata.js";

const basePath = "/apis/tenancy.ctlflow.com/v1alpha1";
let context: TenantdTestContext | undefined;

describe("Audit delivery", { concurrency: false }, () => {
before(async () => {
  context = await createTenantdTestContext({
    registerAggregatedApi: true,
    seedResolutionData: false
  });
});

after(async () => {
  await context?.stop();
  context = undefined;
});

test("delivers one redacted event for an accepted mutation only", async () => {
  const current = requireContext();
  const baseline = (await current.auditd.readEvents()).length;
  const tenant = await createTestTenant(
    current,
    "Audit Northwind",
    "audit-northwind.example.com",
    "audit-create-northwind");
  const events = await waitForAuditEvents(current.auditd, baseline + 1);
  const event = events[baseline]!;

  assert.match(event.sourceEventId, /^evt_[a-f0-9]{32}$/u);
  assert.ok(BigInt(event.sourceSequence) > 0n);
  assert.equal(event.idempotencyKey, "audit-create-northwind");
  assert.equal(event.operation, "create_tenant");
  assert.ok(Date.parse(event.occurredAt) > 0);
  assert.notEqual(event.operatorSubject, "");
  assert.equal(event.immediateCaller, undefined);
  assert.equal(event.tenantId, tenant.metadata.name);
  assert.deepEqual(event.target, {
    kind: "tenant",
    tenantId: tenant.metadata.name
  });
  assert.equal(event.resourceRevision, "1");
  assert.equal(event.outcome, "succeeded");
  assert.match(event.traceId, /^[a-f0-9]{32}$/u);
  assert.match(event.spanId, /^[a-f0-9]{16}$/u);
  assert.ok(BigInt(event.partitionCursor) > 0n);

  const evidence = JSON.stringify(event);
  for (const forbidden of [
    "Audit Northwind",
    "audit-northwind.example.com",
    "Ada Lovelace",
    "ada@example.com",
    "provider_primary",
    "pkg_chat"
  ]) {
    assert.equal(evidence.includes(forbidden), false);
  }

  const replay = await createTestTenant(
    current,
    "Audit Northwind",
    "audit-northwind.example.com",
    "audit-create-northwind");
  assert.equal(replay.metadata.name, tenant.metadata.name);

  const rejected = await requestTenancyApi(current.kubernetesApi, {
    method: "POST",
    path: `${basePath}/tenants`,
    headers: { "Idempotency-Key": "audit-rejected-address" },
    body: createTenantBody(
      "Rejected Audit Tenant",
      "audit-northwind.example.com")
  });
  assert.equal(rejected.statusCode, 409, rejected.text);

  await waitForAuditOutboxCount(current.database, 0);
  await delay(100);
  assert.equal((await current.auditd.readEvents()).length, baseline + 1);
});

test("delivers an exact Workspace target without Workspace content", async () => {
  const current = requireContext();
  const tenantId = "tenant_audit_workspace";
  await insertTenant(current.database.connection, {
    id: tenantId,
    lifecycle: LifecycleState.LIFECYCLE_STATE_ACTIVE
  });
  const baseline = (await current.auditd.readEvents()).length;
  const workspace = await createTestWorkspace(
    current,
    tenantId,
    "Audit Workspace",
    "audit-workspace",
    "audit-create-workspace");
  const events = await waitForAuditEvents(current.auditd, baseline + 1);
  const event = events[baseline]!;

  assert.equal(event.operation, "create_workspace");
  assert.equal(event.tenantId, tenantId);
  assert.deepEqual(event.target, {
    kind: "workspace",
    tenantId,
    workspaceId: workspace.metadata.name
  });
  assert.equal(event.resourceRevision, "1");
  const evidence = JSON.stringify(event);
  for (const forbidden of [
    "Audit Workspace",
    "audit-workspace",
    "usr_workspace_admin",
    "pkg_workspace"
  ]) {
    assert.equal(evidence.includes(forbidden), false);
  }
});

test("attributes lifecycle acknowledgement to operator and owner", async () => {
  const current = requireContext();
  const baseline = (await current.auditd.readEvents()).length;
  const tenant = await createTestTenant(
    current,
    "Audit Lifecycle",
    "audit-lifecycle.example.com",
    "audit-create-lifecycle");
  const createdEvents = await waitForAuditEvents(
    current.auditd,
    baseline + 1);
  const creation = createdEvents[baseline]!;
  const step = findTenantStep(
    (await listLifecycleSteps(
      current.client,
      { pageSize: 100 },
      workloadMetadata(
        current.lifecycleOwners.identity.callerToken))).steps,
    tenant.metadata.name);
  const acknowledgement = await acknowledgeLifecycleStep(
    current.client,
    {
      target: step.target,
      lifecycleOperationId: step.lifecycleOperationId,
      provisioningGeneration: step.provisioningGeneration,
      stepKey: step.stepKey,
      expectedStepRevision: step.stepRevision,
      ownerRevision: 1n,
      outcome: LifecycleStepOutcome.LIFECYCLE_STEP_OUTCOME_COMPLETE,
      idempotencyKey: "audit-acknowledge-identity"
    },
    workloadMetadata(current.lifecycleOwners.identity.callerToken));
  const events = await waitForAuditEvents(current.auditd, baseline + 2);
  const event = events[baseline + 1]!;

  assert.equal(event.operation, "acknowledge_lifecycle_step");
  assert.equal(event.operatorSubject, creation.operatorSubject);
  assert.equal(
    event.immediateCaller,
    current.lifecycleOwners.identity.callerSubject);
  assert.equal(event.idempotencyKey, "audit-acknowledge-identity");
  assert.equal(event.resourceRevision, String(
    acknowledgement.resourceRevision));
  assert.deepEqual(event.target, {
    kind: "tenant",
    tenantId: tenant.metadata.name
  });
});

test("retries a durable intent after audit outage and process restart", async () => {
  const current = requireContext();
  const baseline = (await current.auditd.readEvents()).length;
  await current.auditd.setMode("unavailable");
  const tenant = await createTestTenant(
    current,
    "Audit Restart",
    "audit-restart.example.com",
    "audit-create-restart");
  await waitForAuditOutboxCount(current.database, 1);
  assert.equal(await readProbeStatus(current.probePort), 204);

  await current.service.restart();
  assert.equal(
    (await getTestTenant(current, tenant.metadata.name)).metadata.name,
    tenant.metadata.name);
  await current.auditd.setMode("normal");
  await waitForAuditEvents(current.auditd, baseline + 1);
  await waitForAuditOutboxCount(current.database, 0);
});

test("replays exactly after remote acceptance loses its response", async () => {
  const current = requireContext();
  const baseline = (await current.auditd.readEvents()).length;
  await current.auditd.setMode("accept-then-drop");
  await createTestTenant(
    current,
    "Audit Accepted Retry",
    "audit-accepted-retry.example.com",
    "audit-create-accepted-retry");

  const events = await waitForAuditEvents(current.auditd, baseline + 1);
  await waitForAuditOutboxCount(current.database, 0);
  assert.equal(events.length, baseline + 1);
  assert.equal(
    events[baseline]!.idempotencyKey,
    "audit-create-accepted-retry");
});

test("reads rotated workload credentials for every delivery attempt", async () => {
  const current = requireContext();
  const baseline = (await current.auditd.readEvents()).length;
  await current.auditd.replaceToken("invalid-audit-workload-token");
  await createTestTenant(
    current,
    "Audit Token Rotation",
    "audit-token-rotation.example.com",
    "audit-create-token-rotation");
  await waitForAuditOutboxCount(current.database, 1);
  await delay(250);
  assert.equal((await current.auditd.readEvents()).length, baseline);
  assert.equal(await readProbeStatus(current.probePort), 204);

  await current.auditd.restoreToken();
  await waitForAuditEvents(current.auditd, baseline + 1);
  await waitForAuditOutboxCount(current.database, 0);
});

test("retries finite remote-capacity rejection without blocking", async () => {
  const current = requireContext();
  const baseline = (await current.auditd.readEvents()).length;
  await current.auditd.setMode("resource-exhausted");
  await createTestTenant(
    current,
    "Audit Remote Capacity",
    "audit-remote-capacity.example.com",
    "audit-create-remote-capacity");
  await waitForAuditOutboxCount(current.database, 1);
  await delay(250);
  assert.equal((await current.auditd.readEvents()).length, baseline);
  assert.equal(await readProbeStatus(current.probePort), 204);

  await current.auditd.setMode("normal");
  await waitForAuditEvents(current.auditd, baseline + 1);
  await waitForAuditOutboxCount(current.database, 0);
});

test("recovers an abandoned finite lease after process failure", async () => {
  const current = requireContext();
  const baseline = (await current.auditd.readEvents()).length;
  await current.auditd.setMode("stall");
  await createTestTenant(
    current,
    "Audit Lease Recovery",
    "audit-lease-recovery.example.com",
    "audit-create-lease-recovery");
  await waitForClaimedOutbox(current);

  await current.auditd.setMode("normal");
  await current.service.restart();
  const events = await waitForAuditEvents(current.auditd, baseline + 1);
  await waitForAuditOutboxCount(current.database, 0);
  assert.equal(
    events[baseline]!.idempotencyKey,
    "audit-create-lease-recovery");
});

test("exports bounded audit-delivery telemetry without evidence content", async () => {
  const current = requireContext();
  const baseline = (await current.auditd.readEvents()).length;
  await createTestTenant(
    current,
    "Audit Telemetry Secret",
    "audit-telemetry.example.com",
    "audit-create-telemetry");
  const events = await waitForAuditEvents(current.auditd, baseline + 1);
  const event = events[baseline]!;
  await waitForExport(
    current.collector.logsPath,
    (content) => hasOperationLog(content, {
      operation: "RecordAuditBatch",
      outcome: "ok"
    }));
  await waitForExport(
    current.collector.tracesPath,
    (content) => content.includes("tenantd.RecordAuditBatch"));

  const exports = await readAllExports(current.collector);
  const token = await readFile(current.auditd.tokenFile, "utf8");
  for (const forbidden of [
    event.sourceEventId,
    event.idempotencyKey,
    "Audit Telemetry Secret",
    "audit-telemetry.example.com",
    token
  ]) {
    assert.equal(exports.includes(forbidden), false);
  }
});
});

function requireContext(): TenantdTestContext {
  assert.ok(context);
  return context;
}

function findTenantStep(
  steps: readonly LifecycleStep[],
  tenantId: string
): LifecycleStep {
  const step = steps.find((candidate) =>
    candidate.target?.tenant?.tenantId === tenantId);
  assert.ok(step);
  assert.equal(
    step.stepKey,
    LifecycleStepKey.LIFECYCLE_STEP_KEY_IDENTITY);
  return step;
}

async function waitForClaimedOutbox(
  current: TenantdTestContext
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const row = await current.database.connection("audit_outbox")
      .select("delivery_state")
      .first() as { readonly delivery_state?: number } | undefined;
    if (row?.delivery_state === 2) {
      return;
    }

    await delay(10);
  }

  assert.fail("Audit outbox row was not claimed");
}
