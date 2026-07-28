import {
  configdTestSuiteState,
  type ConfigdTestSuite
} from "./configd-test-suite.js";

export function getConfigdTestSuite(): ConfigdTestSuite {
  if (configdTestSuiteState.current === undefined) {
    throw new Error("configd test suite has not been started");
  }

  return configdTestSuiteState.current;
}
