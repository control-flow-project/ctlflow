import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, describe, test } from "node:test";
import {
  Metadata,
  status,
  type ServiceError
} from "@grpc/grpc-js";
import {
  ResolveTenantRequest,
  TenantServiceService
} from "../generated/v1/tenantd.js";
import {
  createInvalidInvocationTokens
} from "../support/create-invalid-invocation-tokens.js";
import {
  createInvalidTenantSelectors
} from "../support/create-invalid-tenant-selectors.js";
import {
  createTenantdTestContext,
  type TenantdTestContext
} from "../support/create-tenantd-test-context.js";
import { insertAddressBinding } from "../support/insert-address-binding.js";
import { resolveTenant } from "../support/resolve-tenant.js";
import {
  countOccurrences
} from "../support/telemetry/count-occurrences.js";
import {
  hasOperationLog
} from "../support/telemetry/has-operation-log.js";
import {
  readAllExports
} from "../support/telemetry/read-all-exports.js";
import {
  waitForExport
} from "../support/telemetry/wait-for-export.js";

let context: TenantdTestContext | undefined;

describe("ResolveTenant", { concurrency: false }, () => {
before(async () => {
  context = await createTenantdTestContext();
});

after(async () => {
  await context?.stop();
  context = undefined;
});

test("the generated API inventory contains only the advertised operations", () => {
  assert.deepEqual(
    Object.keys(TenantServiceService),
    [
      "resolveTenant",
      "resolveWorkspace",
      "getLifecycle",
      "listLifecycleSteps",
      "watchLifecycleSteps",
      "acknowledgeLifecycleStep"
    ]);
});

test("resolves every retained Tenant lifecycle by ID", async () => {
  for (const [tenantId, lifecycle, revision] of
    requireContext().retainedTenants) {
    const response = await resolveTenant(
      requireClient(),
      { tenantId },
      workloadMetadata(requireKubernetes().callerToken));

    assert.equal(response.tenantId, tenantId);
    assert.equal(response.lifecycle, lifecycle);
    assert.equal(response.tenantRevision, BigInt(revision));
    assert.equal(response.address, undefined);
    assertCacheLifetime(response.cacheExpiresAt, 30);
  }
});

test("returns not found for an unknown Tenant ID", async () => {
  await assert.rejects(
    resolveTenant(
      requireClient(),
      { tenantId: "tenant_missing" },
      workloadMetadata(requireKubernetes().callerToken)),
    hasStatus(status.NOT_FOUND));
});

test("resolves canonical root and shared-host addresses", async () => {
  const root = await resolveTenant(
    requireClient(),
    {
      externalAddress: {
        authority: "tenant.example.com",
        pathPrefix: "/"
      }
    },
    workloadMetadata(requireKubernetes().callerToken));
  assert.equal(root.tenantId, "tenant_active");
  assert.equal(root.address?.bindingGeneration, 3n);

  const shared = await resolveTenant(
    requireClient(),
    {
      externalAddress: {
        authority: "shared.example.com",
        pathPrefix: "/tenants/atlas"
      }
    },
    workloadMetadata(requireKubernetes().callerToken));
  assert.equal(shared.tenantId, "tenant_shared");
  assert.equal(shared.address?.bindingGeneration, 4n);
});

test("hides retired, inactive-Tenant, and unknown addresses", async () => {
  for (const [authority, pathPrefix] of [
    ["retired.example.com", "/"],
    ["suspended.example.com", "/"],
    ["missing.example.com", "/"]
  ] as const) {
    await assert.rejects(
      resolveTenant(
        requireClient(),
        { externalAddress: { authority, pathPrefix } },
        workloadMetadata(requireKubernetes().callerToken)),
      hasStatus(status.NOT_FOUND));
  }
});

test("rejects missing, multiple, and malformed selectors", async () => {
  for (const request of createInvalidTenantSelectors()) {
    await assert.rejects(
      resolveTenant(
        requireClient(),
        request,
        workloadMetadata(requireKubernetes().callerToken)),
      hasStatus(status.INVALID_ARGUMENT));
  }
});

test("the migration preserves Tenant and address ownership", async () => {
  const connection = requireDatabase().connection;
  await assert.rejects(
    connection("tenants")
      .where({ tenant_id: "tenant_active" })
      .delete());
  await assert.rejects(
    connection("tenant_address_bindings")
      .where({ address_binding_id: "address_active_root" })
      .delete());
  await assert.rejects(
    connection("tenant_address_bindings")
      .where({ address_binding_id: "address_active_root" })
      .update({ tenant_id: "tenant_failed" }));
  await assert.rejects(
    connection("tenant_address_bindings")
      .where({ address_binding_id: "address_retired" })
      .update({ is_active: 1 }));
  await assert.rejects(
    insertAddressBinding(connection, {
      id: "address_overlap",
      tenantId: "tenant_active",
      authority: "tenant.example.com",
      pathPrefix: "/tenants/other"
    }));
});

test("requires one syntactically valid bearer workload token", async () => {
  const malformed = [
    new Metadata(),
    metadataWith("authorization", "Basic abc"),
    metadataWith("authorization", "Bearer "),
    metadataWith("authorization", "Bearer abc def")
  ];

  for (const metadata of malformed) {
    await assert.rejects(
      resolveTenant(
        requireClient(),
        { tenantId: "tenant_active" },
        metadata),
      hasStatus(status.UNAUTHENTICATED));
  }
});

test("validates workload audience, binding, expiry, and lifetime", async () => {
  const cluster = requireKubernetes();
  for (const token of [
    cluster.wrongAudienceToken,
    cluster.unboundToken,
    cluster.expiredToken,
    cluster.overlongToken,
    "abc.def.ghi"
  ]) {
    await assert.rejects(
      resolveTenant(
        requireClient(),
        { tenantId: "tenant_active" },
        workloadMetadata(token)),
      hasStatus(status.UNAUTHENTICATED));
  }
});

test("rejects an authenticated but unadmitted workload", async () => {
  await assert.rejects(
    resolveTenant(
      requireClient(),
      { tenantId: "tenant_active" },
      workloadMetadata(requireKubernetes().unadmittedToken)),
    hasStatus(status.PERMISSION_DENIED));
});

test("accepts valid Session and Run invocation identities", async () => {
  const authority = requireInvocation();
  const session = authority.sign({ tenantId: "tenant_active" });
  const sessionResponse = await resolveTenant(
    requireClient(),
    { tenantId: "tenant_active" },
    workloadMetadata(requireKubernetes().callerToken, session));
  assert.equal(sessionResponse.tenantId, "tenant_active");

  const run = authority.sign({
    tenantId: "tenant_active",
    subject: "service:automation",
    sessionId: null,
    runId: "run-review",
    actorSubject: "job:reviewer"
  });
  const runResponse = await resolveTenant(
    requireClient(),
    { tenantId: "tenant_active" },
    workloadMetadata(requireKubernetes().callerToken, run));
  assert.equal(runResponse.tenantId, "tenant_active");
});

test("applies the invocation Tenant fence as not found", async () => {
  const token = requireInvocation().sign({
    tenantId: "tenant_suspended"
  });
  await assert.rejects(
    resolveTenant(
      requireClient(),
      { tenantId: "tenant_active" },
      workloadMetadata(requireKubernetes().callerToken, token)),
    hasStatus(status.NOT_FOUND));
});

test("rejects invalid invocation signatures, time, authority, and context", async () => {
  for (const token of createInvalidInvocationTokens(requireInvocation())) {
    await assert.rejects(
      resolveTenant(
        requireClient(),
        { tenantId: "tenant_active" },
        workloadMetadata(requireKubernetes().callerToken, token)),
      hasStatus(status.UNAUTHENTICATED));
  }
});

test("enforces cache configuration and restarts the same native artifact", async () => {
  await assert.rejects(
    requireService().restart({ CTLFLOW_CACHE_TTL_SECONDS: "0" }));
  await assert.rejects(
    requireService().restart({ CTLFLOW_CACHE_TTL_SECONDS: "61" }));

  await requireService().restart({ CTLFLOW_CACHE_TTL_SECONDS: "1" });
  const oneSecond = await resolveTenant(
    requireClient(),
    { tenantId: "tenant_active" },
    workloadMetadata(requireKubernetes().callerToken));
  assertCacheLifetime(oneSecond.cacheExpiresAt, 1);

  await requireService().restart({ CTLFLOW_CACHE_TTL_SECONDS: "60" });
  const sixtySeconds = await resolveTenant(
    requireClient(),
    { tenantId: "tenant_active" },
    workloadMetadata(requireKubernetes().callerToken));
  assertCacheLifetime(sixtySeconds.cacheExpiresAt, 60);

  await requireService().restart({ CTLFLOW_CACHE_TTL_SECONDS: "30" });
});

test("separates gRPC and probe listeners", async () => {
  assert.equal(await probeStatus("/healthz"), 204);
  assert.equal(await probeStatus("/readyz"), 204);
  assert.equal(await probeStatus("/domain"), 404);

  let grpcProbeStatus: number | undefined;
  try {
    grpcProbeStatus = (await fetch(
      `http://127.0.0.1:${String(requireContext().grpcPort)}/healthz`,
      { signal: AbortSignal.timeout(1_000) })).status;
  } catch {
    grpcProbeStatus = undefined;
  }
  assert.notEqual(grpcProbeStatus, 204);
});

test("propagates deadline and cancellation", async () => {
  await assert.rejects(
    resolveTenant(
      requireClient(),
      { tenantId: "tenant_active" },
      workloadMetadata(requireKubernetes().callerToken),
      { deadline: Date.now() - 1 }),
    hasStatus(status.DEADLINE_EXCEEDED));

  await assert.rejects(
    cancelResolveTenant(),
    hasStatus(status.CANCELLED));
});

test("fails closed for every incompatible migration-ledger state", async () => {
  const connection = requireDatabase().connection;
  const migration = await connection<{
    id: number;
    name: string;
    batch: number;
    migration_time: number;
  }>("knex_migrations").first();
  assert.ok(migration);

  await assertSchemaUnavailable(
    async () => {
      await connection("knex_migrations_lock").update({ is_locked: 1 });
    },
    async () => {
      await connection("knex_migrations_lock").update({ is_locked: 0 });
    });
  await assertSchemaUnavailable(
    async () => {
      await connection("knex_migrations_lock").insert({
        index: 2,
        is_locked: 0
      });
    },
    async () => {
      await connection("knex_migrations_lock").where({ index: 2 }).delete();
    });
  await assertSchemaUnavailable(
    async () => {
      await connection("knex_migrations").where({ id: migration.id }).delete();
    },
    async () => {
      await connection("knex_migrations").insert(migration);
    });
  await assertSchemaUnavailable(
    async () => {
      await connection("knex_migrations").insert({
        name: "0002_unexpected.js",
        batch: 2,
        migration_time: Date.now()
      });
    },
    async () => {
      await connection("knex_migrations")
        .where({ name: "0002_unexpected.js" })
        .delete();
    });
  await assertSchemaUnavailable(
    async () => {
      await connection("knex_migrations").insert({
        id: 1_000_000,
        name: migration.name,
        batch: 2,
        migration_time: Date.now()
      });
    },
    async () => {
      await connection("knex_migrations")
        .where({ id: 1_000_000 })
        .delete();
    });
});

test("fails readiness when a mapped operation table is incompatible", async () => {
  const connection = requireDatabase().connection;
  await assertSchemaUnavailable(
    async () => {
      await connection.schema.renameTable("tenants", "tenants_unavailable");
    },
    async () => {
      await connection.schema.renameTable("tenants_unavailable", "tenants");
    });
});

test("exports bounded traces, metrics, and logs without request secrets", async () => {
  const traceId = "11111111111111111111111111111111";
  const invocationToken = requireInvocation().sign({
    tenantId: "tenant_active",
    tokenId: "telemetry-redaction"
  });
  const metadata = workloadMetadata(
    requireKubernetes().callerToken,
    invocationToken);
  metadata.set(
    "traceparent",
    `00-${traceId}-2222222222222222-01`);
  metadata.set("tracestate", "vendor=value");
  const response = await resolveTenant(
    requireClient(),
    { tenantId: "tenant_active" },
    metadata);
  assert.equal(response.tenantId, "tenant_active");

  await waitForExport(
    requireCollector().tracesPath,
    (value) =>
      value.includes(traceId)
      && value.includes("tenantd.ResolveTenant"));
  await waitForExport(
    requireCollector().metricsPath,
    (value) =>
      value.includes("ctlflow.tenantd.requests")
      && value.includes("ctlflow.tenantd.duration"));
  await waitForExport(
    requireCollector().logsPath,
    (value) => hasOperationLog(value, {
      operation: "ResolveTenant",
      outcome: "ok",
      traceId
    }));

  const tracesBefore = countOccurrences(
    await readFile(requireCollector().tracesPath, "utf8"),
    "\"name\":\"tenantd.ResolveTenant\"");
  const malformedParent = workloadMetadata(
    requireKubernetes().callerToken);
  malformedParent.set("traceparent", "not-a-traceparent");
  await resolveTenant(
    requireClient(),
    { tenantId: "tenant_active" },
    malformedParent);
  await waitForExport(
    requireCollector().tracesPath,
    (value) =>
      countOccurrences(
        value,
        "\"name\":\"tenantd.ResolveTenant\"") > tracesBefore);

  const exported = await readAllExports(requireCollector());
  for (const secret of [
    requireKubernetes().callerToken,
    invocationToken,
    "tenant_active",
    "user:alice"
  ]) {
    assert.equal(exported.includes(secret), false);
  }
});

test("Collector outage remains bounded and does not change the result", async () => {
  await requireCollector().suspend();
  try {
    const started = performance.now();
    const response = await resolveTenant(
      requireClient(),
      { tenantId: "tenant_active" },
      workloadMetadata(requireKubernetes().callerToken),
      { deadline: Date.now() + 2_000 });
    assert.equal(response.tenantId, "tenant_active");
    assert.ok(performance.now() - started < 1_800);
  } finally {
    await requireCollector().resume();
  }
});
});

