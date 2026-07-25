import assert from "node:assert/strict";
import type {
  TenantdTestContext
} from "./create-tenantd-test-context.js";
import {
  createWorkspaceBody
} from "./create-workspace-body.js";
import {
  requestTenancyApi
} from "./request-tenancy-api.js";
import {
  requireWorkspaceDocument
} from "./require-workspace-document.js";
import type { WorkspaceDocument } from "./workspace-document.js";

const basePath = "/apis/tenancy.ctlflow.com/v1alpha1";

export async function createTestWorkspace(
  context: TenantdTestContext,
  tenantId: string,
  displayName: string,
  workspaceAddress: string,
  idempotencyKey: string
): Promise<WorkspaceDocument> {
  const response = await requestTenancyApi(context.kubernetesApi, {
    method: "POST",
    path: `${basePath}/workspaces`,
    headers: { "Idempotency-Key": idempotencyKey },
    body: createWorkspaceBody(tenantId, displayName, workspaceAddress)
  });
  assert.equal(
    response.statusCode,
    201,
    `${response.text}\n${context.service.diagnostics()}`);
  return requireWorkspaceDocument(response);
}
