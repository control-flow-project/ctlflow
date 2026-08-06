import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const repositoryRoot = path.resolve(serviceRoot, "../..");
const generatedDirectory = path.join(serviceRoot, "tests/generated");
const applicationGeneratedDirectory = path.join(
  serviceRoot,
  "testing/application/node/src/generated");
const protoc = path.join(
  repositoryRoot,
  "node_modules/.bin/grpc_tools_node_protoc");
const plugin = path.join(
  repositoryRoot,
  "node_modules/.bin/protoc-gen-ts_proto");
const dependencies = [
  "auditd",
  "configd",
  "identityd",
  "pkgd",
  "policyd"
];

await rm(generatedDirectory, { recursive: true, force: true });
await mkdir(generatedDirectory, { recursive: true });
await rm(applicationGeneratedDirectory, { recursive: true, force: true });
await mkdir(applicationGeneratedDirectory, { recursive: true });

await generate(generatedDirectory, [
  path.join(serviceRoot, "api/proto/v1/execd.proto"),
  ...dependencies.map((service) =>
    path.join(
      repositoryRoot,
      `services/${service}/api/proto/v1/${service}.proto`))
]);

// The controlled test application makes the real product runtime calls from
// inside its container, so it needs exactly the callee-owned Identityd and
// Policyd clients.
await generate(applicationGeneratedDirectory, [
  path.join(
    repositoryRoot,
    "services/identityd/api/proto/v1/identityd.proto"),
  path.join(
    repositoryRoot,
    "services/policyd/api/proto/v1/policyd.proto")
]);

async function generate(outputDirectory, protos) {
  const arguments_ = [
    `--plugin=protoc-gen-ts_proto=${plugin}`,
    `--ts_proto_out=${outputDirectory}`,
    "--ts_proto_opt=outputServices=grpc-js,env=node,forceLong=bigint,useExactTypes=false,importSuffix=.js",
    `--proto_path=${path.join(serviceRoot, "api/proto")}`,
    ...dependencies.map((service) =>
      `--proto_path=${path.join(
        repositoryRoot,
        `services/${service}/api/proto`)}`),
    ...protos
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(
      protoc,
      arguments_,
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

      reject(
        new Error(
          `TypeScript protobuf generation failed with code ${String(code)} `
          + `and signal ${String(signal)}`));
    });
  });
}
