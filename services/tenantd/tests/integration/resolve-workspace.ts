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
  ResolveWorkspaceRequest
} from "../generated/v1/tenantd.js";
import {
  createInvalidInvocationTokens
} from "../support/create-invalid-invocation-tokens.js";
import {
  createInvalidWorkspaceRequests
} from "../support/create-invalid-workspace-requests.js";
import {
  createTenantdTestContext,
  type TenantdTestContext
} from "../support/create-tenantd-test-context.js";
import {
  insertWorkspaceAddressBinding
} from "../support/insert-workspace-address-binding.js";
import { resolveWorkspace } from "../support/resolve-workspace.js";
import {
  countOccurrences
} from "../support/telemetry/count-occurrences.js";
import {
  findSpansForTrace
} from "../support/telemetry/find-spans-for-trace.js";
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

describe("ResolveWorkspace", { concurrency: false }, () => {
before(async () => {
  context = await createTenantdTestContext();
});

after(async () => {
  await context?.stop();
  context = undefined;
});

test("resolves an active Workspace inside its Tenant", async () => {
  const workspace = requireContext().activeWorkspace;
  const response = await resolveWorkspace(
    requireClient(),
    { tenantId: workspace.tenantId, workspaceAddress: workspace.address },
    workloadMetadata(requireKubernetes().callerToken));

  assert.equal(response.workspaceId, workspace.id);
  assert.equal(response.lifecycle, workspace.lifecycle);
  assert.equal(response.workspaceRevision, BigInt(workspace.revision));
  assert.equal(response.address?.bindingGeneration, BigInt(workspace.generation));
  assertCacheLifetime(response.cacheExpiresAt, 30);
});

test("hides suspended, retired, inactive-Tenant, and unknown Workspaces", async () => {
  for (const [tenantId, workspaceAddress] of [
    ["tenant_active", "beta"],
    ["tenant_active", "gamma"],
    ["tenant_suspended", "delta"],
    ["tenant_active", "zeta"],
    ["tenant_deleted", "alpha"]
  ] as const) {
    await assert.rejects(
      resolveWorkspace(
        requireClient(),
        { tenantId, workspaceAddress },
        workloadMetadata(requireKubernetes().callerToken)),
      hasStatus(status.NOT_FOUND));
  }
});

test("rejects missing and malformed Workspace lookups", async () => {
  for (const request of createInvalidWorkspaceRequests()) {
    await assert.rejects(
      resolveWorkspace(
        requireClient(),
        request,
        workloadMetadata(requireKubernetes().callerToken)),
      hasStatus(status.INVALID_ARGUMENT));
  }
});

test("the migration preserves Workspace and address ownership", async () => {
  const workspace = requireContext().activeWorkspace;
  const connection = requireDatabase().connection;
  await assert.rejects(
    connection("workspaces")
      .where({ workspace_id: workspace.id })
      .delete());
  await assert.rejects(
    connection("workspaces")
      .where({ workspace_id: workspace.id })
      .update({ tenant_id: "tenant_suspended" }));
  await assert.rejects(
    connection("workspaces")
      .where({ workspace_id: workspace.id })
      .update({ workspace_id: "workspace_renamed" }));
  await assert.rejects(
    connection("workspace_address_bindings")
      .where({ address_binding_id: "workspace_binding_alpha" })
      .delete());
  await assert.rejects(
    connection("workspace_address_bindings")
      .where({ address_binding_id: "workspace_binding_alpha" })
      .update({ workspace_id: "workspace_suspended" }));
  await assert.rejects(
    connection("workspace_address_bindings")
      .where({ address_binding_id: "workspace_binding_gamma" })
      .update({ is_active: 1 }));
  await assert.rejects(
    insertWorkspaceAddressBinding(connection, {
      id: "workspace_binding_overlap",
      tenantId: workspace.tenantId,
      workspaceId: "workspace_suspended",
      workspaceAddress: workspace.address
    }));
});

test("rejects a Workspace address binding that crosses Tenants", async () => {
  // workspace_in_suspended_tenant belongs to tenant_suspended, so a binding
  // that claims tenant_active must be rejected before it can ever resolve.
  await assert.rejects(
    insertWorkspaceAddressBinding(requireDatabase().connection, {
      id: "workspace_binding_cross_tenant",
      tenantId: "tenant_active",
      workspaceId: "workspace_in_suspended_tenant",
      workspaceAddress: "crosstenant"
    }));
});

test("an already-corrupt stored binding still does not resolve across Tenants", async () => {
  const connection = requireDatabase().connection;
  // Bypass the write-time guard to plant a row that claims tenant_active but
  // points at tenant_second's active Workspace. The query fence must still
  // refuse it, proving defense-in-depth independent of the trigger.
  await connection.raw("DROP TRIGGER workspace_address_binding_tenant_matches");
  try {
    await insertWorkspaceAddressBinding(connection, {
      id: "workspace_binding_corrupt",
      tenantId: "tenant_active",
      workspaceId: "workspace_second",
      workspaceAddress: "corruptaddr"
    });
    await assert.rejects(
      resolveWorkspace(
        requireClient(),
        { tenantId: "tenant_active", workspaceAddress: "corruptaddr" },
        workloadMetadata(requireKubernetes().callerToken)),
      hasStatus(status.NOT_FOUND));
  } finally {
    await connection.raw(`
      CREATE TRIGGER workspace_address_binding_tenant_matches
      BEFORE INSERT ON workspace_address_bindings
      WHEN NEW.tenant_id <> (
        SELECT tenant_id FROM workspaces WHERE workspace_id = NEW.workspace_id
      )
      BEGIN
        SELECT RAISE(ABORT,
          'Workspace address binding Tenant must own the Workspace');
      END
    `);
  }
});

test("fails closed when a mapped Workspace table is incompatible", async () => {
  const workspace = requireContext().activeWorkspace;
  const connection = requireDatabase().connection;
  await connection.schema.renameTable("workspaces", "workspaces_unavailable");
  try {
    assert.equal(await probeStatus("/readyz"), 503);
    await assert.rejects(
      resolveWorkspace(
        requireClient(),
        { tenantId: workspace.tenantId, workspaceAddress: workspace.address },
        workloadMetadata(requireKubernetes().callerToken)),
      hasStatus(status.UNAVAILABLE));
  } finally {
    await connection.schema.renameTable("workspaces_unavailable", "workspaces");
    await waitUntilReady();
  }
});

test("requires one syntactically valid bearer workload token", async () => {
  const workspace = requireContext().activeWorkspace;
  const malformed = [
    new Metadata(),
    metadataWith("authorization", "Basic abc"),
    metadataWith("authorization", "Bearer "),
    metadataWith("authorization", "Bearer abc def")
  ];

  for (const metadata of malformed) {
    await assert.rejects(
      resolveWorkspace(
        requireClient(),
        { tenantId: workspace.tenantId, workspaceAddress: workspace.address },
        metadata),
      hasStatus(status.UNAUTHENTICATED));
  }
});

test("validates workload audience, binding, expiry, and lifetime", async () => {
  const workspace = requireContext().activeWorkspace;
  const cluster = requireKubernetes();
  for (const token of [
    cluster.wrongAudienceToken,
    cluster.unboundToken,
    cluster.expiredToken,
    cluster.overlongToken,
    "abc.def.ghi"
  ]) {
    await assert.rejects(
      resolveWorkspace(
        requireClient(),
        { tenantId: workspace.tenantId, workspaceAddress: workspace.address },
        workloadMetadata(token)),
      hasStatus(status.UNAUTHENTICATED));
  }
});

test("rejects an authenticated but unadmitted workload", async () => {
  const workspace = requireContext().activeWorkspace;
  await assert.rejects(
    resolveWorkspace(
      requireClient(),
      { tenantId: workspace.tenantId, workspaceAddress: workspace.address },
      workloadMetadata(requireKubernetes().unadmittedToken)),
    hasStatus(status.PERMISSION_DENIED));
});

test("accepts a matching invocation and fences a foreign Tenant", async () => {
  const workspace = requireContext().activeWorkspace;
  const authority = requireInvocation();

  const matching = authority.sign({ tenantId: workspace.tenantId });
  const response = await resolveWorkspace(
    requireClient(),
    { tenantId: workspace.tenantId, workspaceAddress: workspace.address },
    workloadMetadata(requireKubernetes().callerToken, matching));
  assert.equal(response.workspaceId, workspace.id);

  const foreign = authority.sign({ tenantId: "tenant_suspended" });
  await assert.rejects(
    resolveWorkspace(
      requireClient(),
      { tenantId: workspace.tenantId, workspaceAddress: workspace.address },
      workloadMetadata(requireKubernetes().callerToken, foreign)),
    hasStatus(status.NOT_FOUND));
});

test("honors matching and foreign invocation Workspace scope", async () => {
  const workspace = requireContext().activeWorkspace;
  const authority = requireInvocation();

  const matching = authority.sign({
    tenantId: workspace.tenantId,
    workspaceId: workspace.id
  });
  const response = await resolveWorkspace(
    requireClient(),
    { tenantId: workspace.tenantId, workspaceAddress: workspace.address },
    workloadMetadata(requireKubernetes().callerToken, matching));
  assert.equal(response.workspaceId, workspace.id);

  // A credential scoped to a sibling Workspace in the same Tenant cannot
  // resolve this Workspace.
  const foreignWorkspace = authority.sign({
    tenantId: workspace.tenantId,
    workspaceId: "workspace_suspended"
  });
  await assert.rejects(
    resolveWorkspace(
      requireClient(),
      { tenantId: workspace.tenantId, workspaceAddress: workspace.address },
      workloadMetadata(requireKubernetes().callerToken, foreignWorkspace)),
    hasStatus(status.NOT_FOUND));
});

test("rejects invalid invocation signatures, time, authority, and context", async () => {
  const workspace = requireContext().activeWorkspace;
  for (const token of createInvalidInvocationTokens(requireInvocation())) {
    await assert.rejects(
      resolveWorkspace(
        requireClient(),
        { tenantId: workspace.tenantId, workspaceAddress: workspace.address },
        workloadMetadata(requireKubernetes().callerToken, token)),
      hasStatus(status.UNAUTHENTICATED));
  }
});

test("propagates deadline and cancellation", async () => {
  const workspace = requireContext().activeWorkspace;
  await assert.rejects(
    resolveWorkspace(
      requireClient(),
      { tenantId: workspace.tenantId, workspaceAddress: workspace.address },
      workloadMetadata(requireKubernetes().callerToken),
      { deadline: Date.now() - 1 }),
    hasStatus(status.DEADLINE_EXCEEDED));

  await assert.rejects(
    cancelResolveWorkspace(),
    hasStatus(status.CANCELLED));
});

test("records a cancellation outcome when the operation is aborted mid-query", async () => {
  const workspace = requireContext().activeWorkspace;
  const connection = requireDatabase().connection;

  // Hold an exclusive lock so the server's first query blocks; cancel the
  // in-flight call so the server's cancellation branch runs; then release. This
  // proves the handler executed the cancellation path, not just that the client
  // gave up.
  await connection.raw("BEGIN EXCLUSIVE");
  try {
    await assert.rejects(
      new Promise<never>((_resolve, reject) => {
        const call = requireClient().resolveWorkspace(
          ResolveWorkspaceRequest.create({
            tenantId: workspace.tenantId,
            workspaceAddress: workspace.address
          }),
          workloadMetadata(requireKubernetes().callerToken),
          (error) => {
            reject(error ?? new Error("Cancelled call returned no error"));
          });
        call.on("error", () => undefined);
        setTimeout(() => call.cancel(), 750);
      }),
      hasStatus(status.CANCELLED));
  } finally {
    await connection.raw("ROLLBACK");
  }

  await waitForExport(
    requireCollector().logsPath,
    (value) => hasOperationLog(value, { outcome: "cancelled" }));
});

test("exports bounded ResolveWorkspace traces, metrics, and logs without request data", async () => {
  const workspace = requireContext().activeWorkspace;
  const traceId = "33333333333333333333333333333333";
  const invocationToken = requireInvocation().sign({
    tenantId: workspace.tenantId,
    tokenId: "workspace-telemetry"
  });
  const metadata = workloadMetadata(
    requireKubernetes().callerToken,
    invocationToken);
  metadata.set("traceparent", `00-${traceId}-4444444444444444-01`);
  metadata.set("tracestate", "vendor=value");
  const response = await resolveWorkspace(
    requireClient(),
    { tenantId: workspace.tenantId, workspaceAddress: workspace.address },
    metadata);
  assert.equal(response.workspaceId, workspace.id);

  await waitForExport(
    requireCollector().tracesPath,
    (value) =>
      value.includes(traceId)
      && value.includes("tenantd.ResolveWorkspace"));
  await waitForExport(
    requireCollector().metricsPath,
    (value) =>
      value.includes("ctlflow.tenantd.requests")
      && value.includes("ctlflow.tenantd.duration"));
  await waitForExport(
    requireCollector().logsPath,
    (value) => hasOperationLog(value, {
      operation: "ResolveWorkspace",
      outcome: "ok",
      traceId
    }));

  const tracesBefore = countOccurrences(
    await readFile(requireCollector().tracesPath, "utf8"),
    "\"name\":\"tenantd.ResolveWorkspace\"");
  const malformedParent = workloadMetadata(requireKubernetes().callerToken);
  malformedParent.set("traceparent", "not-a-traceparent");
  await resolveWorkspace(
    requireClient(),
    { tenantId: workspace.tenantId, workspaceAddress: workspace.address },
    malformedParent);
  await waitForExport(
    requireCollector().tracesPath,
    (value) =>
      countOccurrences(
        value,
        "\"name\":\"tenantd.ResolveWorkspace\"") > tracesBefore);

  const exported = await readAllExports(requireCollector());
  for (const value of [
    requireKubernetes().callerToken,
    invocationToken,
    workspace.tenantId,
    workspace.address,
    workspace.id
  ]) {
    assert.equal(exported.includes(value), false);
  }
});

test("correlates structured logs with the request trace", async () => {
  const workspace = requireContext().activeWorkspace;
  const traceId = "55555555555555555555555555555555";
  const metadata = workloadMetadata(requireKubernetes().callerToken);
  metadata.set("traceparent", `00-${traceId}-6666666666666666-01`);
  await resolveWorkspace(
    requireClient(),
    { tenantId: workspace.tenantId, workspaceAddress: workspace.address },
    metadata);

  // The completion body and the request trace id must appear in the SAME log
  // record, not merely somewhere in the file.
  await waitForExport(
    requireCollector().logsPath,
    (value) => hasOperationLog(value, {
      operation: "ResolveWorkspace",
      outcome: "ok",
      traceId
    }));
});

test("nests the DB span under the ResolveWorkspace server span in one trace", async () => {
  const workspace = requireContext().activeWorkspace;
  const traceId = "77777777777777777777777777777777";
  const metadata = workloadMetadata(requireKubernetes().callerToken);
  metadata.set("traceparent", `00-${traceId}-8888888888888888-01`);
  await resolveWorkspace(
    requireClient(),
    { tenantId: workspace.tenantId, workspaceAddress: workspace.address },
    metadata);

  await waitForExport(
    requireCollector().tracesPath,
    (value) => {
      const spans = findSpansForTrace(value, traceId);
      const server = spans.find(
        (span) => span.name === "tenantd.ResolveWorkspace");
      const db = spans.find(
        (span) => span.name === "tenantd.db.resolve_workspace");
      return server !== undefined
        && db !== undefined
        && typeof server.spanId === "string"
        && db.parentSpanId === server.spanId;
    });
});

test("Collector outage remains bounded and does not change the result", async () => {
  const workspace = requireContext().activeWorkspace;
  await requireCollector().suspend();
  try {
    const started = performance.now();
    const response = await resolveWorkspace(
      requireClient(),
      { tenantId: workspace.tenantId, workspaceAddress: workspace.address },
      workloadMetadata(requireKubernetes().callerToken),
      { deadline: Date.now() + 2_000 });
    assert.equal(response.workspaceId, workspace.id);
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

async function cancelResolveWorkspace(): Promise<never> {
  const workspace = requireContext().activeWorkspace;
  return await new Promise<never>((_resolve, reject) => {
    const call = requireClient().resolveWorkspace(
      ResolveWorkspaceRequest.create({
        tenantId: workspace.tenantId,
        workspaceAddress: workspace.address
      }),
      workloadMetadata(requireKubernetes().callerToken),
      (error) => {
        reject(error ?? new Error("Cancelled call returned no error"));
      });
    call.on("error", () => undefined);
    call.cancel();
  });
}

async function probeStatus(path: string): Promise<number> {
  const response = await fetch(
    `http://127.0.0.1:${String(requireContext().probePort)}${path}`,
    { signal: AbortSignal.timeout(1_000) });
  await response.body?.cancel();
  return response.status;
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

function requireClient(): TenantdTestContext["client"] {
  return requireContext().client;
}
