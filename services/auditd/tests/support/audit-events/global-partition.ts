import type {
  AuditPartition
} from "../../generated/v1/auditd.js";

export function globalPartition(): AuditPartition {
  return { global: {} };
}
