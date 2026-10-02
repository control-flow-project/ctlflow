import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths, prepareProject } from '@crossfire/adapter-filesystem/project';
import { privateDir, readJson, writeJson } from "@crossfire/adapter-filesystem/index";
import { MAX_JSON_BYTES } from "@crossfire/contracts/limits";
import { account } from "@crossfire/contracts/client";

function directory(): string {
  mkdirSync(join(process.cwd(), ".temp"), { recursive: true });
  return mkdtempSync(join(process.cwd(), ".temp/client-private-"));
}

test("project identity requires ignored private storage and cannot overwrite unrelated files", () => {
  const project = directory();
  execFileSync("git", ["init", "--quiet", project]);
  assert.throws(() => paths(project, "holmes"), /Ignore .crossfire/);
  assert.equal(existsSync(join(project, ".crossfire")), false);
  writeFileSync(join(project, ".gitignore"), ".crossfire/profiles/holmes.json\n");
  assert.throws(() => paths(project, "holmes"), /Ignore .crossfire/);
  writeFileSync(join(project, ".gitignore"), ".crossfire/\n");
  const profile = paths(project, "holmes");
  assert.equal(profile.root, join(project, ".crossfire"));
  assert.equal(statSync(profile.root).mode & 0o777, 0o700);
  assert.throws(() => paths(project, "../other"), /Profile names/);
  writeJson(profile.profile, { preserved: true });
  assert.deepEqual(readJson(profile.profile), { preserved: true });
  assert.equal(statSync(profile.profile).mode & 0o777, 0o600);
  chmodSync(profile.profile, 0o644);
  assert.throws(() => writeJson(profile.profile, { overwrite: true }), /private/);
});

test("private file operations reject leaf and ancestor links, public files and oversized data", () => {
  const root = directory();
  const target = privateDir(join(root, "target"));
  const source = join(target, "state.json");
  writeJson(source, { unchanged: true });
  symlinkSync(target, join(root, "linked"), "dir");
  assert.throws(() => privateDir(join(root, "linked", "nested")), /symlink/);
  assert.equal(existsSync(join(target, "nested")), false);
  assert.throws(() => readJson(join(root, "linked", "state.json")), /symlink/);
  symlinkSync(source, join(root, "file.json"));
  assert.throws(() => readJson(join(root, "file.json")));
  assert.throws(() => writeJson(join(root, "file.json"), { overwrite: true }));
  assert.deepEqual(readJson(source), { unchanged: true });
  const large = join(root, "large.json");
  writeFileSync(large, "x".repeat(MAX_JSON_BYTES + 1), { mode: 0o600 });
  assert.throws(() => readJson(large), /bounded/);
  assert.throws(() => writeJson(join(root, "too-large.json"), { data: "x".repeat(MAX_JSON_BYTES) }), /finite/);
  assert.equal(existsSync(join(root, "too-large.json")), false);
});

test("server and client account credentials share a strict bounded native contract", () => {
  const input = { user_id: "@agent:example.org", access_token: "x".repeat(8192), device_id: "AGENT" };
  assert.equal(account(input).ok, true);
  assert.equal(account({ ...input, access_token: "x".repeat(8193) }).ok, false);
  assert.equal(account({ ...input, password: "not-a-client-field" }).ok, false);
  assert.equal(account({ ...input, user_id: "agent" }).ok, false);
});

test('project privacy preserves subprocess failures and never treats them as a Git exit or creates credential storage', () => {
  const project = directory(), executableDirectory = directory();
  const blocked = join(executableDirectory, 'git');
  writeFileSync(blocked, '#!/bin/sh\nexit 0\n', { mode: 0o600 });
  const adapter = import.meta.resolve('@crossfire/adapter-filesystem/project');
  const script = `
import { paths, prepareProject } from ${JSON.stringify(adapter)};
const failures = [];
for (const operation of [() => paths(process.argv[1], 'holmes'), () => prepareProject(process.argv[1])]) {
  try { operation(); throw new Error('Privacy unexpectedly accepted a failed subprocess'); }
  catch (error) { failures.push({ message: error.message, code: error.cause?.code }); }
}
process.stdout.write(JSON.stringify(failures));
`;
  for (const [path, code] of [['', 'ENOENT'], [executableDirectory, 'EACCES']]) {
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script, project], { env: { ...process.env, PATH: path }, encoding: 'utf8' });
    const failures = JSON.parse(output) as { message: string; code: string }[];
    assert.equal(failures.length, 2);
    for (const failure of failures) { assert.equal(failure.code, code); assert(failure.message.includes(code!)); }
    assert.equal(existsSync(join(project, '.crossfire')), false);
    assert.equal(existsSync(join(project, '.gitignore')), false);
  }
  assert.equal(prepareProject(project), project, 'A real non-Git project does not require a fabricated repository');
});
