import type { ManagedProcess } from "./managed-process.js";

const gracefulStopMilliseconds = 250;
const forcedStopMilliseconds = 2_000;

export async function stopProcess(process_: ManagedProcess): Promise<void> {
  const child = process_.child;
  if (hasExited(child)) {
    return;
  }

  child.ref();
  setStreamReference(child.stdout, true);
  setStreamReference(child.stderr, true);
  try {
    const gracefulExit = waitForExit(
      child,
      gracefulStopMilliseconds);
    child.kill("SIGTERM");
    if (await gracefulExit) {
      return;
    }

    const forcedExit = waitForExit(child, forcedStopMilliseconds);
    if (!hasExited(child)) {
      child.kill("SIGKILL");
    }
    if (!await forcedExit) {
      throw new Error(
        `Process ${String(child.pid)} did not stop after SIGKILL`);
    }
  } finally {
    child.unref();
    setStreamReference(child.stdout, false);
    setStreamReference(child.stderr, false);
  }
}

function waitForExit(
  child: ManagedProcess["child"],
  timeoutMilliseconds: number
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(exited);
    };
    const onExit = (): void => finish(true);
    const timer = setTimeout(
      () => finish(hasExited(child)),
      timeoutMilliseconds);
    child.once("exit", onExit);
    if (hasExited(child)) {
      finish(true);
    }
  });
}

function hasExited(child: ManagedProcess["child"]): boolean {
  return child.exitCode !== null || child.signalCode !== null;
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
