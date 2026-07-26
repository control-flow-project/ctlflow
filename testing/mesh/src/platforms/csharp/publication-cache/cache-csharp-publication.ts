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
} from "../csharp-service-publication.js";
import { resolvePublicationCachePaths } from
  "./resolve-publication-cache-paths.js";
import { validatePublicationCache } from
  "./validate-publication-cache.js";
import { writePublicationCacheManifest } from
  "./write-publication-cache-manifest.js";

export async function cacheCSharpPublication(
  options: CSharpServicePublicationOptions,
  fingerprint: string,
  publish: (directory: string) => Promise<void>
): Promise<CSharpServicePublication> {
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
  await publish(staging);
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
    executableName,
    cacheHit,
    stop: () => Promise.resolve()
  };
}

async function pathExists(target: string): Promise<boolean> {
  return await stat(target)
    .then(() => true)
    .catch(() => false);
}
