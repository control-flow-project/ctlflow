import type { ManagedProcess } from "./managed-process.js";

const retryMilliseconds = 25;
const startupTimeoutMilliseconds = 15_000;
const requestTimeoutMilliseconds = 500;

export async function waitForReadiness(
  host: string,
  port: number,
  process_: ManagedProcess
): Promise<void> {
  const deadline = Date.now() + startupTimeoutMilliseconds;
  const endpoint = `http://${host}:${String(port)}/readyz`;

  while (Date.now() < deadline) {
    if (process_.child.exitCode !== null || process_.child.signalCode !== null) {
      throw new Error(
        `Service exited during startup\n${process_.diagnostics()}`);
    }

    if (await isReady(endpoint)) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, retryMilliseconds);
    });
  }

  throw new Error(
    `Service did not become ready at ${endpoint}\n${process_.diagnostics()}`);
}

async function isReady(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(requestTimeoutMilliseconds)
    });
    await response.body?.cancel();
    return response.status === 204;
  } catch {
    return false;
  }
}
