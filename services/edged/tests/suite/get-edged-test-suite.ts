import {
  edgedTestSuiteState,
  type EdgedTestSuite
} from "./edged-test-suite.js";

export function getEdgedTestSuite(): EdgedTestSuite {
  if (edgedTestSuiteState.current === undefined) {
    throw new Error("Edged test suite is not running");
  }
  return edgedTestSuiteState.current;
}
