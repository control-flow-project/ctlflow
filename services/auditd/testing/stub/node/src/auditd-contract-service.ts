import type { AuditdTestSource } from "./auditd-test-source.js";

export interface AuditdContractService {
  readonly endpoint: string;
  readonly certificateAuthorityPath: string;
  readonly serverName: string;
  readonly createSource: (
    callerSubject: string
  ) => Promise<AuditdTestSource>;
  readonly stop: () => Promise<void>;
}
