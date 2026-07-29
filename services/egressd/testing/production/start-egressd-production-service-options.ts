import type {
  StatelessServiceFiles,
  TestKubernetes,
  TestWorkloadCredentials
} from "@ctlflow/test-mesh";

export interface StartEgressdProductionServiceOptions {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly workload: Pick<
    TestWorkloadCredentials,
    "issuer" | "audience"
  >;
  readonly files: StatelessServiceFiles;
  readonly telemetryEndpoint: string;
}
