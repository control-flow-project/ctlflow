import type {
  CreateWorkspaceRequest,
  Workspace
} from "../../generated/v1/tenantd.js";
import type {
  TenantdTestContext
} from "../create-tenantd-test-context.js";
import { callUnary } from "../call-unary.js";

export async function createWorkspace(
  context: TenantdTestContext,
  request: CreateWorkspaceRequest
): Promise<Workspace> {
  return await callUnary<Workspace>((done) =>
    context.client.createWorkspace(
      request,
      done));
}
