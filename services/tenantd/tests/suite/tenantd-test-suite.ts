import type {
  OpenTelemetryCollector,
  TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  AuditdContractService
} from "@ctlflow/auditd/testing/stub";
import type {
  IdentitydContractService
} from "@ctlflow/identityd/testing/stub";
import type {
  TenantdTestRuntime
} from "../runtime/tenantd-test-runtime.js";

export interface TenantdTestSuite {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly collector: OpenTelemetryCollector;
  readonly auditd: AuditdContractService;
  readonly identityd: IdentitydContractService;
  readonly runtime: TenantdTestRuntime;
  readonly stop: () => Promise<void>;
}

export const tenantdTestSuiteState: {
  current: TenantdTestSuite | undefined;
} = {
  current: undefined
};
