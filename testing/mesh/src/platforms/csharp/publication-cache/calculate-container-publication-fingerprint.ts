import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  CSharpContainerServicePublicationOptions
} from "../csharp-service-publication.js";
import { collectPublicationFiles } from
  "./collect-publication-files.js";
import { relativeRepositoryPath } from
  "./relative-repository-path.js";
import { resolveServiceRoot } from
  "./resolve-service-root.js";

export async function calculateContainerPublicationFingerprint(
  options: CSharpContainerServicePublicationOptions
): Promise<string> {
  const serviceRoot = resolveServiceRoot(options.projectPath);
  const files = await collectPublicationFiles([
    path.join(options.repositoryRoot, "global.json"),
    path.join(options.repositoryRoot, "Directory.Build.props"),
    path.join(options.repositoryRoot, "Directory.Packages.props"),
    path.join(options.repositoryRoot, ".nvmrc"),
    path.join(options.repositoryRoot, "tooling/native"),
    path.join(serviceRoot, "api"),
    path.join(serviceRoot, "schema-manifest.txt"),
    path.join(serviceRoot, "csharp/src"),
    path.join(serviceRoot, "csharp/Directory.Build.props"),
    path.join(serviceRoot, "csharp/Directory.Packages.props"),
    options.diagnosticsManifestPath,
    options.containerfilePath,
    path.dirname(options.projectPath),
    options.projectPath
  ]);
  const hash = createHash("sha256");
  hash.update("ctlflow-container-nativeaot-publication-v1\0");
  hash.update(`platform=${process.platform}\0`);
  hash.update(`arch=${process.arch}\0`);
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
