import { rm } from "node:fs/promises";
import path from "node:path";

const directories = process.argv.slice(2);
if (directories.length === 0) {
  throw new Error("At least one generated directory is required");
}

for (const directory of directories) {
  if (path.isAbsolute(directory)
      || directory === "."
      || directory === ".."
      || directory.startsWith("../")) {
    throw new Error(`Refusing to clean unsafe directory: ${directory}`);
  }

  await rm(path.resolve(process.cwd(), directory), {
    recursive: true,
    force: true
  });
}
