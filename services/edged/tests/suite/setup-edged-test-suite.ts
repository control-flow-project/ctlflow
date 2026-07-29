import {
  edgedTestSuiteState
} from "./edged-test-suite.js";
import {
  startEdgedTestSuite
} from "./start-edged-test-suite.js";
import {
  stopEdgedTestSuite
} from "./stop-edged-test-suite.js";

export async function globalSetup(): Promise<void> {
  if (edgedTestSuiteState.current !== undefined) {
    throw new Error("Edged test suite is already running");
  }
  edgedTestSuiteState.current = await startEdgedTestSuite();
}

export async function globalTeardown(): Promise<void> {
  await stopEdgedTestSuite();
}
