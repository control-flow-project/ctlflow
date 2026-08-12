import {
  readFile
} from "node:fs/promises";
import {
  setTimeout as delay
} from "node:timers/promises";

const defaultTimeoutMilliseconds = 30_000;

export async function waitForTelemetryExport(
  path: string,
  predicate: (value: string) => boolean,
  timeoutMilliseconds = defaultTimeoutMilliseconds
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastValue = "";
  while (Date.now() < deadline) {
    lastValue = await readFile(path, "utf8");
    if (predicate(lastValue)) {
      return;
    }
    await delay(50);
  }

  throw new Error(
    `Expected telemetry was not exported to ${path}; `
      + `last export size was ${String(Buffer.byteLength(lastValue))} bytes`);
}
