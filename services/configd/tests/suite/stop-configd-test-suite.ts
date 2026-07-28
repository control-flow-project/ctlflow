import {
  configdTestContextState
} from "./configd-test-context.js";
import {
  cleanupProjectionOwners
} from "../support/kubernetes/cleanup-projection-owners.js";
import {
  configdTestSuiteState
} from "./configd-test-suite.js";

export async function stopConfigdTestSuite(): Promise<void> {
  const context = configdTestContextState.current;
  configdTestContextState.current = undefined;
  const suite = configdTestSuiteState.current;
  configdTestSuiteState.current = undefined;
  let failure: unknown;
  try {
    await context?.stop();
  } catch (error) {
    failure = error;
  }
  if (suite !== undefined) {
    try {
      await cleanupProjectionOwners(suite.kubernetes);
    } catch (error) {
      failure ??= error;
    }
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
