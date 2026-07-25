import assert from "node:assert/strict";
import type {
  TenantdTestContext
} from "./create-tenantd-test-context.js";
import {
  requestTenancyApi
} from "./request-tenancy-api.js";
import { requireTenantDocument } from "./require-tenant-document.js";
import type { TenantDocument } from "./tenant-document.js";

const basePath = "/apis/tenancy.ctlflow.com/v1alpha1";

export async function getTestTenant(
  context: TenantdTestContext,
  tenantId: string
): Promise<TenantDocument> {
  const response = await requestTenancyApi(context.kubernetesApi, {
    method: "GET",
    path: `${basePath}/tenants/${tenantId}`
  });
  assert.equal(response.statusCode, 200, response.text);
  return requireTenantDocument(response);
}
