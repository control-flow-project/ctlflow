import {
  edgedTestSuiteState
} from "./edged-test-suite.js";

export async function stopEdgedTestSuite(): Promise<void> {
  const suite = edgedTestSuiteState.current;
  edgedTestSuiteState.current = undefined;
  await suite?.stop();
}
