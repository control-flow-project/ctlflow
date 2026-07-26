import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { readProbeStatus } from "./read-probe-status.js";

export async function waitForProbeStatus(
  probePort: number,
  expectedStatus: number
): Promise<void> {
  const deadline = Date.now() + 5_000;
  let actualStatus = 0;
  while (Date.now() < deadline) {
    actualStatus = await readProbeStatus(probePort);
    if (actualStatus === expectedStatus) {
      return;
    }

    await delay(20);
  }

  assert.fail(
    `Expected probe status ${String(expectedStatus)}, `
    + `received ${String(actualStatus)}`);
}
