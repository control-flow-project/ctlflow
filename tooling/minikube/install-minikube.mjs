import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const toolchain = JSON.parse(await readFile(
  path.join(repositoryRoot, "testing/mesh/test-toolchain.json"),
  "utf8"));
const version = toolchain.minikube?.version;
const expectedHash = toolchain.minikube?.linuxAmd64Sha256;
if (
  typeof version !== "string"
  || !/^v[0-9]+\.[0-9]+\.[0-9]+$/u.test(version)
  || typeof expectedHash !== "string"
  || !/^[a-f0-9]{64}$/u.test(expectedHash)
) {
  throw new Error("Test toolchain Minikube pin is invalid");
}

const directory = path.join(repositoryRoot, ".temp/tools");
const destination = path.join(directory, "minikube");
const temporary = `${destination}.download`;
await mkdir(directory, { recursive: true });

const response = await fetch(
  `https://storage.googleapis.com/minikube/releases/${version}/`
    + "minikube-linux-amd64");
if (!response.ok) {
  throw new Error(
    `Minikube download failed with HTTP ${String(response.status)}`);
}

const bytes = Buffer.from(await response.arrayBuffer());
const actualHash = createHash("sha256").update(bytes).digest("hex");
if (actualHash !== expectedHash) {
  throw new Error(
    `Minikube checksum mismatch: expected ${expectedHash}, got ${actualHash}`);
}

await writeFile(temporary, bytes, { mode: 0o755 });
await chmod(temporary, 0o755);
await rename(temporary, destination);
await rm(temporary, { force: true });
process.stdout.write(`Installed Minikube ${version} at ${destination}\n`);
