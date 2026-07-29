import {
  egressdTestSuiteState,
  type EgressdTestSuite
} from "./egressd-test-suite.js";

export function getEgressdTestSuite(): EgressdTestSuite {
  return egressdTestSuiteState.current
    ?? (() => {
      throw new Error("Egressd test suite is not running");
    })();
}
