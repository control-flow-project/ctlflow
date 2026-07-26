import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CSharpServicePublicationOptions
} from "../csharp-service-publication.js";
import { runCommand } from "../../../processes/run-command.js";
import { collectPublicationFiles } from
  "./collect-publication-files.js";
import { relativeRepositoryPath } from
  "./relative-repository-path.js";
import { resolveServiceRoot } from
  "./resolve-service-root.js";

export async function calculatePublicationFingerprint(
  options: CSharpServicePublicationOptions
): Promise<string> {
  const serviceRoot = resolveServiceRoot(options.projectPath);
  const roots = [
    path.join(options.repositoryRoot, "global.json"),
    path.join(options.repositoryRoot, "Directory.Build.props"),
    path.join(options.repositoryRoot, "Directory.Packages.props"),
    path.join(options.repositoryRoot, "tooling/native"),
    path.join(serviceRoot, "api"),
    path.join(serviceRoot, "schema-manifest.txt"),
    path.join(serviceRoot, "csharp/src"),
    path.join(serviceRoot, "csharp/Directory.Build.props"),
    path.join(serviceRoot, "csharp/Directory.Packages.props"),
    options.diagnosticsManifestPath,
    path.dirname(options.projectPath),
    options.projectPath
  ];
  const files = await collectPublicationFiles(roots);
  const dotnetVersion = (await runCommand(
    "dotnet",
    ["--version"],
    { cwd: options.repositoryRoot })).stdout.trim();
  const hash = createHash("sha256");

  hash.update("ctlflow-nativeaot-publication-v1\0");
  hash.update(`dotnet=${dotnetVersion}\0`);
  hash.update(`platform=${process.platform}\0`);
  hash.update(`arch=${process.arch}\0`);
  hash.update(`release=${os.release()}\0`);
  hash.update(`project=${relativeRepositoryPath(
    options.repositoryRoot,
    options.projectPath)}\0`);
  hash.update(`executable=${options.executableName}\0`);

  for (const file of files) {
    hash.update(`file=${relativeRepositoryPath(
      options.repositoryRoot,
      file)}\0`);
    hash.update(await readFile(file));
    hash.update("\0");
  }

  return hash.digest("hex");
}
