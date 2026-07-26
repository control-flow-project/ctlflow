import type {
  OpenTelemetryCollector,
  TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  AuditdContractService
} from "@ctlflow/auditd/testing/stub";
import type {
  IdentitydProductionService
} from "@ctlflow/identityd/testing/production";
import type {
  PolicyContractService
} from "@ctlflow/policyd/testing/stub";
import type {
  TenantdTestRuntime
} from "../runtime/tenantd-test-runtime.js";
import type {
  InvocationAuthority
} from "../support/invocation-authority.js";

export interface TenantdTestSuite {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly collector: OpenTelemetryCollector;
  readonly auditd: AuditdContractService;
  readonly identityd: IdentitydProductionService;
  readonly policyd: PolicyContractService;
  readonly invocation: InvocationAuthority;
  readonly runtime: TenantdTestRuntime;
  readonly stop: () => Promise<void>;
}

export const tenantdTestSuiteState: {
  current: TenantdTestSuite | undefined;
} = {
  current: undefined
};
