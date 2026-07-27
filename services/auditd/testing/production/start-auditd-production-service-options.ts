import type {
  TestKubernetes
} from "@ctlflow/test-mesh";

export interface StartAuditdProductionServiceOptions {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly telemetryEndpoint: string;
}
