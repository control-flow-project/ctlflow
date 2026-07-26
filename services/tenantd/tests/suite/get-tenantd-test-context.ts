import {
  tenantdTestContextState
} from "./tenantd-test-context.js";
import type {
  TenantdTestContext
} from "../support/create-tenantd-test-context.js";

export function getTenantdTestContext(): TenantdTestContext {
  if (tenantdTestContextState.current === undefined) {
    throw new Error("tenantd test context has not been started");
  }

  return tenantdTestContextState.current;
}
