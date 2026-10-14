import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildRelease } from "../scripts/build-release.js";
import { ARTIFACTS, manifest } from "@ctlflow/crossfire-contracts/release";
import { artifactHash, loadRelease } from "@ctlflow/crossfire-adapter-filesystem/release";
import { serveArtifact } from "../apps/server/src/artifacts.js";

test("published project-local release is immutable, bounded, standalone and publicly inspectable", async context => {
  mkdirSync(join(process.cwd(), ".temp"), { recursive: true });
  const output = mkdtempSync(join(process.cwd(), ".temp/onboarding-release-"));
  const metadata = await buildRelease(process.cwd(), join(process.cwd(), 'apps/web/dist'), output);
  const directory = join(output, "onboarding", metadata.release);
  const release = loadRelease(directory);
  assert.deepEqual((await buildRelease(process.cwd(), join(process.cwd(), 'apps/web/dist'), output)), metadata);
  assert.equal(manifest(metadata).ok, true);
  assert.equal(manifest({ ...metadata, artifacts: { ...metadata.artifacts, "evil.mjs": {} } }).ok, false);
  const server = createServer((request, response) => {
    if (!serveArtifact(release, request.method ?? "", request.url ?? "", response)) { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup(context, () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/onboarding/${metadata.release}/`;
  for (const name of ARTIFACTS) {
    const response = await fetch(base + name);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, metadata.artifacts[name].bytes);
    assert.equal(artifactHash(bytes), metadata.artifacts[name].sha256);
  }
  assert.equal((await fetch(base + "SKILL.md", { method: "HEAD" })).status, 200);
  assert.equal((await fetch(base + "SKILL.md", { method: "POST" })).status, 404);
  assert.equal((await fetch(base + "../config.json")).status, 404);
  assert.equal((await fetch(base + "files/../../bootstrap.json")).status, 404);
  assert.equal((await fetch(base.replace(metadata.release, "latest") + "SKILL.md")).status, 404);
  const isolated = join(output, "isolated-project");
  mkdirSync(isolated);
  cpSync(directory, isolated, { recursive: true });
  const client = join(isolated, "crossfire-client.mjs");
  const help = JSON.parse(execFileSync(process.execPath, [client, "--help"], { cwd: isolated, encoding: "utf8" })) as { usage: string; agent: Record<string, unknown> };
  assert.match(help.usage, /--project/);
  assert(!("init" in help.agent));
  assert(!("conversation" in help.agent));
  for (const removed of ['connect', 'disconnect', 'listen']) {
    assert(!(removed in help.agent));
    assert.throws(() => execFileSync(process.execPath, [client, 'agent', removed], { cwd: isolated, stdio: 'pipe' }));
  }
  assert.throws(() => execFileSync(process.execPath, [client, "--instance", "old", "agent", "init"], { cwd: isolated, stdio: "pipe" }));
  const original = readFileSync(join(directory, "SKILL.md"));
  writeFileSync(join(directory, "SKILL.md"), "tampered");
  assert.throws(() => loadRelease(directory), /manifest/);
  assert.equal(release.files["SKILL.md"].toString(), original.toString());
});
