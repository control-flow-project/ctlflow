import os from "node:os";
import path from "node:path";
import type {
  NativeAotDiagnostic
} from "./native-aot-diagnostic.js";

export interface NativeAotDiagnosticRoots {
  readonly repository: string;
  readonly publication: string;
}

export function extractNativeAotDiagnostics(
  output: string,
  roots: NativeAotDiagnosticRoots
): readonly NativeAotDiagnostic[] {
  const counts = new Map<string, number>();

  for (const line of output.split(/\r?\n/u)) {
    if (!/\bwarning(?:\s+[A-Z]+\d+)?\s*:/u.test(line)) {
      continue;
    }

    const fingerprint = normalizeDiagnostic(line, roots);
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }

  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fingerprint, count]) => ({ fingerprint, count }));
}

function normalizeDiagnostic(
  line: string,
  roots: NativeAotDiagnosticRoots
): string {
  const packageRoot = path.join(os.homedir(), ".nuget", "packages");
  return line
    .replaceAll("\\", "/")
    .replaceAll(normalizePath(roots.repository), "<repository>")
    .replaceAll(normalizePath(packageRoot), "<packages>")
    .replaceAll(normalizePath(roots.publication), "<publication>")
    .trim();
}

function normalizePath(value: string): string {
  return path.resolve(value).replaceAll("\\", "/");
}
