import { readFile } from "node:fs/promises";
import type { OpenTelemetryCollector } from "@ctlflow/test-mesh";

export async function readAllExports(
  collector: OpenTelemetryCollector
): Promise<string> {
  return (await Promise.all([
    readFile(collector.tracesPath, "utf8"),
    readFile(collector.metricsPath, "utf8"),
    readFile(collector.logsPath, "utf8")
  ])).join("\n");
}
