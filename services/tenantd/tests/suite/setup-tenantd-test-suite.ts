import {
  startTenantdTestSuite
} from "./start-tenantd-test-suite.js";
import {
  createTenantdTestContext
} from "../support/create-tenantd-test-context.js";
import {
  tenantdTestContextState
} from "./tenantd-test-context.js";
import {
  tenantdTestSuiteState
} from "./tenantd-test-suite.js";
import {
  stopTenantdTestSuite
} from "./stop-tenantd-test-suite.js";

export async function globalSetup(): Promise<void> {
  if (tenantdTestSuiteState.current !== undefined) {
    throw new Error("tenantd test suite is already running");
  }

  tenantdTestSuiteState.current = await startTenantdTestSuite();
  try {
    tenantdTestContextState.current =
      await createTenantdTestContext();
  } catch (error) {
    const suite = tenantdTestSuiteState.current;
    tenantdTestSuiteState.current = undefined;
    await suite.stop().catch(() => undefined);
    throw error;
  }
}

export async function globalTeardown(): Promise<void> {
  await stopTenantdTestSuite();
}
