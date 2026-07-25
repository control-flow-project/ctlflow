import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type {
  AuditEventEvidence
} from "../dependencies/auditd/audit-event-evidence.js";
import type {
  AuditdTestSource
} from "../dependencies/auditd/auditd-test-source.js";

export async function waitForAuditEvents(
  auditd: AuditdTestSource,
  expectedCount: number
): Promise<readonly AuditEventEvidence[]> {
  const deadline = Date.now() + 5_000;
  let events: readonly AuditEventEvidence[] = [];
  while (Date.now() < deadline) {
    events = await auditd.readEvents();
    if (events.length >= expectedCount) {
      return events;
    }

    await delay(20);
  }

  assert.fail(
    `Expected at least ${String(expectedCount)} audit events, `
    + `received ${String(events.length)}`);
}
