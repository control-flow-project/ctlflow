import type {
  CSharpStatelessService,
  StatelessServiceFiles,
  TestKubernetes
} from "@ctlflow/test-mesh";

export interface StartEgressdOptions {
  readonly kubernetes: TestKubernetes;
  readonly environment: Readonly<Record<string, string>>;
  readonly files: StatelessServiceFiles;
}

export interface EgressdTestRuntime {
  readonly implementation: "csharp";
  readonly start: (
    options: StartEgressdOptions
  ) => Promise<CSharpStatelessService>;
  readonly stop: () => Promise<void>;
}
