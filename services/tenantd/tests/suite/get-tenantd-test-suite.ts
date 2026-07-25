import {
  tenantdTestSuiteState,
  type TenantdTestSuite
} from "./tenantd-test-suite.js";

export function getTenantdTestSuite(): TenantdTestSuite {
  if (tenantdTestSuiteState.current === undefined) {
    throw new Error("tenantd test suite has not been started");
  }

  return tenantdTestSuiteState.current;
}
