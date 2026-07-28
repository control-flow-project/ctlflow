import {
  pkgdTestContextState
} from "./pkgd-test-context.js";
import {
  pkgdTestSuiteState
} from "./pkgd-test-suite.js";

export async function stopPkgdTestSuite(): Promise<void> {
  const context = pkgdTestContextState.current;
  pkgdTestContextState.current = undefined;
  const suite = pkgdTestSuiteState.current;
  pkgdTestSuiteState.current = undefined;
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
