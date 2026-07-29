import type {
  CSharpService,
  KustomizeServiceFiles,
  TestKubernetes
} from "@ctlflow/test-mesh";

export interface ServiceTestRuntimeStartOptions {
  readonly kubernetes: TestKubernetes;
  readonly name: string;
  readonly storageDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly files: KustomizeServiceFiles;
  readonly provision?: () => Promise<void>;
}

export interface ServiceTestRuntime {
  readonly start: (
    options: ServiceTestRuntimeStartOptions
  ) => Promise<CSharpService>;
  readonly stop: () => Promise<void>;
}

export interface ExecdTestRuntimes {
  readonly execd: ServiceTestRuntime;
  readonly pkgd: ServiceTestRuntime;
  readonly configd: ServiceTestRuntime;
  readonly stop: () => Promise<void>;
}
