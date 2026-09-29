import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildClient } from "./build-client.js";
import { buildWeb } from "./build-web.js";
import { ARTIFACTS, type ArtifactName, type Manifest } from "../packages/contracts/src/release.js";
import { artifactHash, releaseHash, loadRelease } from "../packages/files/src/release.js";

export async function buildRelease(root: string, output = join(root, "dist")): Promise<Manifest> {
  const package_: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (!package_ || typeof package_ !== "object" || !("version" in package_) || typeof package_.version !== "string"
    || !/^\d+\.\d+\.\d+$/u.test(package_.version)) throw new Error("Invalid package version");
  await buildClient(root, join(output, "crossfire-client.mjs"));
  await buildWeb(root, join(output, "web"));
  const files: Record<ArtifactName, Buffer> = {
    "README.md": readFileSync(join(root, "docs/onboarding/README.md")),
    "SKILL.md": readFileSync(join(root, "skills/conduit-chat/SKILL.md")),
    "crossfire-client.mjs": readFileSync(join(output, "crossfire-client.mjs")),
    "matrix-spec-LICENSE.txt": readFileSync(join(root, "third-party/matrix-spec-LICENSE")),
  };
  const manifest: Manifest = { version: package_.version, release: package_.version + "-" + releaseHash(files),
    artifacts: Object.fromEntries(ARTIFACTS.map(name => [name, { bytes: files[name].length, sha256: artifactHash(files[name]) }])) as Manifest["artifacts"] };
  const directory = join(output, "onboarding", manifest.release);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
    for (const name of ARTIFACTS) writeFileSync(join(directory, name), files[name], { flag: "wx" });
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  }
  const published = loadRelease(directory);
  if (published.manifest.release !== manifest.release) throw new Error("Existing immutable release does not match");
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: "string" } } });
  if (!values.root) throw new Error("Supply the exact source --root directory");
  console.log(JSON.stringify(await buildRelease(resolve(values.root))));
}
