import {
  configdPaths,
  execdPaths,
  pkgdPaths
} from "../support/test-paths.js";
import {
  loadServiceTestRuntime
} from "./load-service-test-runtime.js";
import type {
  ExecdTestRuntimes,
  ServiceTestRuntime
} from "./service-test-runtime.js";

export async function loadExecdTestRuntimes():
Promise<ExecdTestRuntimes> {
  const loaded: ServiceTestRuntime[] = [];
  try {
    const pkgd = await loadServiceTestRuntime("pkgd", pkgdPaths);
    loaded.push(pkgd);
    const configd = await loadServiceTestRuntime(
      "configd",
      configdPaths);
    loaded.push(configd);
    const execd = await loadServiceTestRuntime("execd", execdPaths);
    loaded.push(execd);

    let stopped = false;
    return {
      pkgd,
      configd,
      execd,
      stop: async () => {
        if (stopped) {
          return;
        }
        stopped = true;
        await stopRuntimes(loaded);
      }
    };
  } catch (error) {
    await stopRuntimes(loaded).catch(() => undefined);
    throw error;
  }
}

async function stopRuntimes(
  runtimes: readonly ServiceTestRuntime[]
): Promise<void> {
  let failure: unknown;
  for (const runtime of [...runtimes].reverse()) {
    try {
      await runtime.stop();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) {
    throw failure;
  }
}