function workloadMetadata(
  token: string,
  invocationToken?: string
): Metadata {
  const metadata = new Metadata();
  metadata.set("authorization", `Bearer ${token}`);
  if (invocationToken !== undefined) {
    metadata.set("ctlflow-invocation", `Bearer ${invocationToken}`);
  }
  return metadata;
}

function metadataWith(name: string, value: string): Metadata {
  const metadata = new Metadata();
  metadata.set(name, value);
  return metadata;
}

function assertCacheLifetime(
  expiresAt: Date | undefined,
  seconds: number
): void {
  assert.ok(expiresAt instanceof Date);
  const remaining = expiresAt.getTime() - Date.now();
  assert.ok(remaining > Math.max(0, seconds * 1_000 - 1_500));
  assert.ok(remaining <= seconds * 1_000 + 500);
}

function hasStatus(expected: status): (error: unknown) => boolean {
  return (error: unknown): boolean =>
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as ServiceError).code === expected;
}

async function probeStatus(path: string): Promise<number> {
  const response = await fetch(
    `http://127.0.0.1:${String(requireContext().probePort)}${path}`,
    { signal: AbortSignal.timeout(1_000) });
  await response.body?.cancel();
  return response.status;
}

async function cancelResolveTenant(): Promise<never> {
  return await new Promise<never>((_resolve, reject) => {
    const call = requireClient().resolveTenant(
      ResolveTenantRequest.create({ tenantId: "tenant_active" }),
      workloadMetadata(requireKubernetes().callerToken),
      (error) => {
        reject(error ?? new Error("Cancelled call returned no error"));
      });
    call.on("error", () => undefined);
    call.cancel();
  });
}

