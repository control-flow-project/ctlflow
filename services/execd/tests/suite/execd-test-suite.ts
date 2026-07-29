import type {
  TestContainerArtifact,
  OpenTelemetryCollector,
  TestKubernetes,
  TestWorkloadCredentials
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
import type {
  ExecdTestRuntimes
} from "../runtime/service-test-runtime.js";
import type {
  InvocationAuthority
} from "../support/invocation-authority.js";
import type {
  IdentityServiceClient
} from "../generated/v1/identityd.js";

export interface ExecdTestSuite {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly collector: OpenTelemetryCollector;
  readonly auditd: AuditdProductionService;
  readonly identityd: IdentitydProductionService;
  readonly identityClient: IdentityServiceClient;
  readonly authdWorkload: TestWorkloadCredentials;
  readonly policyd: PolicydProductionService;
  readonly edgedImage: string;
  readonly applicationArtifact: TestContainerArtifact;
  readonly invocation: InvocationAuthority;
  readonly runtimes: ExecdTestRuntimes;
  readonly stop: () => Promise<void>;
}

export const execdTestSuiteState: {
  current: ExecdTestSuite | undefined;
} = {
  current: undefined
};
