import type {
  OpenTelemetryCollector,
  TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  AuditdContractService
} from "@ctlflow/auditd/testing/stub";
import type {
  IdentitydTestRuntime
} from "../runtime/identityd-test-runtime.js";

export interface IdentitydTestSuite {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly collector: OpenTelemetryCollector;
  readonly auditd: AuditdContractService;
  readonly runtime: IdentitydTestRuntime;
  readonly stop: () => Promise<void>;
}

export const identitydTestSuiteState: {
  current: IdentitydTestSuite | undefined;
} = {
  current: undefined
};
