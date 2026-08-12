import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateTypescript } from "../../../../tooling/protobuf/generate-typescript.mjs";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const repositoryRoot = path.resolve(serviceRoot, "../..");

await generateTypescript({
  repositoryRoot,
  protoRoots: [
    path.join(repositoryRoot, "services/tenantd/api/proto")
  ],
  outputDirectory: path.join(serviceRoot, "tests/generated")
});
