import { access } from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../processes/run-command.js";
import type { TestToolchain } from "./test-toolchain.js";

export async function resolveMinikube(
  repositoryRoot: string,
  toolchain: TestToolchain
): Promise<string> {
  const configured = process.env.CTLFLOW_MINIKUBE_PATH;
  const candidates = [
    ...(configured === undefined ? [] : [configured]),
    path.join(repositoryRoot, ".temp/tools/minikube"),
    "minikube"
  ];

  for (const candidate of candidates) {
    if (
      candidate.includes(path.sep)
      && !await exists(candidate)
    ) {
      continue;
    }

    const version = await runCommand(
      candidate,
      ["version", "--short"],
      { cwd: repositoryRoot })
      .then((result) => result.stdout.trim())
      .catch(() => undefined);
    if (version === toolchain.minikube.version) {
      return candidate;
    }
  }

  throw new Error(
    `Minikube ${toolchain.minikube.version} is required; `
    + "run npm run setup:minikube");
}

async function exists(filePath: string): Promise<boolean> {
  return await access(filePath)
    .then(() => true)
    .catch(() => false);
}
