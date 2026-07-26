import type {
  KustomizeServiceFiles,
  TestKubernetes
} from "@ctlflow/test-mesh";

export interface TenantdTestRuntimeStartOptions {
  readonly kubernetes: TestKubernetes;
  readonly name: string;
  readonly storageDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly files: KustomizeServiceFiles;
}

export interface TenantdRunningService {
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

export interface TenantdTestRuntime {
  readonly implementation: string;
  readonly start: (
    options: TenantdTestRuntimeStartOptions
  ) => Promise<TenantdRunningService>;
  readonly stop: () => Promise<void>;
}
