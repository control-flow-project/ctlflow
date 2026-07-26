import { createHash } from "node:crypto";
import {
  readFile,
  readdir,
  stat
} from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../../processes/run-command.js";
import type {
  NodeTestImageOptions
} from "./node-test-image.js";

export async function buildNodeTestImage(
  options: NodeTestImageOptions
): Promise<string> {
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(options.imageName)) {
    throw new Error("Node test image name is invalid");
  }

  const fingerprint = await calculateFingerprint(options);
  const image = `ctlflow-test-${options.imageName}:${fingerprint}`;
  if (!await imageExists(options.repositoryRoot, image)) {
    await runCommand(
      "docker",
      [
        "build",
        "--network=host",
        "--file",
        options.containerfilePath,
        "--tag",
        image,
        options.repositoryRoot
      ],
      { cwd: options.repositoryRoot });
  }

  await options.kubernetes.loadImage(image);
  return image;
}

async function calculateFingerprint(
  options: NodeTestImageOptions
): Promise<string> {
  const files: string[] = [];
  for (const sourcePath of [
    options.containerfilePath,
    path.join(options.repositoryRoot, ".dockerignore"),
    path.join(options.repositoryRoot, "package.json"),
    path.join(options.repositoryRoot, "package-lock.json"),
    path.join(options.repositoryRoot, "tsconfig.base.json"),
    ...options.sourcePaths
  ]) {
    await collectFiles(sourcePath, files);
  }

  files.sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(path.relative(options.repositoryRoot, file));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function collectFiles(
  sourcePath: string,
  files: string[]
): Promise<void> {
  const details = await stat(sourcePath);
  if (details.isFile()) {
    files.push(sourcePath);
    return;
  }
  if (!details.isDirectory()) {
    throw new Error(`Node test image source is unsupported: ${sourcePath}`);
  }

  for (const entry of await readdir(sourcePath, { withFileTypes: true })) {
    if (entry.name === ".generated"
        || entry.name === "node_modules"
        || entry.name === "dist") {
      continue;
    }
    await collectFiles(path.join(sourcePath, entry.name), files);
  }
}

async function imageExists(
  repositoryRoot: string,
  image: string
): Promise<boolean> {
  return await runCommand(
    "docker",
    ["image", "inspect", image],
    { cwd: repositoryRoot })
    .then(() => true)
    .catch(() => false);
}
