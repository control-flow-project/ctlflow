import {
  createPolicydTestContext
} from "../support/create-policyd-test-context.js";
import {
  policydTestContextState
} from "./policyd-test-context.js";
import {
  startPolicydTestSuite
} from "./start-policyd-test-suite.js";
import {
  policydTestSuiteState
} from "./policyd-test-suite.js";
import {
  stopPolicydTestSuite
} from "./stop-policyd-test-suite.js";

export async function globalSetup(): Promise<void> {
  if (policydTestSuiteState.current !== undefined) {
    throw new Error("policyd test suite is already running");
  }
  policydTestSuiteState.current = await startPolicydTestSuite();
  try {
    policydTestContextState.current =
      await createPolicydTestContext();
  } catch (error) {
    await stopPolicydTestSuite().catch(() => undefined);
    throw error;
  }
}

export async function globalTeardown(): Promise<void> {
  await stopPolicydTestSuite();
}
