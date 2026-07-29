import assert from "node:assert/strict";
import {
  setTimeout as delay
} from "node:timers/promises";

export async function waitFor(
  predicate: () => Promise<boolean>,
  message: string,
  timeoutMilliseconds = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await delay(20);
  }
  assert.fail(message);
}
