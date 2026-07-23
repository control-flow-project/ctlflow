import { readFile } from "node:fs/promises";
import type {
  NativeAotDiagnostic,
  NativeAotDiagnosticManifest
} from "./native-aot-diagnostic.js";

export async function readNativeAotDiagnosticManifest(
  manifestPath: string
): Promise<NativeAotDiagnosticManifest> {
  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!isManifest(parsed)) {
    throw new Error(
      `Invalid NativeAOT diagnostic manifest: ${manifestPath}`);
  }

  return parsed;
}

function isManifest(value: unknown): value is NativeAotDiagnosticManifest {
  if (!isObject(value)
      || value.schemaVersion !== 1
      || !Array.isArray(value.diagnostics)) {
    return false;
  }

  return value.diagnostics.every(isDiagnostic);
}

function isDiagnostic(value: unknown): value is NativeAotDiagnostic {
  return isObject(value)
    && typeof value.fingerprint === "string"
    && value.fingerprint.length > 0
    && Number.isSafeInteger(value.count)
    && typeof value.count === "number"
    && value.count > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
