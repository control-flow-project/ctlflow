import assert from "node:assert/strict";
import {
  readFile
} from "node:fs/promises";
import {
  setTimeout as delay
} from "node:timers/promises";

export async function waitForExport(
  path: string,
  predicate: (value: string) => boolean
): Promise<void> {
  // Collector batching plus a loaded single-node cluster can exceed a
  // ten-second window; the assertion is unchanged, only its patience.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await readFile(path, "utf8");
    if (predicate(value)) {
      return;
    }
    await delay(50);
  }
  assert.fail(`Expected telemetry was not exported to ${path}`);
}
