import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateTypescript } from "../../../../tooling/protobuf/generate-typescript.mjs";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const repositoryRoot = path.resolve(serviceRoot, "../..");
const protoRoot = (service) => path.join(
  repositoryRoot,
  `services/${service}/api/proto`);

await generateTypescript({
  repositoryRoot,
  protoRoots: [
    path.join(serviceRoot, "api/proto"),
    ...[
      "auditd",
      "configd",
      "identityd",
      "pkgd",
      "policyd"
    ].map(protoRoot)
  ],
  outputDirectory: path.join(serviceRoot, "tests/generated")
});

// The controlled test application makes the real product runtime calls from
// inside its container, so it needs exactly the callee-owned clients.
await generateTypescript({
  repositoryRoot,
  protoRoots: ["identityd", "policyd"].map(protoRoot),
  outputDirectory: path.join(
    serviceRoot,
    "testing/application/node/src/generated")
});
