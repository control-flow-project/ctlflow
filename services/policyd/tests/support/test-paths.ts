import path from "node:path";
import {
  fileURLToPath
} from "node:url";

export const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..");
export const repositoryRoot = path.resolve(serviceRoot, "../..");
