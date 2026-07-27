import {
  startAuditdTestSuite
} from "./start-auditd-test-suite.js";
import {
  createAuditdTestContext
} from "../support/create-auditd-test-context.js";
import {
  auditdTestContextState
} from "./auditd-test-context.js";
import {
  auditdTestSuiteState
} from "./auditd-test-suite.js";
import {
  stopAuditdTestSuite
} from "./stop-auditd-test-suite.js";

export async function globalSetup(): Promise<void> {
  if (auditdTestSuiteState.current !== undefined) {
    throw new Error("auditd test suite is already running");
  }

  auditdTestSuiteState.current = await startAuditdTestSuite();
  try {
    auditdTestContextState.current =
      await createAuditdTestContext();
  } catch (error) {
    const suite = auditdTestSuiteState.current;
    auditdTestSuiteState.current = undefined;
    await suite.stop().catch(() => undefined);
    throw error;
  }
}

export async function globalTeardown(): Promise<void> {
  await stopAuditdTestSuite();
}
