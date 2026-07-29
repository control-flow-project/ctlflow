import {
  readFile
} from "node:fs/promises";
import type {
  OpenTelemetryCollector
} from "@ctlflow/test-mesh";

export async function readAllExports(
  collector: OpenTelemetryCollector
): Promise<string> {
  const traces = await readFile(collector.tracesPath, "utf8");
  const metrics = await readFile(collector.metricsPath, "utf8");
  const logs = await readFile(collector.logsPath, "utf8");
  return `${traces}\n${metrics}\n${logs}`;
}
