import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCommand } from "./run-command.mjs";

const generationTemplate = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "buf.gen.yaml");

export async function generateTypescript({
  repositoryRoot,
  protoRoots,
  outputDirectory
}) {
  if (!Array.isArray(protoRoots) || protoRoots.length === 0) {
    throw new TypeError("protoRoots must contain at least one protobuf root");
  }

  const buf = path.join(repositoryRoot, "node_modules/.bin/buf");

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  for (const protoRoot of protoRoots) {
    await runCommand(
      buf,
      [
        "generate",
        protoRoot,
        "--template",
        generationTemplate,
        "--output",
        outputDirectory
      ],
      {
        cwd: repositoryRoot,
        description: `TypeScript protobuf generation for ${protoRoot}`
      });
  }
}
