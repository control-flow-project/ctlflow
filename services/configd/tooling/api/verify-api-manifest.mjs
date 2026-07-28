import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiManifest } from "./create-api-manifest.mjs";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const repositoryRoot = path.resolve(serviceRoot, "../..");
const expected = await readFile(
  path.join(serviceRoot, "api-manifest.txt"),
  "utf8");
const actual = await createApiManifest(repositoryRoot, serviceRoot);

if (actual !== expected) {
  throw new Error(
    "api-manifest.txt does not match the generated protobuf descriptor; "
    + "run npm run update:api-manifest --workspace @ctlflow/configd");
}
