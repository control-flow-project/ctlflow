import type {
  KustomizeServiceFiles,
  TestKubernetes
} from "@ctlflow/test-mesh";

export interface IdentitydTestRuntimeStartOptions {
  readonly kubernetes: TestKubernetes;
  readonly name: string;
  readonly storageDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly files: KustomizeServiceFiles;
  readonly provision: () => Promise<void>;
}

export interface IdentitydRunningService {
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

export interface IdentitydTestRuntime {
  readonly implementation: string;
  readonly start: (
    options: IdentitydTestRuntimeStartOptions
  ) => Promise<IdentitydRunningService>;
  readonly stop: () => Promise<void>;
}
