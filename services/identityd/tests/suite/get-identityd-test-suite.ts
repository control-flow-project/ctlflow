import {
  identitydTestSuiteState,
  type IdentitydTestSuite
} from "./identityd-test-suite.js";

export function getIdentitydTestSuite(): IdentitydTestSuite {
  if (identitydTestSuiteState.current === undefined) {
    throw new Error("identityd test suite has not been started");
  }

  return identitydTestSuiteState.current;
}
