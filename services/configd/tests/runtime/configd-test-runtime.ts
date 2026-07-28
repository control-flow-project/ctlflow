import type {
  KustomizeServiceFiles,
  TestKubernetes
} from "@ctlflow/test-mesh";

export interface ConfigdTestRuntimeStartOptions {
  readonly kubernetes: TestKubernetes;
  readonly name: string;
  readonly storageDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly files: KustomizeServiceFiles;
}

export interface ConfigdRunningService {
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

export interface ConfigdTestRuntime {
  readonly implementation: string;
  readonly start: (
    options: ConfigdTestRuntimeStartOptions
  ) => Promise<ConfigdRunningService>;
  readonly stop: () => Promise<void>;
}
