import {
  createExecdTestContext
} from "../support/create-execd-test-context.js";
import {
  execdTestContextState
} from "./execd-test-context.js";
import {
  execdTestSuiteState
} from "./execd-test-suite.js";
import {
  startExecdTestSuite
} from "./start-execd-test-suite.js";
import {
  stopExecdTestSuite
} from "./stop-execd-test-suite.js";

export async function globalSetup(): Promise<void> {
  if (execdTestSuiteState.current !== undefined) {
    throw new Error("execd test suite is already running");
  }
  execdTestSuiteState.current = await startExecdTestSuite();
  try {
    execdTestContextState.current =
      await createExecdTestContext();
  } catch (error) {
    const suite = execdTestSuiteState.current;
    execdTestSuiteState.current = undefined;
    await suite.stop().catch(() => undefined);
    throw error;
  }
}

export async function globalTeardown(): Promise<void> {
  await stopExecdTestSuite();
}
