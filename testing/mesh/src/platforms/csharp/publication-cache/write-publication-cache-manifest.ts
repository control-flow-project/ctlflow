import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicationInventory } from "./create-publication-inventory.js";
import type {
  PublicationCacheManifest
} from "./publication-cache-manifest.js";

export async function writePublicationCacheManifest(
  directory: string,
  fingerprint: string,
  executableName: string
): Promise<void> {
  const manifest: PublicationCacheManifest = {
    schemaVersion: 1,
    fingerprint,
    executableName,
    files: await createPublicationInventory(directory)
  };

  await writeFile(
    path.join(directory, "ctlflow-publication.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" });
}
