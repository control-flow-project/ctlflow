import {
  pkgdTestSuiteState,
  type PkgdTestSuite
} from "./pkgd-test-suite.js";

export function getPkgdTestSuite(): PkgdTestSuite {
  if (pkgdTestSuiteState.current === undefined) {
    throw new Error("pkgd test suite has not been started");
  }

  return pkgdTestSuiteState.current;
}
