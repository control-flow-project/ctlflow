import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TenantMutationAction,
  TenancyResourceState
} from "../generated/v1/auditd.js";
import {
  getAuditdTestContext
} from "../suite/get-auditd-test-context.js";
import {
  createAuditEvent
} from "../support/audit-events/create-audit-event.js";
import {
  recordAuditBatch
} from "../support/record-audit-batch.js";

test("auditd durably accepts typed Tenant evidence", async () => {
  const context = getAuditdTestContext();
  const event = createAuditEvent({
    tenantMutation: {
      action:
        TenantMutationAction.TENANT_MUTATION_ACTION_CREATE_TENANT,
      resourceRevision: 1n,
      resultingState:
        TenancyResourceState.TENANCY_RESOURCE_STATE_ACTIVE
    }
  });

  const response = await recordAuditBatch(
    context,
    context.workloads.tenantd,
    [event]);

  assert.deepEqual(response.acceptances, [{
    sourceEventId: event.sourceEventId,
    partitionCursor: 1n
  }]);
  const stored = await context.database.connection("audit_events")
    .where({
      source_principal: "SERVICE/svc_tenantd",
      source_event_id: event.sourceEventId
    })
    .first();
  assert.equal(stored?.partition_key, "tenant:acme");
  assert.equal(stored?.detail_kind, 1);
});
