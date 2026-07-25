import {
  mkdir,
  mkdtemp,
  rename,
  stat
} from "node:fs/promises";
import path from "node:path";
import type {
  CSharpServicePublication,
  CSharpServicePublicationOptions
} from "./csharp-service-publication.js";
import { calculatePublicationFingerprint } from
  "./publication-cache/calculate-publication-fingerprint.js";
import { resolvePublicationCachePaths } from
  "./publication-cache/resolve-publication-cache-paths.js";
import { validatePublicationCache } from
  "./publication-cache/validate-publication-cache.js";
import { writePublicationCacheManifest } from
  "./publication-cache/write-publication-cache-manifest.js";
import { runCommand } from "../../processes/run-command.js";

export async function publishCSharpService(
  options: CSharpServicePublicationOptions
): Promise<CSharpServicePublication> {
  const fingerprint = await calculatePublicationFingerprint(options);
  const cache = resolvePublicationCachePaths(options, fingerprint);
  await mkdir(cache.root, { recursive: true });

  if (await validatePublicationCache(
      cache.directory,
      fingerprint,
      options.executableName)) {
    return createPublication(cache.directory, options.executableName, true);
  }

  if (await pathExists(cache.directory)) {
    await rename(
      cache.directory,
      `${cache.directory}.invalid-${Date.now().toString(36)}`);
  }

  const staging = await mkdtemp(
    path.join(cache.root, `${fingerprint}.staging-`));

  // The repository owns one gated NativeAOT publisher; canonical tests and
  // container release both use this command.
  await runCommand(
    "node",
    [
      path.join(
        options.repositoryRoot,
        "tooling/native/gated-publish.mjs"),
      options.projectPath,
      options.diagnosticsManifestPath,
      staging
    ],
    { cwd: options.repositoryRoot });
  await writePublicationCacheManifest(
    staging,
    fingerprint,
    options.executableName);
  await rename(staging, cache.directory);

  if (!await validatePublicationCache(
      cache.directory,
      fingerprint,
      options.executableName)) {
    throw new Error("Published NativeAOT cache failed validation");
  }

  return createPublication(cache.directory, options.executableName, false);
}

function createPublication(
  directory: string,
  executableName: string,
  cacheHit: boolean
): CSharpServicePublication {
  return {
    directoryPath: directory,
    executablePath: path.join(directory, executableName),
    cacheHit,
    stop: () => Promise.resolve()
  };
}

async function pathExists(target: string): Promise<boolean> {
  return await stat(target)
    .then(() => true)
    .catch(() => false);
}
