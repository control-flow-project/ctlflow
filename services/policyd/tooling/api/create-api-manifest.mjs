import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export async function createApiManifest(
  repositoryRoot,
  serviceRoot
) {
  const descriptorDirectory = path.join(
    repositoryRoot,
    ".temp/api-descriptors/policyd");
  const descriptorPath = path.join(
    descriptorDirectory,
    "policyd.pb");
  const protoc = path.join(
    repositoryRoot,
    "node_modules/.bin/grpc_tools_node_protoc");

  await mkdir(descriptorDirectory, { recursive: true });
  await runProtoc(
    protoc,
    repositoryRoot,
    serviceRoot,
    descriptorPath);

  const digest = createHash("sha256")
    .update(await readFile(descriptorPath))
    .digest("hex");
  return `v1/policyd.proto\t${digest}\n`;
}

async function runProtoc(
  protoc,
  repositoryRoot,
  serviceRoot,
  descriptorPath
) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      protoc,
      [
        "--include_imports",
        `--descriptor_set_out=${descriptorPath}`,
        `--proto_path=${path.join(serviceRoot, "api/proto")}`,
        "v1/policyd.proto"
      ],
      {
        cwd: repositoryRoot,
        stdio: "inherit"
      });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(
        `Protobuf descriptor generation failed with code ${String(code)} `
        + `and signal ${String(signal)}`));
    });
  });
}
