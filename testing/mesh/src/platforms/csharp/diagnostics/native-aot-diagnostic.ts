export interface NativeAotDiagnostic {
  readonly fingerprint: string;
  readonly count: number;
}

export interface NativeAotDiagnosticManifest {
  readonly schemaVersion: 1;
  readonly diagnostics: readonly NativeAotDiagnostic[];
}
