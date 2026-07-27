import {
  auditdTestContextState
} from "./auditd-test-context.js";
import {
  auditdTestSuiteState
} from "./auditd-test-suite.js";

export async function stopAuditdTestSuite(): Promise<void> {
  const context = auditdTestContextState.current;
  const suite = auditdTestSuiteState.current;
  auditdTestContextState.current = undefined;
  auditdTestSuiteState.current = undefined;

  let failure: unknown;
  try {
    await context?.stop();
  } catch (error) {
    failure = error;
  }
  try {
    await suite?.stop();
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) {
    throw failure;
  }
}
