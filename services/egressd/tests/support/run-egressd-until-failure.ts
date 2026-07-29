import {
  spawn
} from "node:child_process";

const maximumOutputBytes = 64 * 1024;

export async function runEgressdUntilFailure(
  executablePath: string,
  environment: Readonly<Record<string, string>>
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], {
      env: {
        ...process.env,
        ...environment
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const output: Buffer[] = [];
    let outputBytes = 0;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(
        "Invalid Egressd configuration did not fail within five seconds"));
    }, 5_000);
    const capture = (chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes <= maximumOutputBytes) {
        output.push(chunk);
      }
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        reject(new Error("Invalid Egressd configuration was accepted"));
        return;
      }
      resolve(Buffer.concat(output).toString("utf8"));
    });
  });
}
