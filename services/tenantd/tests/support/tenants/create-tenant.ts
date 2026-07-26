import type {
  CreateTenantRequest,
  Tenant
} from "../../generated/v1/tenantd.js";
import type {
  TenantdTestContext
} from "../create-tenantd-test-context.js";
import { callUnary } from "../call-unary.js";

export async function createTenant(
  context: TenantdTestContext,
  request: CreateTenantRequest
): Promise<Tenant> {
  return await callUnary<Tenant>((done) =>
    context.client.createTenant(
      request,
      done));
}
