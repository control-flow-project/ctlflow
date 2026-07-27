import type {
  KustomizeServiceFiles,
  TestKubernetes
} from "@ctlflow/test-mesh";

export interface AuditdTestRuntimeStartOptions {
  readonly kubernetes: TestKubernetes;
  readonly name: string;
  readonly storageDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly files: KustomizeServiceFiles;
  readonly provision: () => Promise<void>;
}

export interface AuditdRunningService {
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

export interface AuditdTestRuntime {
  readonly implementation: string;
  readonly start: (
    options: AuditdTestRuntimeStartOptions
  ) => Promise<AuditdRunningService>;
  readonly stop: () => Promise<void>;
}
