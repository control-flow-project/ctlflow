import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AuditdMode
} from "../dependencies/auditd/auditd-mode.js";
import { createTenantBody } from "../support/create-tenant-body.js";
import {
  createTenantdTestContext,
  type TenantdTestContext
} from "../support/create-tenantd-test-context.js";
import { createTestTenant } from "../support/create-test-tenant.js";
import {
  requestTenancyApi
} from "../support/request-tenancy-api.js";
import {
  waitForAuditOutboxCount
} from "../support/wait-for-audit-outbox-count.js";
import {
  waitForProbeStatus
} from "../support/wait-for-probe-status.js";

const basePath = "/apis/tenancy.ctlflow.com/v1alpha1";

for (const failure of [
  {
    mode: "conflicting-replay",
    name: "conflicting replay",
    code: 1
  },
  {
    mode: "invalid-envelope",
    name: "invalid envelope",
    code: 2
  },
  {
    mode: "permission-denied",
    name: "unadmitted source",
    code: 3
  },
  {
    mode: "invalid-acceptance",
    name: "invalid acceptance",
    code: 4
  }
] as const satisfies readonly {
  readonly mode: AuditdMode;
  readonly name: string;
  readonly code: number;
}[]) {
  test(
    `blocks readiness and later mutations after ${failure.name}`,
    async () => {
      const context = await createContext();
      try {
        await context.auditd.setMode(failure.mode);
        await createTestTenant(
          context,
          `Audit ${failure.name}`,
          `audit-${failure.code}.example.com`,
          `audit-permanent-${failure.code}`);
        await waitForProbeStatus(context.probePort, 503);

        const state = await context.database
          .connection("audit_outbox_state")
          .select("pending_count", "permanently_blocked")
          .where({ state_id: 1 })
          .first() as {
            readonly pending_count?: number;
            readonly permanently_blocked?: number;
          } | undefined;
        assert.deepEqual(state, {
          pending_count: 1,
          permanently_blocked: 1
        });
        const blocked = await context.database.connection("audit_outbox")
          .select("delivery_state", "failure_code")
          .first() as {
            readonly delivery_state?: number;
            readonly failure_code?: number;
          } | undefined;
        assert.deepEqual(blocked, {
          delivery_state: 3,
          failure_code: failure.code
        });

        const before = await countTenants(context);
        const rejected = await requestTenancyApi(context.kubernetesApi, {
          method: "POST",
          path: `${basePath}/tenants`,
          headers: {
            "Idempotency-Key": `audit-after-block-${failure.code}`
          },
          body: createTenantBody(
            "Must Not Commit",
            `audit-after-block-${failure.code}.example.com`)
        });
        assert.equal(rejected.statusCode, 503, rejected.text);
        assert.equal(await countTenants(context), before);
        assert.equal((await context.auditd.readEvents()).length, 0);
      } finally {
        await context.stop();
      }
    });
}

test("fails readiness and mutation admission at finite outbox capacity", async () => {
  const context = await createTenantdTestContext({
    auditOutboxCapacity: 1,
    registerAggregatedApi: true,
    seedResolutionData: false
  });
  try {
    await context.auditd.setMode("unavailable");
    await createTestTenant(
      context,
      "Audit Capacity One",
      "audit-capacity-one.example.com",
      "audit-capacity-one");
    await waitForAuditOutboxCount(context.database, 1);
    await waitForProbeStatus(context.probePort, 503);

    const before = await countTenants(context);
    const rejected = await requestTenancyApi(context.kubernetesApi, {
      method: "POST",
      path: `${basePath}/tenants`,
      headers: { "Idempotency-Key": "audit-capacity-two" },
      body: createTenantBody(
        "Audit Capacity Two",
        "audit-capacity-two.example.com")
    });
    assert.equal(rejected.statusCode, 503, rejected.text);
    assert.equal(await countTenants(context), before);
    await waitForAuditOutboxCount(context.database, 1);
    assert.equal((await context.auditd.readEvents()).length, 0);
  } finally {
    await context.stop();
  }
});

async function createContext(): Promise<TenantdTestContext> {
  return await createTenantdTestContext({
    registerAggregatedApi: true,
    seedResolutionData: false
  });
}

async function countTenants(
  context: TenantdTestContext
): Promise<number> {
  const row = await context.database.connection("tenants")
    .count({ count: "*" })
    .first() as { readonly count?: number | string } | undefined;
  return Number(row?.count ?? 0);
}
