import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  readdir,
  stat
} from "node:fs/promises";
import path from "node:path";
import type {
  PublicationCacheFile
} from "./publication-cache-manifest.js";

const manifestName = "ctlflow-publication.json";

export async function createPublicationInventory(
  directory: string
): Promise<readonly PublicationCacheFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: PublicationCacheFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || entry.name === manifestName) {
      continue;
    }

    const filePath = path.join(directory, entry.name);
    const fileStat = await stat(filePath);
    files.push({
      path: entry.name,
      size: fileStat.size,
      sha256: await hashFile(filePath)
    });
  }

  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  return hash.digest("hex");
}
