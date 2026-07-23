import type {
  NativeAotDiagnostic
} from "./native-aot-diagnostic.js";

export function verifyNativeAotDiagnostics(
  expected: readonly NativeAotDiagnostic[],
  actual: readonly NativeAotDiagnostic[]
): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    return;
  }

  throw new Error(
    "NativeAOT diagnostics do not match the reviewed manifest.\n"
    + `Expected:\n${JSON.stringify(expected, null, 2)}\n`
    + `Actual:\n${JSON.stringify(actual, null, 2)}`);
}
