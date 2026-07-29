import {
  egressdTestSuiteState
} from "./egressd-test-suite.js";
import {
  startEgressdTestSuite
} from "./start-egressd-test-suite.js";
import {
  stopEgressdTestSuite
} from "./stop-egressd-test-suite.js";

export async function globalSetup(): Promise<void> {
  if (egressdTestSuiteState.current !== undefined) {
    throw new Error("Egressd test suite is already running");
  }
  egressdTestSuiteState.current = await startEgressdTestSuite();
}

export async function globalTeardown(): Promise<void> {
  await stopEgressdTestSuite();
}
