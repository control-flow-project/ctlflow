import {
  AuditEvent,
  type DeepPartial
} from "../../generated/v1/auditd.js";
import {
  operatorAttribution
} from "./operator-attribution.js";
import {
  tenantPartition
} from "./tenant-partition.js";

let eventSequence = 1n;

export function createAuditEvent(
  detail: DeepPartial<AuditEvent>,
  override: DeepPartial<AuditEvent> = {}
): AuditEvent {
  const sequence = eventSequence++;
  return AuditEvent.create({
    sourceEventId:
      `evt_${sequence.toString(16).padStart(32, "0")}`,
    occurredAt: new Date("2026-07-27T00:00:00.123Z"),
    attribution: operatorAttribution(),
    partition: tenantPartition(),
    traceId: sequence.toString(16).padStart(32, "0"),
    spanId: sequence.toString(16).padStart(16, "0"),
    ...detail,
    ...override
  });
}
