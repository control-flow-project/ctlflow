import type {
  TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  AuditdProductionService
} from "@ctlflow/auditd/testing/production";
import type {
  IdentitydProductionService
} from "@ctlflow/identityd/testing/production";
import type {
  PolicydProductionService
} from "@ctlflow/policyd/testing/production";

export interface StartTenantdProductionServiceOptions {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly auditd: AuditdProductionService;
  readonly identityd: IdentitydProductionService;
  readonly policyd: PolicydProductionService;
  readonly telemetryEndpoint: string;
  readonly invocationIssuer: string;
  readonly invocationAudience: string;
  readonly invocationMaximumLifetimeSeconds: number;
  readonly retainedRecordCallers: readonly string[];
  readonly addressResolutionCallers: readonly string[];
}
