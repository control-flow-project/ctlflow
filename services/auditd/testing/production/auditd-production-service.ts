import type {
  AuditdProductionSource
} from "./auditd-production-source.js";

export interface AuditdProductionService {
  readonly endpoint: string;
  readonly certificateAuthorityPath: string;
  readonly serverName: string;
  readonly createSource: (
    callerSubject: string
  ) => Promise<AuditdProductionSource>;
  readonly stop: () => Promise<void>;
}
