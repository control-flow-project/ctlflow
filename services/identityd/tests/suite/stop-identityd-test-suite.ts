import {
  identitydTestContextState
} from "./identityd-test-context.js";
import {
  identitydTestSuiteState
} from "./identityd-test-suite.js";

export async function stopIdentitydTestSuite(): Promise<void> {
  const context = identitydTestContextState.current;
  identitydTestContextState.current = undefined;
  const suite = identitydTestSuiteState.current;
  identitydTestSuiteState.current = undefined;
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