async function assertSchemaUnavailable(
  change: () => Promise<void>,
  restore: () => Promise<void>
): Promise<void> {
  await change();
  try {
    assert.equal(await probeStatus("/readyz"), 503);
    await assert.rejects(
      resolveTenant(
        requireClient(),
        { tenantId: "tenant_active" },
        workloadMetadata(requireKubernetes().callerToken)),
      hasStatus(status.UNAVAILABLE));
  } finally {
    await restore();
    await waitUntilReady();
  }
}

async function waitUntilReady(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await probeStatus("/readyz") === 204) {
      return;
    }
    await delay(25);
  }
  assert.fail("tenantd did not return to readiness");
}

function requireContext(): TenantdTestContext {
  assert.ok(context);
  return context;
}

function requireKubernetes(): TenantdTestContext["kubernetes"] {
  return requireContext().kubernetes;
}

function requireCollector(): TenantdTestContext["collector"] {
  return requireContext().collector;
}

function requireInvocation(): TenantdTestContext["invocation"] {
  return requireContext().invocation;
}

function requireDatabase(): TenantdTestContext["database"] {
  return requireContext().database;
}

function requireService(): TenantdTestContext["service"] {
  return requireContext().service;
}

function requireClient(): TenantdTestContext["client"] {
  return requireContext().client;
}
