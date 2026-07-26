#!/usr/bin/env node
// The single repository-owned NativeAOT publisher. It publishes a C# Service
// project and gates the result against the checked-in diagnostic manifest.
//
//   node tooling/native/gated-publish.mjs <project> <manifest> <outputDir> [--write]
//
// Default mode fails (exit 1) on any missing, additional, or changed diagnostic
// fingerprint. `--write` regenerates the manifest instead and requires review.
// Local verification, the canonical test mesh, and container release all use it,
// so the release path is never a warning-tolerant command that skips the gate.

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import {
  diagnosticsMatch,
  extractDiagnostics,
  parseManifest,
  renderManifest
} from "./diagnostics.mjs";

const [project, manifestPath, outputDir, ...flags] = process.argv.slice(2);
const write = flags.includes("--write");

if (!project || !manifestPath || !outputDir) {
  console.error(
    "usage: gated-publish.mjs <project> <manifest> <outputDir> [--write]");
  process.exit(2);
}

const repositoryRoot = process.cwd();
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

function dotnet(args) {
  const result = spawnSync("dotnet", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024
  });
  return {
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    status: result.status
  };
}

function require(step, result) {
  if (result.status !== 0) {
    process.stderr.write(result.output);
    console.error(`${step} failed`);
    process.exit(1);
  }
  return result;
}

require("dotnet Debug clean", dotnet([
  "clean", project, "--configuration", "Debug", "--runtime", "linux-x64",
  "--disable-build-servers", "-m:1", "-p:UseSharedCompilation=false"
]));

require("dotnet Release clean", dotnet([
  "clean", project, "--configuration", "Release", "--runtime", "linux-x64",
  "--disable-build-servers", "-m:1", "-p:UseSharedCompilation=false"
]));

require("locked restore", dotnet([
  "restore", project, "--runtime", "linux-x64",
  "--disable-build-servers", "--locked-mode"
]));

const publish = require("NativeAOT publish", dotnet([
  "publish", project, "--no-restore", "--disable-build-servers",
  "--configuration", "Release", "--runtime", "linux-x64",
  "--output", outputDir, "-m:1", "-p:UseSharedCompilation=false",
  "-p:TreatWarningsAsErrors=false",
  "-p:ILLinkTreatWarningsAsErrors=false",
  "-p:TrimmerTreatWarningsAsErrors=false",
  "-p:IlcTreatWarningsAsErrors=false"
]));

const actual = extractDiagnostics(publish.output, {
  repository: repositoryRoot,
  publication: outputDir
});

if (write) {
  writeFileSync(manifestPath, renderManifest(actual), "utf8");
  console.log(`Wrote ${actual.length} reviewed diagnostics to the manifest.`);
  process.exit(0);
}

const expected = parseManifest(readFileSync(manifestPath, "utf8"));
if (!diagnosticsMatch(actual, expected)) {
  console.error("NativeAOT diagnostics do not match the reviewed manifest.");
  console.error(`Expected:\n${renderManifest(expected)}`);
  console.error(`Actual:\n${renderManifest(actual)}`);
  process.exit(1);
}

console.log(
  `NativeAOT publish gated against ${actual.length} reviewed diagnostics.`);
