import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCompiledMigrations } from "./read-compiled-migrations.mjs";
import { renderSchemaManifest } from "./render-schema-manifest.mjs";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const expected = await readFile(
  path.join(serviceRoot, "schema-manifest.txt"),
  "utf8");
const actual = renderSchemaManifest(
  await readCompiledMigrations(serviceRoot));

if (actual !== expected) {
  throw new Error(
    "schema-manifest.txt does not match the compiled Knex migrations; "
    + "run npm run update:schema-manifest --workspace @ctlflow/auditd");
}
