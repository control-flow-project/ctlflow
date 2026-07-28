import {
  createConfigdTestContext
} from "../support/create-configd-test-context.js";
import {
  configdTestContextState
} from "./configd-test-context.js";
import {
  configdTestSuiteState
} from "./configd-test-suite.js";
import {
  startConfigdTestSuite
} from "./start-configd-test-suite.js";
import {
  stopConfigdTestSuite
} from "./stop-configd-test-suite.js";

export async function globalSetup(): Promise<void> {
  if (configdTestSuiteState.current !== undefined) {
    throw new Error("configd test suite is already running");
  }

  configdTestSuiteState.current = await startConfigdTestSuite();
  try {
    configdTestContextState.current =
      await createConfigdTestContext();
  } catch (error) {
    const suite = configdTestSuiteState.current;
    configdTestSuiteState.current = undefined;
    await suite.stop().catch(() => undefined);
    throw error;
  }
}

export async function globalTeardown(): Promise<void> {
  await stopConfigdTestSuite();
}
