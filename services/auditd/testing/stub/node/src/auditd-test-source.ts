import type {
  IdentitySessionAuditEventEvidence,
  TenancyAuditEventEvidence
} from "./audit-event-evidence.js";
import type { AuditdMode } from "./auditd-mode.js";

export interface AuditdTestSource {
  readonly sourceId: string;
  readonly setMode: (mode: AuditdMode) => Promise<void>;
  readonly readTenancyEvents: () =>
    Promise<readonly TenancyAuditEventEvidence[]>;
  readonly readIdentitySessionEvents: () =>
    Promise<readonly IdentitySessionAuditEventEvidence[]>;
  readonly stop: () => Promise<void>;
}
