import {
  authdTestSuiteState
} from "./authd-test-suite.js";

export async function stopAuthdTestSuite(): Promise<void> {
  const suite = authdTestSuiteState.current;
  if (suite === undefined) {
    return;
  }
  authdTestSuiteState.current = undefined;
  await suite.stop();
}
