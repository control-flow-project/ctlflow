import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { writeDescriptorSet } from "./write-descriptor-set.mjs";

export async function createApiManifest({
  repositoryRoot,
  serviceRoot,
  serviceName
}) {
  const descriptorPath = path.join(
    repositoryRoot,
    ".temp/api-descriptors",
    serviceName,
    `${serviceName}.pb`);

  await writeDescriptorSet({
    repositoryRoot,
    protoRoot: path.join(serviceRoot, "api/proto"),
    descriptorPath
  });

  const digest = createHash("sha256")
    .update(await readFile(descriptorPath))
    .digest("hex");
  return `v1/${serviceName}.proto\t${digest}\n`;
}
