import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const repositoryRoot = path.resolve(serviceRoot, "../..");
const generatedDirectory = path.join(
  serviceRoot,
  "tests/generated");
const protoc = path.join(
  repositoryRoot,
  "node_modules/.bin/grpc_tools_node_protoc");
const plugin = path.join(
  repositoryRoot,
  "node_modules/.bin/protoc-gen-ts_proto");

await rm(generatedDirectory, { recursive: true, force: true });
await mkdir(generatedDirectory, { recursive: true });

await new Promise((resolve, reject) => {
  const child = spawn(
    protoc,
    [
      `--plugin=protoc-gen-ts_proto=${plugin}`,
      `--ts_proto_out=${generatedDirectory}`,
      "--ts_proto_opt=outputServices=grpc-js,env=node,forceLong=bigint,useExactTypes=false,importSuffix=.js",
      `--proto_path=${path.join(serviceRoot, "api/proto")}`,
      path.join(serviceRoot, "api/proto/v1/identityd.proto")
    ],
    { cwd: repositoryRoot, stdio: "inherit" });

  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) {
      resolve();
      return;
    }

    reject(new Error(
      `TypeScript protobuf generation failed with code ${String(code)} `
      + `and signal ${String(signal)}`));
  });
});
