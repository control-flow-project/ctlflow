import {
  cleanupExecdKubernetesResources
} from "./cleanup-execd-kubernetes-resources.js";
import {
  execdTestContextState
} from "./execd-test-context.js";
import {
  execdTestSuiteState
} from "./execd-test-suite.js";

export async function stopExecdTestSuite(): Promise<void> {
  const context = execdTestContextState.current;
  execdTestContextState.current = undefined;
  const suite = execdTestSuiteState.current;
  execdTestSuiteState.current = undefined;
  let failure: unknown;

  try {
    await context?.stop();
  } catch (error) {
    failure = error;
  }
  try {
    if (suite !== undefined) {
      await cleanupExecdKubernetesResources(suite.kubernetes);
    }
  } catch (error) {
    failure ??= error;
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
