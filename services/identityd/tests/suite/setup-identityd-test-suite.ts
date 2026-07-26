import {
  startIdentitydTestSuite
} from "./start-identityd-test-suite.js";
import {
  createIdentitydTestContext
} from "../support/create-identityd-test-context.js";
import {
  identitydTestContextState
} from "./identityd-test-context.js";
import {
  identitydTestSuiteState
} from "./identityd-test-suite.js";
import {
  stopIdentitydTestSuite
} from "./stop-identityd-test-suite.js";

export async function globalSetup(): Promise<void> {
  if (identitydTestSuiteState.current !== undefined) {
    throw new Error("identityd test suite is already running");
  }

  identitydTestSuiteState.current = await startIdentitydTestSuite();
  try {
    identitydTestContextState.current =
      await createIdentitydTestContext();
  } catch (error) {
    const suite = identitydTestSuiteState.current;
    identitydTestSuiteState.current = undefined;
    await suite.stop().catch(() => undefined);
    throw error;
  }
}

export async function globalTeardown(): Promise<void> {
  await stopIdentitydTestSuite();
}
