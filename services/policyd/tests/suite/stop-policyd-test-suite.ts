import {
  policydTestContextState
} from "./policyd-test-context.js";
import {
  policydTestSuiteState
} from "./policyd-test-suite.js";

export async function stopPolicydTestSuite(): Promise<void> {
  const context = policydTestContextState.current;
  policydTestContextState.current = undefined;
  const suite = policydTestSuiteState.current;
  policydTestSuiteState.current = undefined;
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
