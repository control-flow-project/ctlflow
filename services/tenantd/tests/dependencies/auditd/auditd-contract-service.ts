import type { AuditdTestSource } from "./auditd-test-source.js";

export interface AuditdContractService {
  readonly endpoint: string;
  readonly createSource: () => Promise<AuditdTestSource>;
  readonly stop: () => Promise<void>;
}
