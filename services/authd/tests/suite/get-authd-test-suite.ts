import {
  authdTestSuiteState,
  type AuthdTestSuite
} from "./authd-test-suite.js";

export function getAuthdTestSuite(): AuthdTestSuite {
  if (authdTestSuiteState.current === undefined) {
    throw new Error("Authd test suite is not running");
  }
  return authdTestSuiteState.current;
}
