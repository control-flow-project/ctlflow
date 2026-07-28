import type {
  KustomizeServiceFiles,
  TestKubernetes
} from "@ctlflow/test-mesh";

export interface PkgdTestRuntimeStartOptions {
  readonly kubernetes: TestKubernetes;
  readonly name: string;
  readonly storageDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly files: KustomizeServiceFiles;
}

export interface PkgdRunningService {
  readonly serviceAccountSubject: string;
  readonly grpcPort: number;
  readonly probePort: number;
  readonly diagnostics: () => string;
  readonly reconnect: () => Promise<void>;
  readonly restart: (
    environment?: Readonly<Record<string, string>>
  ) => Promise<void>;
  readonly stop: () => Promise<void>;
}

export interface PkgdTestRuntime {
  readonly implementation: string;
  readonly start: (
    options: PkgdTestRuntimeStartOptions
  ) => Promise<PkgdRunningService>;
  readonly stop: () => Promise<void>;
}
