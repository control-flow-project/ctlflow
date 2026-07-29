import type {
  CSharpStatelessService,
  StatelessServiceFiles,
  TestKubernetes
} from "@ctlflow/test-mesh";

export interface StartEdgedOptions {
  readonly kubernetes: TestKubernetes;
  readonly environment: Readonly<Record<string, string>>;
  readonly files: StatelessServiceFiles;
  readonly applicationImage: string;
}

export interface EdgedTestRuntime {
  readonly implementation: "csharp";
  readonly start: (
    options: StartEdgedOptions
  ) => Promise<CSharpStatelessService>;
  readonly stop: () => Promise<void>;
}
