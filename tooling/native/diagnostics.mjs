// Pure diagnostic-manifest logic for the gated NativeAOT publisher. Kept
// separate so it can be unit-tested without a full publish.

import { homedir } from "node:os";
import path from "node:path";

// Locale-independent, byte-order comparison. localeCompare would vary with the
// runtime ICU/locale, which must never change the manifest ordering.
function compareOrdinal(left, right) {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}

function normalize(value) {
  return path.resolve(value).replaceAll("\\", "/");
}

export function extractDiagnostics(output, roots) {
  const packageRoot = roots.packages
    ?? path.join(homedir(), ".nuget", "packages");
  const counts = new Map();

  for (const line of output.split(/\r?\n/u)) {
    if (!/\bwarning(?:\s+[A-Z]+\d+)?\s*:/u.test(line)) {
      continue;
    }

    const fingerprint = line
      .replaceAll("\\", "/")
      .replaceAll(normalize(packageRoot), "<packages>")
      .replaceAll(normalize(roots.repository), "<repository>")
      .replaceAll(normalize(roots.publication), "<publication>")
      .trim();
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }

  return [...counts]
    .sort(([left], [right]) => compareOrdinal(left, right))
    .map(([fingerprint, count]) => ({ fingerprint, count }));
}

export function parseManifest(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Diagnostic manifest is not valid JSON");
  }

  if (typeof parsed !== "object"
    || parsed === null
    || parsed.schemaVersion !== 1
    || !Array.isArray(parsed.diagnostics)) {
    throw new Error(
      "Diagnostic manifest must be { schemaVersion: 1, diagnostics: [...] }");
  }

  for (const entry of parsed.diagnostics) {
    if (typeof entry !== "object"
      || entry === null
      || typeof entry.fingerprint !== "string"
      || entry.fingerprint.length === 0
      || !Number.isSafeInteger(entry.count)
      || entry.count <= 0) {
      throw new Error(
        "Diagnostic manifest contains an invalid { fingerprint, count } entry");
    }
  }

  return parsed.diagnostics;
}

export function diagnosticsMatch(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function renderManifest(diagnostics) {
  return `${JSON.stringify({ schemaVersion: 1, diagnostics }, null, 2)}\n`;
}
