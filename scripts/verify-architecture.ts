import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = join(root, ".temp");
mkdirSync(scratch, { recursive: true });
const output = mkdtempSync(join(scratch, "architecture-build-"));
execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"),
  "-p", "tsconfig.architecture.json", "--outDir", output], {
  cwd: root, stdio: "inherit", timeout: 60_000,
});
const tests = readdirSync(output).filter(name => name.endsWith(".test.js")).sort().map(name => join(output, name));
assert(tests.length > 0, "Architecture build produced no tests");
execFileSync(process.execPath, ["--test", ...tests], {
  cwd: root, stdio: "inherit", timeout: 300_000,
});
