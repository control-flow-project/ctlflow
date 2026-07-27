import type {
  OpenTelemetryCollector,
  TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  AuditdTestRuntime
} from "../runtime/auditd-test-runtime.js";

export interface AuditdTestSuite {
  readonly repositoryRoot: string;
  readonly runtime: AuditdTestRuntime;
  readonly kubernetes: TestKubernetes;
  readonly collector: OpenTelemetryCollector;
  readonly stop: () => Promise<void>;
}

export const auditdTestSuiteState: {
  current: AuditdTestSuite | undefined;
} = {
  current: undefined
};
