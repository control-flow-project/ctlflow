import assert from "node:assert/strict";
import type {
  TenantdTestContext
} from "./create-tenantd-test-context.js";
import { createTenantBody } from "./create-tenant-body.js";
import {
  requestTenancyApi
} from "./request-tenancy-api.js";
import { requireTenantDocument } from "./require-tenant-document.js";
import type { TenantDocument } from "./tenant-document.js";

const basePath = "/apis/tenancy.ctlflow.com/v1alpha1";

export async function createTestTenant(
  context: TenantdTestContext,
  displayName: string,
  authority: string,
  idempotencyKey: string
): Promise<TenantDocument> {
  const response = await requestTenancyApi(context.kubernetesApi, {
    method: "POST",
    path: `${basePath}/tenants`,
    headers: { "Idempotency-Key": idempotencyKey },
    body: createTenantBody(displayName, authority)
  });
  assert.equal(
    response.statusCode,
    201,
    `${response.text}\n${context.service.diagnostics()}`);
  return requireTenantDocument(response);
}
