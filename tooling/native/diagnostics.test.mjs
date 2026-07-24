import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diagnosticsMatch,
  extractDiagnostics,
  parseManifest,
  renderManifest
} from "./diagnostics.mjs";

test("extractDiagnostics normalizes roots, counts, and orders deterministically", () => {
  const output = [
    "/repo/b.cs(1): warning IL2026: message",
    "/repo/a.cs(1): warning IL2026: message",
    "/repo/a.cs(1): warning IL2026: message",
    "Build succeeded.",
    "  Restored /repo/x.csproj"
  ].join("\n");

  assert.deepEqual(
    extractDiagnostics(output, { repository: "/repo", publication: "/out" }),
    [
      { fingerprint: "<repository>/a.cs(1): warning IL2026: message", count: 2 },
      { fingerprint: "<repository>/b.cs(1): warning IL2026: message", count: 1 }
    ]);
});

test("extractDiagnostics ordering is locale-independent byte order", () => {
  const output = [
    "/repo/Z.cs: warning X1: m",
    "/repo/a.cs: warning X1: m"
  ].join("\n");

  // Uppercase 'Z' (0x5A) sorts before lowercase 'a' (0x61) in byte order,
  // whereas a locale collation would typically invert them.
  assert.deepEqual(
    extractDiagnostics(output, { repository: "/repo", publication: "/out" })
      .map((entry) => entry.fingerprint),
    ["<repository>/Z.cs: warning X1: m", "<repository>/a.cs: warning X1: m"]);
});

test("parseManifest accepts a well-formed manifest", () => {
  assert.deepEqual(
    parseManifest(renderManifest([{ fingerprint: "x", count: 2 }])),
    [{ fingerprint: "x", count: 2 }]);
});

test("parseManifest rejects malformed manifests", () => {
  for (const malformed of [
    "not json",
    JSON.stringify({ diagnostics: [] }),
    JSON.stringify({ schemaVersion: 2, diagnostics: [] }),
    JSON.stringify({ schemaVersion: 1, diagnostics: {} }),
    JSON.stringify({ schemaVersion: 1, diagnostics: [{ fingerprint: "", count: 1 }] }),
    JSON.stringify({ schemaVersion: 1, diagnostics: [{ fingerprint: "x", count: 0 }] }),
    JSON.stringify({ schemaVersion: 1, diagnostics: [{ fingerprint: "x", count: 1.5 }] }),
    JSON.stringify({ schemaVersion: 1, diagnostics: [{ fingerprint: "x" }] })
  ]) {
    assert.throws(() => parseManifest(malformed));
  }
});

test("diagnosticsMatch detects fingerprint, count, order, and cardinality drift", () => {
  const baseline = [
    { fingerprint: "a", count: 1 },
    { fingerprint: "b", count: 1 }
  ];

  assert.equal(diagnosticsMatch(baseline, [
    { fingerprint: "a", count: 1 },
    { fingerprint: "b", count: 1 }
  ]), true);
  assert.equal(diagnosticsMatch(baseline, [
    { fingerprint: "a", count: 2 },
    { fingerprint: "b", count: 1 }
  ]), false);
  assert.equal(diagnosticsMatch(baseline, [{ fingerprint: "a", count: 1 }]), false);
  assert.equal(diagnosticsMatch(baseline, [
    { fingerprint: "a", count: 1 },
    { fingerprint: "b", count: 1 },
    { fingerprint: "c", count: 1 }
  ]), false);
  assert.equal(diagnosticsMatch(baseline, [
    { fingerprint: "b", count: 1 },
    { fingerprint: "a", count: 1 }
  ]), false);
});
