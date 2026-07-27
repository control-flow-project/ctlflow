import {
  auditdTestSuiteState,
  type AuditdTestSuite
} from "./auditd-test-suite.js";

export function getAuditdTestSuite(): AuditdTestSuite {
  if (auditdTestSuiteState.current === undefined) {
    throw new Error("auditd test suite has not been started");
  }

  return auditdTestSuiteState.current;
}
