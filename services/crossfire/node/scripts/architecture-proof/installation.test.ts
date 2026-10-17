import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve, basename } from "node:path";
import { promisify } from "node:util";
import { containerSourceDigest } from "../container-packages.js";
import test, { type TestContext } from "node:test";

const execute = promisify(execFile);
const installer = process.env.npm_execpath;
const root = resolve(process.cwd(), '../..');
const service = join(root, 'services/crossfire');
const policy = readFileSync(join(root, ".npmrc"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  engines: { node: string; npm: string };
};

function fixture(scope: TestContext): { directory: string; environment: NodeJS.ProcessEnv } {
  mkdirSync(join(root, ".temp"), { recursive: true });
  const directory = mkdtempSync(join(root, ".temp/installation-"));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, ".npmrc"), policy);
  const userConfiguration = join(directory, "user.npmrc");
  const globalConfiguration = join(directory, "global.npmrc");
  writeFileSync(userConfiguration, "", { mode: 0o600 });
  writeFileSync(globalConfiguration, "", { mode: 0o600 });
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.toLowerCase().startsWith("npm_config_")));
  return { directory, environment: { ...environment, npm_config_userconfig: userConfiguration,
    npm_config_globalconfig: globalConfiguration, npm_config_cache: join(directory, "cache"),
    npm_config_update_notifier: "false" } };
}

async function npm(directory: string, environment: NodeJS.ProcessEnv, args: string[]) {
  assert(installer, "Run installation verification through npm run verify:installation");
  return execute(process.execPath, [installer, "--prefix", directory, ...args],
    { cwd: directory, env: environment, timeout: 60_000, maxBuffer: 1024 * 1024 });
}

function writeProject(directory: string, dependencies: Readonly<Record<string, string>> = {}): void {
  writeFileSync(join(directory, "package.json"), JSON.stringify({
    name: "crossfire-installation-fixture", version: "1.0.0", private: true,
    engines: manifest.engines, dependencies,
  }));
}

