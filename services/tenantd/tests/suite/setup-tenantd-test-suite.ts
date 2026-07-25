import {
  startTenantdTestSuite
} from "./start-tenantd-test-suite.js";
import {
  tenantdTestSuiteState
} from "./tenantd-test-suite.js";

export async function globalSetup(): Promise<void> {
  if (tenantdTestSuiteState.current !== undefined) {
    throw new Error("tenantd test suite is already running");
  }

  tenantdTestSuiteState.current = await startTenantdTestSuite();
}

export async function globalTeardown(): Promise<void> {
  const suite = tenantdTestSuiteState.current;
  tenantdTestSuiteState.current = undefined;
  await suite?.stop();
}
