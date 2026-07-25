import assert from "node:assert/strict";
import type {
  TenantdTestContext
} from "./create-tenantd-test-context.js";
import {
  requestTenancyApi,
  type TenancyApiResponse
} from "./request-tenancy-api.js";

const basePath = "/apis/tenancy.ctlflow.com/v1alpha1";

export async function putLifecycleAction(
  context: TenantdTestContext,
  resourceKind: "tenants" | "workspaces",
  resourceId: string,
  action: "delete" | "resume" | "retry" | "suspend",
  resourceVersion: string,
  idempotencyKey: string
): Promise<TenancyApiResponse> {
  const response = await requestTenancyApi(context.kubernetesApi, {
    method: action === "delete" ? "DELETE" : "PUT",
    path: `${basePath}/${resourceKind}/${resourceId}`
      + (action === "delete" ? "" : `/${action}`),
    headers: { "Idempotency-Key": idempotencyKey },
    body: {
      apiVersion: "tenancy.ctlflow.com/v1alpha1",
      kind: "LifecycleAction",
      resourceVersion
    }
  });
  assert.notEqual(response.statusCode, 0);
  return response;
}
