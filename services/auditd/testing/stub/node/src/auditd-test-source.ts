import type { AuditEventEvidence } from "./audit-event-evidence.js";
import type { AuditdMode } from "./auditd-mode.js";

export interface AuditdTestSource {
  readonly sourceId: string;
  readonly setMode: (mode: AuditdMode) => Promise<void>;
  readonly readEvents: () => Promise<readonly AuditEventEvidence[]>;
  readonly stop: () => Promise<void>;
}
