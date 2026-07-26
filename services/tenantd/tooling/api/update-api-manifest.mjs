import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiManifest } from "./create-api-manifest.mjs";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const repositoryRoot = path.resolve(serviceRoot, "../..");

await writeFile(
  path.join(serviceRoot, "api-manifest.txt"),
  await createApiManifest(repositoryRoot, serviceRoot),
  "utf8");
