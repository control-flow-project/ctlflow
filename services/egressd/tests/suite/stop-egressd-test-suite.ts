import {
  egressdTestSuiteState
} from "./egressd-test-suite.js";

export async function stopEgressdTestSuite(): Promise<void> {
  const suite = egressdTestSuiteState.current;
  egressdTestSuiteState.current = undefined;
  await suite?.stop();
}
