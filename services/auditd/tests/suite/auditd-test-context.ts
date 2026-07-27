import type {
  AuditdTestContext
} from "../support/create-auditd-test-context.js";

export const auditdTestContextState: {
  current: AuditdTestContext | undefined;
} = {
  current: undefined
};
