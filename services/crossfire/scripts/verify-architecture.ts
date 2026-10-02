import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { availableParallelism } from 'node:os';

const root = fileURLToPath(new URL("../", import.meta.url));
const selection = process.argv.slice(2);
assert(selection.length === 0 || (selection.length === 1 && selection[0] === "installation"),
  "Usage: verify-architecture.ts [installation]");
const scratch = join(root, ".temp");
mkdirSync(scratch, { recursive: true });
const output = mkdtempSync(join(scratch, "architecture-build-"));
execFileSync(process.execPath, [fileURLToPath(import.meta.resolve("typescript/bin/tsc")),
  "-p", "tsconfig.architecture.json", "--outDir", output], {
  cwd: root, stdio: "inherit", timeout: 60_000,
});
const directory = join(output, 'scripts/architecture-proof');
const tests = readdirSync(directory).filter(name => name.endsWith(".test.js") &&
  (selection.length === 0 || name === "installation.test.js")).sort().map(name => join(directory, name));
assert(tests.length > 0, "Architecture build produced no tests");
execFileSync(process.execPath, ["--test", '--test-concurrency=' + availableParallelism(), ...tests], {
  cwd: root, stdio: "inherit", timeout: 300_000,
});
