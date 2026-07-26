import {
  readdir,
  stat
} from "node:fs/promises";
import path from "node:path";

const ignoredDirectories = new Set(["bin", "obj"]);

export async function collectPublicationFiles(
  roots: readonly string[]
): Promise<readonly string[]> {
  const files = new Set<string>();

  for (const root of roots) {
    const details = await stat(root).catch(() => undefined);
    if (details?.isFile()) {
      files.add(path.resolve(root));
    } else if (details?.isDirectory()) {
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