test("one native install policy governs host, Docker context and image identity", async context => {
  assert.equal(manifest.engines.npm, ">=11.17.0");
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
    packages: Record<string, { engines: { node: string; npm: string } }>;
  };
  assert.deepEqual(lock.packages[""]?.engines, manifest.engines);
  assert.match(policy, /^min-release-age=7$/m);
  assert.match(policy, /^engine-strict=true$/m);
  assert.doesNotMatch(policy, /force|legacy-peer/i);
  assert.deepEqual(policy.split("\n").filter(line => line.startsWith("min-release-age-exclude")),
    ["min-release-age-exclude[]=@tinqerjs/tinqer", "min-release-age-exclude[]=@tinqerjs/better-sqlite3-adapter",
      "min-release-age-exclude[]=@ctlflow/fleet", "min-release-age-exclude[]=@ctlflow/fleetd"]);
  assert.match(readFileSync(join(root, ".dockerignore"), "utf8"), /^!\.npmrc$/m);
  assert.match(readFileSync(join(service, "node/Dockerfile"), "utf8"),
    /COPY \.npmrc package\.json package-lock\.json tsconfig\.base\.json \.\//);
  assert.match(readFileSync(join(service, "node/Dockerfile"), "utf8"), /RUN npm ci --ignore-scripts/);
  assert.match(readFileSync(join(service, "node/scripts/container-packages.ts"), "utf8"), /\x27.npmrc\x27/);
  assert.equal(readFileSync(join(service, "node/apps/server/src/operator.ts"), "utf8").includes("['build'"), false, 'Deployment cannot compile source');
  const { directory, environment } = fixture(context);
  writeProject(directory);
  assert.equal((await npm(directory, environment, ["config", "get", "min-release-age"])).stdout.trim(), "7");
  assert.equal((await npm(directory, environment, ["config", "get", "engine-strict"])).stdout.trim(), "true");
  await npm(directory, environment, ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);
  await npm(directory, environment, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
});

test("an actual pre-exemption npm is rejected before installation even with scripts disabled", { timeout: 90_000 }, async context => {
  const { directory, environment } = fixture(context);
  const tooling = join(directory, "tooling");
  mkdirSync(tooling);
  writeFileSync(join(tooling, ".npmrc"), policy);
  writeProject(tooling);
  await npm(tooling, environment, ["install", "--ignore-scripts", "--no-audit", "--no-fund", "npm@11.16.0"]);
  const installer = join(tooling, "node_modules/npm/bin/npm-cli.js");
  const version = await execute(process.execPath, [installer, "--version"], { env: environment, timeout: 10_000 });
  assert.equal(version.stdout.trim(), "11.16.0");
  writeProject(directory);
  await npm(directory, environment, ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);
  const sentinel = join(directory, "node_modules/sentinel.txt");
  mkdirSync(join(directory, "node_modules"));
  writeFileSync(sentinel, "preserve before admission");
  await assert.rejects(execute(process.execPath, [installer, "ci", "--ignore-scripts", "--offline", "--no-audit", "--no-fund"], {
    cwd: directory, env: environment, timeout: 30_000, maxBuffer: 1024 * 1024,
  }), error => {
    assert(error instanceof Error && "stderr" in error);
    assert.match(String(error.stderr), /EBADENGINE/);
    assert.match(String(error.stderr), /npm.*>=11\.17\.0/);
    return true;
  });
  assert.equal(readFileSync(sentinel, "utf8"), "preserve before admission");
});

test("changing only policy bytes invalidates the real runtime image fingerprint", async context => {
  const { directory } = fixture(context);
  for (const file of [".dockerignore", ".npmrc", "LICENSE", "package.json", "package-lock.json", "tsconfig.base.json", "global.json", "Directory.Build.props", "Directory.Build.targets", "Directory.Packages.props", "Ctlflow.CSharp.slnx", "Cargo.toml", "Cargo.lock", "rust-toolchain.toml"]) {
    copyFileSync(join(root, file), join(directory, file));
  }
  for (const folder of ["scripts", "services"]) cpSync(join(root, folder), join(directory, folder), { recursive: true,
    filter: path => !['node_modules', 'dist', 'bin', 'obj', 'target', '.temp', '.analysis', '.git'].includes(basename(path)) });
  const original = containerSourceDigest(directory);
  assert.match(original, /^[a-f0-9]{64}$/);
  writeFileSync(join(directory, ".npmrc"), policy.replace("min-release-age=7", "min-release-age=8"));
  assert.notEqual(containerSourceDigest(directory), original);
  const changedPolicy = containerSourceDigest(directory);
  writeFileSync(join(directory, "tsconfig.base.json"), readFileSync(join(directory, "tsconfig.base.json"), 'utf8') + '\n');
  assert.notEqual(containerSourceDigest(directory), changedPolicy);
  const changedCompiler = containerSourceDigest(directory);
  writeFileSync(join(directory, "LICENSE"), readFileSync(join(directory, "LICENSE"), 'utf8') + '\n');
  assert.notEqual(containerSourceDigest(directory), changedCompiler, 'License bytes are real image inputs');
  const changedLicense = containerSourceDigest(directory);
  writeFileSync(join(directory, 'Directory.Build.props'), readFileSync(join(directory, 'Directory.Build.props'), 'utf8') + '\n');
  assert.notEqual(containerSourceDigest(directory), changedLicense, '.NET build policy is also a real image input');
});

test("native age policy admits aged third parties and only the named owned exemptions", { timeout: 90_000 }, async context => {
  const now = Date.now();
  const aged = new Date(now - 8 * 86_400_000).toISOString();
  const fresh = new Date(now - 86_400_000).toISOString();
  const exempt = ['@tinqerjs/tinqer', '@tinqerjs/better-sqlite3-adapter', '@ctlflow/fleet', '@ctlflow/fleetd'];
  const unexpected: string[] = [];
  let origin = "";
  const registry = createServer((request, response) => {
    const name = decodeURIComponent(request.url?.slice(1) ?? "");
    if (!["aged-fixture", "fresh-fixture", ...exempt, "@tinqerjs/not-approved", "@ctlflow/crossfire-domain"].includes(name)) {
      unexpected.push(request.url ?? "");
      response.writeHead(404).end();
      return;
    }
    const versions = name === "aged-fixture" ? ["1.0.0", "2.0.0"] : ["2.0.0"];
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ name, "dist-tags": { latest: "2.0.0" },
      time: { created: aged, modified: fresh, "1.0.0": aged, "2.0.0": fresh },
      versions: Object.fromEntries(versions.map(version => [version, {
        name, version, dist: { tarball: `${origin}/${name}-${version}.tgz` },
        dependencies: exempt.includes(name) ? { "aged-fixture": "*" } : {},
      }])),
    }));
  });
  registry.listen(0, "127.0.0.1");
  await once(registry, "listening");
  cleanup(context, () => { registry.closeAllConnections(); registry.close(); });
  const address = registry.address();
  assert(address && typeof address !== "string");
  origin = "http://127.0.0.1:" + address.port;
  const positive = fixture(context);
  writeProject(positive.directory, { "aged-fixture": "*" });
  await npm(positive.directory, positive.environment, ["install", "--package-lock-only", "--ignore-scripts",
    "--no-audit", "--no-fund", "--registry", origin]);
  const lock = JSON.parse(readFileSync(join(positive.directory, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version: string }>;
  };
  assert.equal(lock.packages["node_modules/aged-fixture"]?.version, "1.0.0");
  for (const { range, code } of [{ range: "*", code: "ENOVERSIONS" }, { range: "2.0.0", code: "ETARGET" }]) {
    const negative = fixture(context);
    writeProject(negative.directory, { "fresh-fixture": range });
    await assert.rejects(npm(negative.directory, negative.environment, ["install", "--package-lock-only", "--ignore-scripts",
      "--no-audit", "--no-fund", "--registry", origin]), error => {
      assert(error instanceof Error && "stderr" in error);
      assert.match(String(error.stderr), new RegExp("npm error code " + code));
      if (range === "2.0.0") assert.match(String(error.stderr), /with a date before/);
      return true;
    });
  }
  for (const name of exempt) {
    const approved = fixture(context);
    writeProject(approved.directory, { [name]: "2.0.0" });
    await npm(approved.directory, approved.environment, ["install", "--package-lock-only", "--ignore-scripts",
      "--no-audit", "--no-fund", "--registry", origin]);
    const approvedLock = JSON.parse(readFileSync(join(approved.directory, "package-lock.json"), "utf8")) as {
      packages: Record<string, { version: string }>;
    };
    assert.equal(approvedLock.packages["node_modules/" + name]?.version, "2.0.0");
    assert.equal(approvedLock.packages["node_modules/aged-fixture"]?.version, "1.0.0");
  }
  for (const name of ["@tinqerjs/not-approved", "@ctlflow/crossfire-domain"]) {
    const unapproved = fixture(context);
    writeProject(unapproved.directory, { [name]: "2.0.0" });
    await assert.rejects(npm(unapproved.directory, unapproved.environment, ["install", "--package-lock-only", "--ignore-scripts",
      "--no-audit", "--no-fund", "--registry", origin]), error => {
      assert(error instanceof Error && "stderr" in error);
      assert.match(String(error.stderr), /npm error code ETARGET/);
      return true;
    });
  }
  assert.deepEqual(unexpected, []);
});
