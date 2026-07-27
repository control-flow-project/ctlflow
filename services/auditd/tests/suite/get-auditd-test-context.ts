import {
  auditdTestContextState
} from "./auditd-test-context.js";
import type {
  AuditdTestContext
} from "../support/create-auditd-test-context.js";

export function getAuditdTestContext(): AuditdTestContext {
  if (auditdTestContextState.current === undefined) {
    throw new Error("auditd test context has not been started");
  }

  return auditdTestContextState.current;
}
