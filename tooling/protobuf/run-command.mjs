import { spawn } from "node:child_process";

export async function runCommand(
  command,
  arguments_,
  { cwd, description }
) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      stdio: "inherit"
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(
        `${description} failed with code ${String(code)} `
        + `and signal ${String(signal)}`));
    });
  });
}
