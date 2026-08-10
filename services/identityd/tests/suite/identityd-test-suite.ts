import type {
  OpenTelemetryCollector,
  TestKubernetes,
  TestServiceTls
} from "@ctlflow/test-mesh";
import type {
  AuditdProductionService
} from "@ctlflow/auditd/testing/production";
import type {
  IdentitydTestRuntime
} from "../runtime/identityd-test-runtime.js";

export interface IdentitydTestSuite {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly collector: OpenTelemetryCollector;
  readonly auditd: AuditdProductionService;
  readonly policydTls: TestServiceTls;
  readonly runtime: IdentitydTestRuntime;
  readonly stop: () => Promise<void>;
}

export const identitydTestSuiteState: {
  current: IdentitydTestSuite | undefined;
} = {
  current: undefined
};
