import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type { TestDatabase } from "./test-database.js";

export async function waitForAuditOutboxCount(
  database: TestDatabase,
  expectedCount: number
): Promise<void> {
  const deadline = Date.now() + 5_000;
  let actualCount = -1;
  while (Date.now() < deadline) {
    actualCount = await readCount(database);
    if (actualCount === expectedCount) {
      return;
    }

    await delay(20);
  }

  assert.fail(
    `Expected ${String(expectedCount)} audit outbox rows, `
    + `received ${String(actualCount)}`);
}

async function readCount(database: TestDatabase): Promise<number> {
  const row = await database.connection("audit_outbox")
    .count({ count: "*" })
    .first() as { readonly count?: number | string } | undefined;
  return Number(row?.count ?? 0);
}
