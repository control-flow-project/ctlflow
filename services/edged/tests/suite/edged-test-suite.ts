import type {
  AuditdProductionService
} from "@ctlflow/auditd/testing/production";
import type {
  IdentitydProductionService,
  IdentitydProductionSource
} from "@ctlflow/identityd/testing/production";
import type {
  CSharpStatelessService,
  OpenTelemetryCollector,
  TestKubernetes,
  TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import type {
  IdentityServiceClient
} from "../generated/v1/identityd.js";
import type {
  EdgedTestRuntime
} from "../runtime/edged-test-runtime.js";

export interface EdgedTestSuite {
  readonly repositoryRoot: string;
  readonly runtime: EdgedTestRuntime;
  readonly kubernetes: TestKubernetes;
  readonly collector: OpenTelemetryCollector;
  readonly auditd: AuditdProductionService;
  readonly identityd: IdentitydProductionService;
  readonly identitySource: IdentitydProductionSource;
  readonly identityClient: IdentityServiceClient;
  readonly authdWorkload: TestWorkloadCredentials;
  readonly edged: CSharpStatelessService;
  readonly session: (
    providerSubject?: string
  ) => Promise<string>;
  readonly stop: () => Promise<void>;
}

export const edgedTestSuiteState: {
  current: EdgedTestSuite | undefined;
} = {
  current: undefined
};
