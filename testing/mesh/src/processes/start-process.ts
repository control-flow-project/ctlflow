import { spawn } from "node:child_process";
import type { ManagedProcess } from "./managed-process.js";

const maximumDiagnosticBytes = 1024 * 1024;

export interface StartProcessOptions {
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
}

export function startProcess(
  command: string,
  arguments_: readonly string[],
  options: StartProcessOptions
): ManagedProcess {
  const child = spawn(command, arguments_, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.environment
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const chunks: Buffer[] = [];
  let bytes = 0;

  const capture = (chunk: Buffer): void => {
    if (process.env.CTLFLOW_TEST_ECHO_PROCESS_OUTPUT === "1") {
      process.stderr.write(chunk);
    }

    chunks.push(chunk);
    bytes += chunk.byteLength;

    while (bytes > maximumDiagnosticBytes && chunks.length > 0) {
      const removed = chunks.shift();
      bytes -= removed?.byteLength ?? 0;
    }
  };

  child.stdout.on("data", capture);
  child.stderr.on("data", capture);

  return {
    child,
    diagnostics: () => Buffer.concat(chunks).toString("utf8")
  };
}
