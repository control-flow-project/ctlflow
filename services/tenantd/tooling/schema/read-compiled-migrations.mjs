import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export async function readCompiledMigrations(serviceRoot) {
  const directory = path.join(
    serviceRoot,
    ".generated/migrations/migrations");
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".js"))
    .sort((left, right) => left.localeCompare(right));

  if (names.length === 0) {
    throw new Error("The compiled migration sequence is empty");
  }

  return await Promise.all(names.map(async (name) => {
    const sourceName = `${path.parse(name).name}.ts`;
    const source = await readFile(
      path.join(serviceRoot, "migrations", sourceName));
    const compiled = await readFile(path.join(directory, name));
    return {
      name,
      digest: createHash("sha256")
        .update("source\0")
        .update(source)
        .update("\0compiled\0")
        .update(compiled)
        .digest("hex")
    };
  }));
}
