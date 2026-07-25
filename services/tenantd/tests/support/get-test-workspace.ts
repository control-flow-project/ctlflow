import assert from "node:assert/strict";
import type {
  TenantdTestContext
} from "./create-tenantd-test-context.js";
import {
  requestTenancyApi
} from "./request-tenancy-api.js";
import {
  requireWorkspaceDocument
} from "./require-workspace-document.js";
import type { WorkspaceDocument } from "./workspace-document.js";

const basePath = "/apis/tenancy.ctlflow.com/v1alpha1";

export async function getTestWorkspace(
  context: TenantdTestContext,
  workspaceId: string
): Promise<WorkspaceDocument> {
  const response = await requestTenancyApi(context.kubernetesApi, {
    method: "GET",
    path: `${basePath}/workspaces/${workspaceId}`
  });
  assert.equal(response.statusCode, 200, response.text);
  return requireWorkspaceDocument(response);
}
