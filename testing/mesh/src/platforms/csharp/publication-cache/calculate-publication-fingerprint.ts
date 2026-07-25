import { createHash } from "node:crypto";
import {
  readdir,
  readFile,
  stat
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CSharpServicePublicationOptions
} from "../csharp-service-publication.js";
import { runCommand } from "../../../processes/run-command.js";

const ignoredDirectories = new Set(["bin", "obj"]);

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
  const files = await collectExistingFiles(roots);
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
  hash.update(`project=${relativePath(options.repositoryRoot, options.projectPath)}\0`);
  hash.update(`executable=${options.executableName}\0`);

  for (const file of files) {
    hash.update(`file=${relativePath(options.repositoryRoot, file)}\0`);
    hash.update(await readFile(file));
    hash.update("\0");
  }

  return hash.digest("hex");
}

async function collectExistingFiles(
  roots: readonly string[]
): Promise<readonly string[]> {
  const files = new Set<string>();

  for (const root of roots) {
    const rootStat = await stat(root).catch(() => undefined);
    if (rootStat === undefined) {
      continue;
    }

    if (rootStat.isFile()) {
      files.add(path.resolve(root));
      continue;
    }

    if (rootStat.isDirectory()) {
      for (const file of await collectDirectoryFiles(root)) {
        files.add(file);
      }
    }
  }

  return [...files].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0);
}

async function collectDirectoryFiles(
  directory: string
): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectDirectoryFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(path.resolve(entryPath));
    }
  }

  return files;
}

function resolveServiceRoot(projectPath: string): string {
  const marker = `${path.sep}csharp${path.sep}`;
  const markerIndex = projectPath.lastIndexOf(marker);
  if (markerIndex <= 0) {
    throw new Error("C# project path must belong to a service csharp directory");
  }

  return projectPath.slice(0, markerIndex);
}

function relativePath(repositoryRoot: string, filePath: string): string {
  const relative = path.relative(repositoryRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Publication input must be inside the repository");
  }

  return relative.split(path.sep).join("/");
}
