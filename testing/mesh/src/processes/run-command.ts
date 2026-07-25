import { spawn } from "node:child_process";
import type { CommandResult } from "./command-result.js";

const maximumOutputBytes = 1024 * 1024;

export interface RunCommandOptions {
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly input?: string;
}

export async function runCommand(
  command: string,
  arguments_: readonly string[],
  options: RunCommandOptions
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.environment
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;

    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes <= maximumOutputBytes) {
        stdout.push(chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes <= maximumOutputBytes) {
        stderr.push(chunk);
      }
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };

      if (code === 0) {
        resolve(result);
        return;
      }

      reject(
        new Error(
          `${command} exited with code ${String(code)} and signal ${String(signal)}\n`
          + `${result.stdout}${result.stderr}`));
    });

    child.stdin.end(options.input);
  });
}
