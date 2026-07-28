import {
  policydTestSuiteState,
  type PolicydTestSuite
} from "./policyd-test-suite.js";

export function getPolicydTestSuite(): PolicydTestSuite {
  if (policydTestSuiteState.current === undefined) {
    throw new Error("policyd test suite has not been started");
  }
  return policydTestSuiteState.current;
}
