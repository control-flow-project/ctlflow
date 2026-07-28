import {
  startPkgdTestSuite
} from "./start-pkgd-test-suite.js";
import {
  createPkgdTestContext
} from "../support/create-pkgd-test-context.js";
import {
  pkgdTestContextState
} from "./pkgd-test-context.js";
import {
  pkgdTestSuiteState
} from "./pkgd-test-suite.js";
import {
  stopPkgdTestSuite
} from "./stop-pkgd-test-suite.js";

export async function globalSetup(): Promise<void> {
  if (pkgdTestSuiteState.current !== undefined) {
    throw new Error("pkgd test suite is already running");
  }

  pkgdTestSuiteState.current = await startPkgdTestSuite();
  try {
    pkgdTestContextState.current =
      await createPkgdTestContext();
  } catch (error) {
    const suite = pkgdTestSuiteState.current;
    pkgdTestSuiteState.current = undefined;
    await suite.stop().catch(() => undefined);
    throw error;
  }
}

export async function globalTeardown(): Promise<void> {
  await stopPkgdTestSuite();
}
