import {
  authdTestSuiteState
} from "./authd-test-suite.js";
import {
  startAuthdTestSuite
} from "./start-authd-test-suite.js";
import {
  stopAuthdTestSuite
} from "./stop-authd-test-suite.js";

export async function globalSetup(): Promise<void> {
  if (authdTestSuiteState.current !== undefined) {
    throw new Error("Authd test suite is already running");
  }
  authdTestSuiteState.current = await startAuthdTestSuite();
}

export async function globalTeardown(): Promise<void> {
  await stopAuthdTestSuite();
}
