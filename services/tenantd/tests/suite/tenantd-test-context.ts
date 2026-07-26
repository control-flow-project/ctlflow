import type {
  TenantdTestContext
} from "../support/create-tenantd-test-context.js";

export const tenantdTestContextState: {
  current: TenantdTestContext | undefined;
} = {
  current: undefined
};
