import { readFile } from "node:fs/promises";
import path from "node:path";
import { createPublicationInventory } from "./create-publication-inventory.js";
import type {
  PublicationCacheFile,
  PublicationCacheManifest
} from "./publication-cache-manifest.js";

export async function validatePublicationCache(
  directory: string,
  fingerprint: string,
  executableName: string
): Promise<boolean> {
  try {
    const manifest = parseManifest(await readFile(
      path.join(directory, "ctlflow-publication.json"),
      "utf8"));
    if (manifest.fingerprint !== fingerprint
        || manifest.executableName !== executableName) {
      return false;
    }

    const actual = await createPublicationInventory(directory);
    return inventoriesMatch(manifest.files, actual)
      && actual.some((file) => file.path === executableName);
  } catch {
    return false;
  }
}

function parseManifest(value: string): PublicationCacheManifest {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)
      || parsed.schemaVersion !== 1
      || typeof parsed.fingerprint !== "string"
      || typeof parsed.executableName !== "string"
      || !Array.isArray(parsed.files)
      || !parsed.files.every(isCacheFile)) {
    throw new Error("Publication cache manifest is invalid");
  }

  return {
    schemaVersion: 1,
    fingerprint: parsed.fingerprint,
    executableName: parsed.executableName,
    files: parsed.files
  };
}

function isCacheFile(value: unknown): value is PublicationCacheFile {
  return isRecord(value)
    && typeof value.path === "string"
    && value.path.length > 0
    && !value.path.includes("/")
    && !value.path.includes("\\")
    && Number.isSafeInteger(value.size)
    && typeof value.size === "number"
    && value.size >= 0
    && typeof value.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(value.sha256);
}

function inventoriesMatch(
  expected: readonly PublicationCacheFile[],
  actual: readonly PublicationCacheFile[]
): boolean {
  if (expected.length !== actual.length) {
    return false;
  }

  return expected.every((file, index) => {
    const actualFile = actual[index];
    return actualFile !== undefined
      && file.path === actualFile.path
      && file.size === actualFile.size
      && file.sha256 === actualFile.sha256;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
