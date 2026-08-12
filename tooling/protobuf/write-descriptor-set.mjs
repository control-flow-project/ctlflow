import { mkdir } from "node:fs/promises";
import path from "node:path";

import { runCommand } from "./run-command.mjs";

export async function writeDescriptorSet({
  repositoryRoot,
  protoRoot,
  descriptorPath
}) {
  const buf = path.join(repositoryRoot, "node_modules/.bin/buf");

  await mkdir(path.dirname(descriptorPath), { recursive: true });
  await runCommand(
    buf,
    [
      "build",
      protoRoot,
      "--as-file-descriptor-set",
      "--exclude-source-info",
      "--output",
      descriptorPath
    ],
    {
      cwd: repositoryRoot,
      description: `Protobuf descriptor generation for ${protoRoot}`
    });
}
