import type { ManagedProcess } from "./managed-process.js";

const gracefulStopMilliseconds = 5_000;

export async function stopProcess(process_: ManagedProcess): Promise<void> {
  if (process_.child.exitCode !== null || process_.child.signalCode !== null) {
    return;
  }

  process_.child.ref();
  setStreamReference(process_.child.stdout, true);
  setStreamReference(process_.child.stderr, true);
  process_.child.kill("SIGTERM");

  const stopped = await Promise.race([
    new Promise<boolean>((resolve) => {
      process_.child.once("exit", () => resolve(true));
    }),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), gracefulStopMilliseconds);
    })
  ]);

  if (!stopped && process_.child.exitCode === null) {
    process_.child.kill("SIGKILL");
    await new Promise<void>((resolve) => {
      process_.child.once("exit", () => resolve());
    });
  }
}

function setStreamReference(
  stream: NodeJS.ReadableStream | null,
  referenced: boolean
): void {
  const referenceable = stream as (NodeJS.ReadableStream & {
    ref?: () => void;
    unref?: () => void;
  }) | null;
  if (referenced) {
    referenceable?.ref?.();
  } else {
    referenceable?.unref?.();
  }
}
