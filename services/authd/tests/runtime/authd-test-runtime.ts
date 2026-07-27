import type {
  CSharpStatelessService,
  StatelessServiceFiles,
  TestKubernetes
} from "@ctlflow/test-mesh";

export interface AuthdTestRuntimeStartOptions {
  readonly kubernetes: TestKubernetes;
  readonly environment: Readonly<Record<string, string>>;
  readonly files: StatelessServiceFiles;
}

export interface AuthdTestRuntime {
  readonly implementation: "csharp";
  readonly start: (
    options: AuthdTestRuntimeStartOptions
  ) => Promise<CSharpStatelessService>;
  readonly stop: () => Promise<void>;
}
