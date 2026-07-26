import {
  tenantdTestContextState
} from "./tenantd-test-context.js";
import {
  tenantdTestSuiteState
} from "./tenantd-test-suite.js";

export async function stopTenantdTestSuite(): Promise<void> {
  const context = tenantdTestContextState.current;
  tenantdTestContextState.current = undefined;
  const suite = tenantdTestSuiteState.current;
  tenantdTestSuiteState.current = undefined;
  let failure: unknown;
  try {
    await context?.stop();
  } catch (error) {
    failure = error;
  }
  try {
    await suite?.stop();
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) {
    throw failure;
  }
}
