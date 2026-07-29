import {
  execdTestSuiteState,
  type ExecdTestSuite
} from "./execd-test-suite.js";

export function getExecdTestSuite(): ExecdTestSuite {
  if (execdTestSuiteState.current === undefined) {
    throw new Error("execd test suite has not been started");
  }
  return execdTestSuiteState.current;
}
