import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readCompiledMigrations
} from "./read-compiled-migrations.mjs";
import {
  renderSchemaManifest
} from "./render-schema-manifest.mjs";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const migrations = await readCompiledMigrations(serviceRoot);

await writeFile(
  path.join(serviceRoot, "schema-manifest.txt"),
  renderSchemaManifest(migrations),
  "utf8");
