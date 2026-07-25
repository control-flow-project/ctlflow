import {
  chmod,
  mkdtemp,
  mkdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type {
  OpenTelemetryCollector
} from "./open-telemetry-collector.js";
import { findAvailablePort } from "../ports/find-available-port.js";
import { runCommand } from "../processes/run-command.js";

const image =
  "otel/opentelemetry-collector-contrib:0.135.0";

export async function startOpenTelemetryCollector(
  repositoryRoot: string
): Promise<OpenTelemetryCollector> {
  const root = path.join(
    repositoryRoot,
    ".temp",
    "test-mesh",
    "otel");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(
    path.join(root, "session-"));
  const outputDirectory = path.join(directory, "output");
  const configPath = path.join(directory, "collector.yaml");
  const tracesPath = path.join(outputDirectory, "traces.json");
  const metricsPath = path.join(outputDirectory, "metrics.json");
  const logsPath = path.join(outputDirectory, "logs.json");
  const port = await findAvailablePort();
  const name = `ctlflow-otel-${process.pid.toString(36)}-${Date.now().toString(36)}`;

  await mkdir(outputDirectory);
  await chmod(outputDirectory, 0o777);
  await writeFile(tracesPath, "", "utf8");
  await writeFile(metricsPath, "", "utf8");
  await writeFile(logsPath, "", "utf8");
  await chmod(tracesPath, 0o666);
  await chmod(metricsPath, 0o666);
  await chmod(logsPath, 0o666);
  await writeFile(configPath, createConfiguration(), "utf8");

  try {
    await runCommand(
      "docker",
      [
        "run",
        "--detach",
        "--rm",
        "--name",
        name,
        "--publish",
        `127.0.0.1:${String(port)}:4318`,
        "--volume",
        `${configPath}:/etc/otelcol-contrib/config.yaml:ro`,
        "--volume",
        `${outputDirectory}:/output`,
        process.env.CTLFLOW_OTEL_COLLECTOR_IMAGE ?? image
      ],
      { cwd: repositoryRoot });
    await waitForOtlpEndpoint(port);

    let stopped = false;
    let suspended = false;
    return {
      endpoint: `http://127.0.0.1:${String(port)}`,
      tracesPath,
      metricsPath,
      logsPath,
      clearExports: async () => {
        requireRunning(stopped);
        await writeFile(tracesPath, "", "utf8");
        await writeFile(metricsPath, "", "utf8");
        await writeFile(logsPath, "", "utf8");
      },
      suspend: async () => {
        requireRunning(stopped);
        if (suspended) {
          return;
        }

        await runCommand(
          "docker",
          ["pause", name],
          { cwd: repositoryRoot });
        suspended = true;
      },
      resume: async () => {
        requireRunning(stopped);
        if (!suspended) {
          return;
        }

        await runCommand(
          "docker",
          ["unpause", name],
          { cwd: repositoryRoot });
        suspended = false;
        await waitForOtlpEndpoint(port);
      },
      stop: async () => {
        if (stopped) {
          return;
        }

        stopped = true;
        if (suspended) {
          await runCommand(
            "docker",
            ["unpause", name],
            { cwd: repositoryRoot });
          suspended = false;
        }
        await runCommand(
          "docker",
          ["stop", "--timeout", "5", name],
          { cwd: repositoryRoot });
      }
    };
  } catch (error) {
    await runCommand(
      "docker",
      ["rm", "--force", name],
      { cwd: repositoryRoot }).catch(() => undefined);
    throw error;
  }
}

function requireRunning(stopped: boolean): void {
  if (stopped) {
    throw new Error("OpenTelemetry Collector is stopped");
  }
}

async function waitForOtlpEndpoint(port: number): Promise<void> {
  const endpoint = `http://127.0.0.1:${String(port)}/v1/traces`;
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: "{\"resourceSpans\":[]}",
        signal: AbortSignal.timeout(1_000)
      });
      if (response.ok) {
        return;
      }
    } catch {
      // The container can accept TCP before the OTLP receiver is ready.
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error(`OpenTelemetry Collector did not become ready at ${endpoint}`);
}

function createConfiguration(): string {
  return `receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
exporters:
  file/traces:
    path: /output/traces.json
  file/metrics:
    path: /output/metrics.json
  file/logs:
    path: /output/logs.json
service:
  telemetry:
    logs:
      level: error
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [file/traces]
    metrics:
      receivers: [otlp]
      exporters: [file/metrics]
    logs:
      receivers: [otlp]
      exporters: [file/logs]
`;
}
