import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createTenantBody } from "../support/create-tenant-body.js";
import {
  createTenantdTestContext,
  type TenantdTestContext
} from "../support/create-tenantd-test-context.js";
import {
  requestAggregationApi
} from "../support/request-aggregation-api.js";

const basePath = "/apis/tenancy.ctlflow.com/v1alpha1";
let context: TenantdTestContext | undefined;

describe("Kubernetes aggregation boundary", { concurrency: false }, () => {
before(async () => {
  context = await createTenantdTestContext({
    seedResolutionData: false
  });
});

after(async () => {
  await context?.stop();
  context = undefined;
});

test("admits only the configured request-header proxy identity", async () => {
  const admitted = await requestAggregationApi(requireContext(), {
    method: "GET",
    path: basePath,
    operator: "operator@example.com"
  });
  assert.equal(admitted.statusCode, 200, admitted.text);

  const missingActor = await requestAggregationApi(requireContext(), {
    method: "GET",
    path: basePath
  });
  assertStatus(missingActor.body, 401, "Unauthorized");

  const invalidActor = await requestAggregationApi(requireContext(), {
    method: "GET",
    path: basePath,
    operator: "   "
  });
  assertStatus(invalidActor.body, 401, "Unauthorized");

  await assert.rejects(
    requestAggregationApi(requireContext(), {
      method: "GET",
      path: basePath,
      operator: "operator@example.com",
      clientIdentity: "unadmitted"
    }));
  await assert.rejects(
    requestAggregationApi(requireContext(), {
      method: "GET",
      path: basePath,
      operator: "operator@example.com",
      clientIdentity: "none"
    }));
});

test("keeps aggregation and probe routes on separate listeners", async () => {
  const aggregationProbe = await requestAggregationApi(requireContext(), {
    method: "GET",
    path: "/healthz",
    operator: "operator@example.com"
  });
  assert.equal(aggregationProbe.statusCode, 404);

  const probeAggregation = await fetch(
    `http://127.0.0.1:${String(requireContext().probePort)}${basePath}`);
  assert.equal(probeAggregation.status, 404);
});

test("requires JSON and rejects fixed or chunked oversized bodies", async () => {
  const unsupported = await requestAggregationApi(requireContext(), {
    method: "POST",
    path: `${basePath}/tenants`,
    operator: "operator@example.com",
    contentType: "text/plain",
    body: Buffer.from("{}", "utf8")
  });
  assertStatus(unsupported.body, 415, "Invalid");

  const oversized = Buffer.alloc((256 * 1024) + 1, 0x20);
  const fixed = await requestAggregationApi(requireContext(), {
    method: "POST",
    path: `${basePath}/tenants`,
    operator: "operator@example.com",
    body: oversized
  });
  assertStatus(fixed.body, 413, "Invalid");

  const chunked = await requestAggregationApi(requireContext(), {
    method: "POST",
    path: `${basePath}/tenants`,
    operator: "operator@example.com",
    body: oversized,
    chunked: true
  });
  assertStatus(chunked.body, 413, "Invalid");
});

test("accepts a bounded JSON document with media-type parameters", async () => {
  const body = Buffer.from(JSON.stringify(createTenantBody(
    "Direct Aggregation Tenant",
    "direct-aggregation.example.com")), "utf8");
  const response = await requestAggregationApi(requireContext(), {
    method: "POST",
    path: `${basePath}/tenants`,
    operator: "operator@example.com",
    idempotencyKey: "direct-aggregation-create",
    contentType: "application/json; charset=utf-8",
    body
  });
  assert.equal(response.statusCode, 201, response.text);
  assert.match(
    String(response.headers["content-type"]),
    /^application\/json\b/u);
});
});

function requireContext(): TenantdTestContext {
  assert.ok(context);
  return context;
}

function assertStatus(
  value: unknown,
  code: number,
  reason: string
): void {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  const status = value as {
    readonly kind?: unknown;
    readonly code?: unknown;
    readonly reason?: unknown;
  };
  assert.equal(status.kind, "Status");
  assert.equal(status.code, code);
  assert.equal(status.reason, reason);
}
