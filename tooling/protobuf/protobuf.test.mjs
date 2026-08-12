import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateTypescript } from "./generate-typescript.mjs";
import { writeDescriptorSet } from "./write-descriptor-set.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const identityProtoRoot = path.join(
  repositoryRoot,
  "services/identityd/api/proto");
const testRoot = path.join(repositoryRoot, ".temp/tooling/protobuf-tests");

test("TypeScript protobuf generation is deterministic and uses ESM imports", async () => {
  const outputDirectory = path.join(testRoot, "generated");

  await generateTypescript({
    repositoryRoot,
    protoRoots: [identityProtoRoot],
    outputDirectory
  });
  const first = await readFile(
    path.join(outputDirectory, "v1/identityd.ts"),
    "utf8");

  await generateTypescript({
    repositoryRoot,
    protoRoots: [identityProtoRoot],
    outputDirectory
  });
  const second = await readFile(
    path.join(outputDirectory, "v1/identityd.ts"),
    "utf8");

  assert.equal(second, first);
  assert.match(second, /from "\.\.\/google\/protobuf\/timestamp\.js";/u);
});

test("Buf descriptor bytes match the checked Identityd API manifest", async () => {
  const descriptorPath = path.join(testRoot, "identityd.pb");
  await writeDescriptorSet({
    repositoryRoot,
    protoRoot: identityProtoRoot,
    descriptorPath
  });

  const digest = createHash("sha256")
    .update(await readFile(descriptorPath))
    .digest("hex");
  const manifest = await readFile(
    path.join(repositoryRoot, "services/identityd/api-manifest.txt"),
    "utf8");

  assert.equal(manifest, `v1/identityd.proto\t${digest}\n`);
});

test("descriptor generation rejects malformed protobuf input", async () => {
  const protoRoot = path.join(testRoot, "invalid");
  await mkdir(protoRoot, { recursive: true });
  await writeFile(
    path.join(protoRoot, "invalid.proto"),
    "syntax = ",
    "utf8");

  await assert.rejects(
    writeDescriptorSet({
      repositoryRoot,
      protoRoot,
      descriptorPath: path.join(testRoot, "invalid.pb")
    }),
    /Protobuf descriptor generation .* failed/u);
});
